"""Exports (spec §5.9) : construit une version du jeu de données demandée par un admin.

Pour chaque tâche « exporter » :
  1. la base donne la liste des audios validés (texte corrigé s'il y a lieu), avec la partie
     de chaque voix (`train`, ou `test` pour les voix examen) ;
  2. les audios sont copiés depuis R2, tels quels (WAV 16 kHz), rangés par partie ;
  3. on écrit `metadata.csv`, `metadata.jsonl` et la fiche de version `README.md` ;
  4. on range dans le bucket des exports : la fiche, les métadonnées et une archive .zip ;
  5. si Hugging Face est configuré, on pousse le dossier sur un dépôt PRIVÉ, avec une
     étiquette par version (v001, v002…) ;
  6. la base note la version comme prête et fige la partie de chaque voix exportée.

Les identités ne sont jamais dans la base vue par le worker : une voix n'est connue que par
son numéro (V012). Lancement :  python -m murya_worker.export
"""

from __future__ import annotations

import csv
import io
import json
import shutil
import socket
import tempfile
import time
import wave
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Protocol

from .stores import Store

COLUMNS = [
    "file_name", "texte", "id_phrase", "voix", "sexe", "tranche_age", "region",
    "langue_maternelle", "duree_s", "partition", "mode",
]
PARTITIONS = ("train", "test")
DOWNLOAD_THREADS = 16


class Rpc(Protocol):
    def rpc(self, function: str, args: dict[str, Any]) -> Any: ...


# Envoi vers Hugging Face : (dossier, nom du dépôt, version) -> adresse du dépôt.
Publisher = Callable[[Path, str, int], str]


def file_name(audio: dict[str, Any]) -> str:
    return f"{audio['voix']}_{audio['phrase']}_{audio['prise']}.wav"


def wav_seconds(data: bytes) -> float:
    with wave.open(io.BytesIO(data)) as reader:
        return reader.getnframes() / reader.getframerate()


def hours(seconds: float) -> float:
    return round(seconds / 3600, 4)


def duration(hours_: float) -> str:
    """Durée lisible : « 12 h 05 min », « 7 min », « 40 s »."""
    seconds = round(hours_ * 3600)
    if seconds < 60:
        return f"{seconds} s"
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def download_audios(audios: list[dict[str, Any]], store: Store, root: Path) -> list[dict[str, Any]]:
    """Copie chaque audio dans root/<partie>/ et renvoie les lignes de métadonnées."""

    def one(audio: dict[str, Any]) -> dict[str, Any]:
        data = store.get(audio["cle"])
        name = file_name(audio)
        (root / audio["partition"] / name).write_bytes(data)
        return {
            "file_name": f"{audio['partition']}/{name}",
            "texte": audio["texte"],
            "id_phrase": audio["phrase"],
            "voix": audio["voix"],
            "sexe": audio.get("sexe") or "",
            "tranche_age": audio.get("age") or "",
            "region": audio.get("region") or "",
            "langue_maternelle": audio.get("langue_maternelle") or "",
            "duree_s": round(wav_seconds(data), 3),
            "partition": audio["partition"],
            # « repetition » : la personne a écouté un modèle avant de dire la phrase.
            "mode": audio.get("mode") or "lecture",
        }

    for partition in PARTITIONS:
        (root / partition).mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(DOWNLOAD_THREADS) as pool:
        return list(pool.map(one, audios))


def write_metadata(rows: list[dict[str, Any]], root: Path) -> None:
    """metadata.csv / .jsonl à la racine (chemins complets), et un metadata.csv par partie
    (chemins relatifs) : c'est ce que lit Hugging Face (format « audiofolder »)."""

    def write_csv(path: Path, items: list[dict[str, Any]]) -> None:
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=COLUMNS)
            writer.writeheader()
            writer.writerows(items)

    write_csv(root / "metadata.csv", rows)
    with (root / "metadata.jsonl").open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")
    for partition in PARTITIONS:
        items = [
            {**row, "file_name": row["file_name"].split("/", 1)[1]}
            for row in rows if row["partition"] == partition
        ]
        write_csv(root / partition / "metadata.csv", items)


def compute_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def part(items: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "audios": len(items),
            "heures": hours(sum(r["duree_s"] for r in items)),
            "voix": len({r["voix"] for r in items}),
        }

    voices = {r["voix"]: r for r in rows}  # une ligne par voix, pour la répartition
    return {
        **part(rows),
        "train": part([r for r in rows if r["partition"] == "train"]),
        "test": part([r for r in rows if r["partition"] == "test"]),
        "repartition": {
            key: dict(sorted(Counter(v[key] or "non précisé" for v in voices.values()).items()))
            for key in ("sexe", "tranche_age", "region")
        },
        "voix_liste": sorted(voices),
        "voix_examen": sorted({r["voix"] for r in rows if r["partition"] == "test"}),
    }


