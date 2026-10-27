"""Boucle du worker : prend les tâches dans la base, les traite, rend compte.

Plusieurs workers peuvent tourner en même temps : la base donne chaque tâche à un seul
d'entre eux (FOR UPDATE SKIP LOCKED), et reprend celles d'un worker qui aurait disparu.

Lancement :  python -m murya_worker --max-minutes 12
"""

from __future__ import annotations

import argparse
import hashlib
import socket
import time
from typing import Any, Protocol

from . import checks


class Rpc(Protocol):
    def rpc(self, function: str, args: dict[str, Any]) -> Any: ...


class Files(Protocol):
    def get(self, key: str) -> bytes: ...


KINDS = ["verifier_audio"]


def verify_recording(job: dict[str, Any], db: Rpc, files: Files) -> None:
    """Tâche « verifier_audio » : télécharge l'audio, le vérifie, enregistre le résultat."""
    recording = db.rpc("worker_recording", {"p_recording_id": job["payload"]["recording_id"]})
    if recording is None or recording.get("statut_envoi") != "recu":
        return  # audio retiré entre-temps (droit à l'effacement) : rien à vérifier
    data = files.get(recording["cle"])
    result = checks.check_wav(
        data,
        words=recording.get("mots") or 0,
        kind=recording["type"],
        thresholds=recording.get("seuils"),
    )
    db.rpc(
        "worker_save_checks",
        {
            "p_recording_id": recording["id"],
            "p_checks": result,
            "p_sha256": hashlib.sha256(data).hexdigest(),
        },
    )


HANDLERS = {"verifier_audio": verify_recording}


def run(db: Rpc, files: Files, worker_id: str, max_seconds: float, batch: int = 20) -> dict[str, int]:
    """Traite les tâches jusqu'à ce qu'il n'y en ait plus, ou que le temps soit écoulé."""
    deadline = time.monotonic() + max_seconds
    stats = {"traitees": 0, "echecs": 0}
    while time.monotonic() < deadline:
        jobs = db.rpc("worker_claim_jobs", {"p_worker": worker_id, "p_kinds": KINDS, "p_limit": batch})
        if not jobs:
            break
        for job in jobs:
            try:
                HANDLERS[job["kind"]](job, db, files)
                db.rpc("worker_job_done", {"p_job_id": job["id"]})
                stats["traitees"] += 1
            except Exception as error:  # noqa: BLE001 — une tâche ratée ne doit pas arrêter les autres
                db.rpc("worker_job_failed", {"p_job_id": job["id"], "p_error": f"{type(error).__name__}: {error}"})
                stats["echecs"] += 1
    return stats


def main() -> None:
    from .services import Storage, Supabase, env

    parser = argparse.ArgumentParser(description="Worker Murya : vérifications audio côté serveur.")
    parser.add_argument("--max-minutes", type=float, default=12, help="durée maximale d'une exécution")
    args = parser.parse_args()

    db = Supabase(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"))
    files = Storage(
        env("R2_ACCOUNT_ID"), env("R2_BUCKET_AUDIO"), env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY")
    )
    worker_id = f"{socket.gethostname()}-{int(time.time())}"
    stats = run(db, files, worker_id, args.max_minutes * 60)
    print(f"Worker {worker_id} : {stats['traitees']} tâche(s) traitée(s), {stats['echecs']} échec(s).")
