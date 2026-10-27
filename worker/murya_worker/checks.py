"""Vérifications automatiques d'un audio côté serveur (spec §6.2).

Le navigateur fait déjà des vérifications (spec §6.1), mais on ne peut pas s'y fier : le
serveur les refait sur le fichier réellement reçu. Les seuils viennent de la base (réglage
« server_checks ») et se modifient sans redéployer.

Même méthode que packages/commun/src/audio/analysis.ts : découpage en tranches de 20 ms,
bruit de fond = tranches les plus calmes, parole = tranches nettement au-dessus.
"""

from __future__ import annotations

import io
import wave
from typing import Any

import numpy as np

VERSION = 1
FRAME_MS = 20
SPEECH_ABOVE_NOISE_DB = 15
SPEECH_MIN_DBFS = -60
CLIP_LEVEL = 0.99
FLOOR_DBFS = -100.0
# Sans parole détectable : si le fond dépasse ce niveau, c'est du bruit qui couvre la voix,
# sinon c'est un silence (micro coupé, personne qui ne parle pas).
NOISY_FLOOR_DBFS = -45

DEFAULT_THRESHOLDS: dict[str, float] = {
    "min_duration_ms": 1000,
    "max_duration_ms": 20000,
    "min_speech_rms_dbfs": -55,
    "min_snr_db": 15,
    "max_clipped_ratio": 0.001,
    "min_edge_silence_ms": 100,
    "min_words_per_second": 1,
    "max_words_per_second": 4,
    "varie_sample_rate": 16000,
    "principale_min_sample_rate": 44100,
}


def read_wav(data: bytes) -> tuple[np.ndarray, dict[str, int]]:
    """Lit un WAV PCM. Renvoie les échantillons (entre -1 et 1, premier canal) et le format."""
    with wave.open(io.BytesIO(data), "rb") as wav:
        info = {
            "frequence": wav.getframerate(),
            "canaux": wav.getnchannels(),
            "bits": wav.getsampwidth() * 8,
        }
        frames = wav.readframes(wav.getnframes())
    if info["bits"] != 16:
        return np.zeros(0, dtype=np.float32), info
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if info["canaux"] > 1:
        samples = samples[:: info["canaux"]]
    return samples, info


def _db(values: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore"):
        return np.maximum(FLOOR_DBFS, 20 * np.log10(values))


def check_wav(
    data: bytes,
    words: int,
    kind: str,
    thresholds: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Vérifie un fichier WAV. `kind` = « varie » ou « principale ». Renvoie un résumé
    (valeurs mesurées + liste d'alertes) à enregistrer sur l'enregistrement."""
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    try:
        samples, info = read_wav(data)
    except (wave.Error, EOFError) as error:
        return {"version": VERSION, "format": {"ok": False, "erreur": str(error)}, "alertes": ["format_invalide"]}

    alerts: list[str] = []
    rate = info["frequence"]
    format_ok = info["canaux"] == 1 and info["bits"] == 16
    if not format_ok:
        alerts.append("format_invalide")
    expected_rate = (
        rate == t["varie_sample_rate"] if kind == "varie" else rate >= t["principale_min_sample_rate"]
    )
    if not expected_rate:
        alerts.append("frequence_inattendue")
    if samples.size == 0:
        return {"version": VERSION, "format": {**info, "ok": False}, "alertes": alerts or ["format_invalide"]}

    duration_ms = samples.size / rate * 1000
    frame = max(1, round(rate * FRAME_MS / 1000))
    count = samples.size // frame
    frames = samples[: count * frame].reshape(count, frame) if count else np.zeros((0, frame))
    frame_db = _db(np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))) if count else np.zeros(0)

    noise_db = float(np.sort(frame_db)[int(0.1 * count)]) if count else FLOOR_DBFS
    threshold = max(noise_db + SPEECH_ABOVE_NOISE_DB, SPEECH_MIN_DBFS)
    speech_idx = np.flatnonzero(frame_db >= threshold)

    if speech_idx.size:
        first, last = int(speech_idx[0]), int(speech_idx[-1])
        speech_db = float(10 * np.log10(np.mean(10 ** (frame_db[speech_idx] / 10))))
        leading_ms = first * FRAME_MS
        trailing_ms = max(0.0, duration_ms - (last + 1) * FRAME_MS)
        speech_ms = (last - first + 1) * FRAME_MS
        words_per_second = words / (speech_ms / 1000) if speech_ms > 0 else None
    else:
        speech_db, leading_ms, trailing_ms, speech_ms, words_per_second = FLOOR_DBFS, duration_ms, duration_ms, 0, None
    snr_db = speech_db - noise_db
    clipped = float(np.mean(np.abs(samples) >= CLIP_LEVEL))

    if duration_ms < t["min_duration_ms"]:
        alerts.append("trop_court")
    if duration_ms > t["max_duration_ms"]:
        alerts.append("trop_long")
    if speech_ms == 0:
        alerts.append("bruit" if noise_db > NOISY_FLOOR_DBFS else "silence")
    elif speech_db < t["min_speech_rms_dbfs"]:
        alerts.append("silence")
    elif snr_db < t["min_snr_db"]:
        alerts.append("bruit")
    if clipped > t["max_clipped_ratio"]:
        alerts.append("sature")
    if speech_ms > 0 and min(leading_ms, trailing_ms) < t["min_edge_silence_ms"]:
        alerts.append("coupe")
    if words_per_second is not None and not (
        t["min_words_per_second"] <= words_per_second <= t["max_words_per_second"]
    ):
        alerts.append("debit_anormal")

    return {
        "version": VERSION,
        "format": {**info, "ok": format_ok and expected_rate},
        "duree_ms": round(duration_ms),
        "voix_dbfs": round(speech_db, 1),
        "bruit_dbfs": round(noise_db, 1),
        "rsb_db": round(snr_db, 1),
        "saturation": round(clipped, 5),
        "silence_debut_ms": round(leading_ms),
        "silence_fin_ms": round(trailing_ms),
        "parole_ms": round(speech_ms),
        "mots_par_seconde": round(words_per_second, 2) if words_per_second is not None else None,
        "alertes": alerts,
    }
