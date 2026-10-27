"""Tests de la boucle du worker, avec une fausse base et un faux stockage."""

from typing import Any

from murya_worker.main import run
from tests.test_checks import make_wav, speech


class FakeDb:
    def __init__(self, jobs: list[dict[str, Any]], recordings: dict[str, dict[str, Any] | None]) -> None:
        self.pending = jobs
        self.recordings = recordings
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def rpc(self, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((function, args))
        if function == "worker_claim_jobs":
            jobs, self.pending = self.pending[: args["p_limit"]], self.pending[args["p_limit"] :]
            return jobs
        if function == "worker_recording":
            return self.recordings.get(args["p_recording_id"])
        return None

    def called(self, function: str) -> list[dict[str, Any]]:
        return [args for name, args in self.calls if name == function]


class FakeFiles:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files

    def get(self, key: str) -> bytes:
        return self.files[key]


def recording(rid: str, key: str) -> dict[str, Any]:
    return {"id": rid, "cle": key, "type": "varie", "statut_envoi": "recu", "mots": 5, "seuils": {}}


def job(jid: int, rid: str) -> dict[str, Any]:
    return {"id": jid, "kind": "verifier_audio", "payload": {"recording_id": rid}}


def test_verifie_chaque_audio_et_enregistre_le_resultat():
    db = FakeDb([job(1, "a"), job(2, "b")], {"a": recording("a", "a.wav"), "b": recording("b", "b.wav")})
    files = FakeFiles({"a.wav": make_wav(speech(0.6, 2, 0.5)), "b.wav": make_wav(speech(0, 2, 0.5))})
    stats = run(db, files, "test", max_seconds=60, batch=1)
    assert stats == {"traitees": 2, "echecs": 0}
    saved = {c["p_recording_id"]: c for c in db.called("worker_save_checks")}
    assert saved["a"]["p_checks"]["alertes"] == []
    assert saved["b"]["p_checks"]["alertes"] == ["coupe"]
    assert len(saved["a"]["p_sha256"]) == 64
    assert [c["p_job_id"] for c in db.called("worker_job_done")] == [1, 2]


def test_une_tache_ratee_n_arrete_pas_les_autres():
    db = FakeDb([job(1, "absent"), job(2, "ok")], {"absent": recording("absent", "manquant.wav"), "ok": recording("ok", "ok.wav")})
    files = FakeFiles({"ok.wav": make_wav(speech(0.6, 2, 0.5))})
    stats = run(db, files, "test", max_seconds=60)
    assert stats == {"traitees": 1, "echecs": 1}
    assert db.called("worker_job_failed")[0]["p_job_id"] == 1
    assert "KeyError" in db.called("worker_job_failed")[0]["p_error"]


def test_un_audio_retire_entre_temps_est_simplement_ignore():
    db = FakeDb([job(1, "retire")], {"retire": None})
    stats = run(db, FakeFiles({}), "test", max_seconds=60)
    assert stats == {"traitees": 1, "echecs": 0}
    assert db.called("worker_save_checks") == []