def differences(stats: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any] | None:
    if not previous:
        return None
    before = previous.get("stats") or {}
    old, new = set(before.get("voix_liste", [])), set(stats["voix_liste"])
    return {
        "version": previous["version"],
        "voix_ajoutees": sorted(new - old),
        "voix_absentes": sorted(old - new),
        "audios": stats["audios"] - before.get("audios", 0),
        "heures": round(stats["heures"] - before.get("heures", 0), 4),
    }


def readme(job: dict[str, Any], stats: dict[str, Any], diff: dict[str, Any] | None) -> str:
    """Fiche de version (spec §5.9). L'en-tête YAML indique à Hugging Face les deux parties."""
    language, kind, version = job["langue"], job["type"], job["version"]
    names = {"varie": "voix variées", "principale": "voix principale"}

    def table(title: str, counts: dict[str, int]) -> list[str]:
        lines = [f"| {title} | Voix |", "| --- | ---: |"]
        lines += [f"| {key} | {value} |" for key, value in counts.items()]
        return lines + [""]

    lines = [
        "---",
        f"pretty_name: Murya {language} ({names.get(kind, kind)}) v{version:03d}",
        "configs:",
        "  - config_name: default",
        "    data_files:",
        "      - split: train",
        "        path: train/**",
        "      - split: test",
        "        path: test/**",
        "---",
        "",
        f"# Murya — {language}, {names.get(kind, kind)}, version {version:03d}",
        "",
        f"Export du {job['date'][:10]}. Audios WAV 16 kHz mono, validés à l'écoute par l'équipe "
        "Murya ; le texte est celui réellement lu (corrigé s'il y a lieu).",
        "",
        "## En chiffres",
        "",
        "| | Audios | Durée | Voix |",
        "| --- | ---: | ---: | ---: |",
        f"| Total | {stats['audios']} | {duration(stats['heures'])} | {stats['voix']} |",
        f"| `train` (entraînement) | {stats['train']['audios']} | {duration(stats['train']['heures'])} "
        f"| {stats['train']['voix']} |",
        f"| `test` (examen) | {stats['test']['audios']} | {duration(stats['test']['heures'])} "
        f"| {stats['test']['voix']} |",
        "",
        "Partie `test` : tous les audios des voix « examen », qui n'apparaissent jamais dans "
        "`train`. Une voix garde sa partie d'une version à l'autre.",
        "",
        "## Répartition des voix",
        "",
        *table("Sexe", stats["repartition"]["sexe"]),
        *table("Tranche d'âge", stats["repartition"]["tranche_age"]),
        *table("Région", stats["repartition"]["region"]),
        "## Différences avec la version précédente",
        "",
    ]
    if diff is None:
        lines.append("Première version.")
    else:
        lines += [
            f"Par rapport à la version {diff['version']:03d} : {diff['audios']:+d} audios, "
            f"{'+' if diff['heures'] >= 0 else '−'}{duration(abs(diff['heures']))}.",
            "",
            f"- Voix ajoutées : {', '.join(diff['voix_ajoutees']) or 'aucune'}",
            f"- Voix absentes de cette version : {', '.join(diff['voix_absentes']) or 'aucune'}",
        ]
    withdrawn = job.get("retraits_depuis") or []
    if withdrawn:
        lines += [
            "",
            "**Voix retirées à leur demande depuis la version précédente** : "
            f"{', '.join(withdrawn)}. Supprimez leurs fichiers de toutes vos copies des versions "
            "précédentes.",
        ]
    lines += [
        "",
        "## Fichiers",
        "",
        "- `metadata.csv`, `metadata.jsonl` : une ligne par audio (" + ", ".join(COLUMNS) + ").",
        "- `train/`, `test/` : les audios, avec un `metadata.csv` par partie.",
        "",
        "Aucune identité (nom, contact) ne figure dans cet export : une voix n'est connue que "
        "par son numéro.",
        "",
    ]
    return "\n".join(lines)


def make_zip(root: Path, target: Path) -> None:
    # Pas de compression : les WAV ne se compressent presque pas, et c'est bien plus rapide.
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())


