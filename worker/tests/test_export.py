"""Tests des exports : fichiers produits, parties, fiche de version, compte rendu à la base."""

import csv
import json
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

from murya_worker.export import build_export, run
from murya_worker.stores import DirStore
from tests.test_checks import make_wav


def audio(voice: str, phrase: str, partition: str, text: str = "Ay ga koy habu.") -> dict[str, Any]:
    return {
        "cle": f"dje/varie/{voice}/dje_{voice}_{phrase}_1.wav", "texte": text, "phrase": phrase,
        "prise": 1, "voix": voice, "sexe": "femme", "age": "26-40", "region": "Niamey",
        "langue_maternelle": "zarma", "duree_ms": 2000, "partition": partition,
    }


def job(audios: list[dict[str, Any]], version: int = 1, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": 7, "langue": "dje", "type": "varie", "version": version,
        "date": "2026-11-03T10:00:00Z", "precedent": previous, "retraits_depuis": [], "audios": audios,
    }


def stores(tmp_path: Path, audios: list[dict[str, Any]]) -> tuple[DirStore, DirStore]:
    source = DirStore(tmp_path / "audio")
    for item in audios:
        source.put(item["cle"], make_wav(np.zeros(32000)))  # 2 s à 16 kHz
    return source, DirStore(tmp_path / "exports")


def test_construit_les_fichiers_les_parties_et_l_archive(tmp_path: Path) -> None:
    audios = [
        audio("V001", "S0001", "train"),
        audio("V001", "S0002", "train", text="Texte corrigé."),
        audio("V002", "S0001", "test"),
    ]
    source, exports = stores(tmp_path, audios)
    published: list[tuple[str, int]] = []

    def publish(folder: Path, repo: str, version: int) -> str:
        assert (folder / "train" / "metadata.csv").exists()
        published.append((repo, version))
        return f"murya/{repo}@v{version:03d}"

    stats, location, hf_repo = build_export(job(audios), source, exports, tmp_path / "travail", publish)

    assert location == "dje/varie/v001"
    assert hf_repo == "murya/murya-dje-varie@v001"
    assert published == [("murya-dje-varie", 1)]
    assert sorted(exports.list()) == [
        "dje/varie/v001/README.md", "dje/varie/v001/archive.zip",
        "dje/varie/v001/metadata.csv", "dje/varie/v001/metadata.jsonl",
    ]
    assert stats["audios"] == 3 and stats["voix"] == 2
    assert stats["train"] == {"audios": 2, "heures": 0.0011, "voix": 1}
    assert stats["test"]["voix"] == 1
    assert stats["voix_liste"] == ["V001", "V002"] and stats["voix_examen"] == ["V002"]
    assert stats["differences"] is None

    rows = list(csv.DictReader(exports.get("dje/varie/v001/metadata.csv").decode().splitlines()))
    assert [r["file_name"] for r in rows] == [
        "train/V001_S0001_1.wav", "train/V001_S0002_1.wav", "test/V002_S0001_1.wav",
    ]
    assert rows[1]["texte"] == "Texte corrigé." and rows[0]["duree_s"] == "2.0"
    lines = exports.get("dje/varie/v001/metadata.jsonl").decode().splitlines()
    assert json.loads(lines[2])["partition"] == "test"

    with zipfile.ZipFile(tmp_path / "exports" / "dje/varie/v001/archive.zip") as archive:
        names = set(archive.namelist())
        assert {"README.md", "train/V001_S0001_1.wav", "test/V002_S0001_1.wav"} <= names
        test_rows = archive.read("test/metadata.csv").decode().splitlines()
        assert test_rows[1].startswith("V002_S0001_1.wav,")  # chemin relatif à la partie
    readme = exports.get("dje/varie/v001/README.md").decode()
    assert "split: test" in readme and "Première version." in readme


def test_la_fiche_dit_ce_qui_a_change_depuis_la_version_precedente(tmp_path: Path) -> None:
    audios = [audio("V001", "S0001", "train"), audio("V003", "S0001", "train")]
    source, exports = stores(tmp_path, audios)
    previous = {"version": 1, "stats": {"voix_liste": ["V001", "V002"], "audios": 5, "heures": 1}}
    data = job(audios, version=2, previous=previous)
    data["retraits_depuis"] = ["V002"]

    stats, _, hf_repo = build_export(data, source, exports, tmp_path / "travail")

    assert hf_repo is None  # Hugging Face non configuré
    assert stats["differences"] == {
        "version": 1, "voix_ajoutees": ["V003"], "voix_absentes": ["V002"], "audios": -3, "heures": -0.9989,
    }
    readme = exports.get("dje/varie/v002/README.md").decode()
    assert "Voix ajoutées : V003" in readme
    assert "-3 audios, −1 h 00 min." in readme
    assert "retirées à leur demande depuis la version précédente** : V002" in readme


class FakeDb:
    def __init__(self, data: dict[str, Any] | None) -> None:
        self.jobs = [{"id": 1, "kind": "exporter", "payload": {"export_id": 7}, "attempts": 1}]
        self.data = data
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def rpc(self, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((function, args))
        if function == "worker_claim_jobs":
            jobs, self.jobs = self.jobs, []
            return jobs
        if function == "worker_export_start":
            return self.data
        return None

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


def test_rend_compte_a_la_base(tmp_path: Path) -> None:
    audios = [audio("V001", "S0001", "train")]
    source, exports = stores(tmp_path, audios)
    db = FakeDb(job(audios))
    assert run(db, source, exports, None, "essai") == {"exports": 1, "echecs": 0}
    assert db.names() == [
        "worker_claim_jobs", "worker_export_start", "worker_export_done", "worker_job_done", "worker_claim_jobs",
    ]
    done = dict(db.calls)["worker_export_done"]
    assert done["p_location"] == "dje/varie/v001" and done["p_stats"]["voix_liste"] == ["V001"]


def test_un_export_vide_echoue_avec_un_message_clair(tmp_path: Path) -> None:
    source, exports = stores(tmp_path, [])
    db = FakeDb(job([]))
    assert run(db, source, exports, None, "essai") == {"exports": 0, "echecs": 1}
    failed = dict(db.calls)["worker_export_failed"]
    assert failed["p_error"] == "RuntimeError: aucun audio validé à exporter"