def build_export(
    job: dict[str, Any],
    audio: Store,
    exports: Store,
    workdir: Path,
    publish: Publisher | None = None,
) -> tuple[dict[str, Any], str, str | None]:
    """Construit un export. Renvoie (chiffres, dossier dans le bucket, dépôt Hugging Face)."""
    if not job["audios"]:
        raise RuntimeError("aucun audio validé à exporter")
    name = f"murya-{job['langue']}-{job['type']}-v{job['version']:03d}"
    root = workdir / name
    rows = download_audios(job["audios"], audio, root)
    write_metadata(rows, root)
    stats = compute_stats(rows)
    stats["differences"] = differences(stats, job.get("precedent"))
    (root / "README.md").write_text(readme(job, stats, stats["differences"]), encoding="utf-8")

    archive = workdir / f"{name}.zip"
    make_zip(root, archive)
    stats["archive_octets"] = archive.stat().st_size
    location = f"{job['langue']}/{job['type']}/v{job['version']:03d}"
    for file in ("README.md", "metadata.csv", "metadata.jsonl"):
        exports.put_file(f"{location}/{file}", root / file)
    exports.put_file(f"{location}/archive.zip", archive)

    hf_repo = publish(root, f"murya-{job['langue']}-{job['type']}", job["version"]) if publish else None
    return stats, location, hf_repo


def hugging_face_publisher(token: str, owner: str) -> Publisher:
    def publish(folder: Path, repo_name: str, version: int) -> str:
        from huggingface_hub import HfApi  # importé ici : les tests n'en ont pas besoin

        api = HfApi(token=token)
        repo_id = f"{owner}/{repo_name}"
        api.create_repo(repo_id, repo_type="dataset", private=True, exist_ok=True)
        api.upload_folder(
            repo_id=repo_id,
            repo_type="dataset",
            folder_path=folder,
            commit_message=f"Version v{version:03d}",
            # Les audios d'une voix retirée ne doivent pas rester dans la dernière version.
            delete_patterns=["train/**", "test/**", "metadata.*"],
        )
        api.create_tag(repo_id, repo_type="dataset", tag=f"v{version:03d}", exist_ok=True)
        return f"{repo_id}@v{version:03d}"

    return publish


def run(db: Rpc, audio: Store, exports: Store, publish: Publisher | None, worker_id: str) -> dict[str, int]:
    """Traite les exports en attente, un par un."""
    stats = {"exports": 0, "echecs": 0}
    while True:
        jobs = db.rpc("worker_claim_jobs", {
            "p_worker": worker_id, "p_kinds": ["exporter"], "p_limit": 1, "p_lock_minutes": 180,
        })
        if not jobs:
            return stats
        job = jobs[0]
        export_id = job["payload"]["export_id"]
        workdir = Path(tempfile.mkdtemp(prefix="murya-export-"))
        try:
            data = db.rpc("worker_export_start", {"p_export_id": export_id})
            if data is not None:
                result, location, hf_repo = build_export(data, audio, exports, workdir, publish)
                db.rpc("worker_export_done", {
                    "p_export_id": export_id, "p_stats": result, "p_location": location,
                    "p_hf_repo": hf_repo,
                })
            db.rpc("worker_job_done", {"p_job_id": job["id"]})
            stats["exports"] += 1
        except Exception as error:  # noqa: BLE001 — l'échec est noté, l'admin relance
            message = f"{type(error).__name__}: {error}"
            db.rpc("worker_export_failed", {"p_export_id": export_id, "p_error": message})
            db.rpc("worker_job_failed", {"p_job_id": job["id"], "p_error": message})
            stats["echecs"] += 1
        finally:
            shutil.rmtree(workdir, ignore_errors=True)


def main() -> None:
    import os

    from .services import Supabase, env
    from .stores import S3Store

    db = Supabase(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"))
    account = env("R2_ACCOUNT_ID")
    audio = S3Store.r2(account, env("R2_BUCKET_AUDIO"), env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY"))
    exports = S3Store.r2(
        account, env("EXPORT_R2_BUCKET"), env("EXPORT_R2_ACCESS_KEY_ID"), env("EXPORT_R2_SECRET_ACCESS_KEY")
    )
    token, owner = os.environ.get("HF_TOKEN", "").strip(), os.environ.get("HF_OWNER", "").strip()
    publish = hugging_face_publisher(token, owner) if token and owner else None
    if publish is None:
        print("Hugging Face non configuré (HF_TOKEN, HF_OWNER) : export rangé dans R2 seulement.")
    worker_id = f"{socket.gethostname()}-{int(time.time())}"
    stats = run(db, audio, exports, publish, worker_id)
    print(f"Exports : {stats['exports']} construit(s), {stats['echecs']} échec(s).")


if __name__ == "__main__":
    main()
