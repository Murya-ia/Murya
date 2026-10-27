"""Tests des vérifications serveur (spec §6.2), sur des sons fabriqués."""

import io
import wave

import numpy as np

from murya_worker.checks import check_wav

RATE = 16000


def make_wav(samples: np.ndarray, rate: int = RATE, channels: int = 1) -> bytes:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    if channels == 2:
        pcm = np.repeat(pcm, 2)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def speech(before: float, voice: float, after: float, amplitude: float = 0.3, rate: int = RATE) -> np.ndarray:
    """Silence léger, « voix » (sinus à 300 Hz), silence léger."""
    rng = np.random.default_rng(1)
    total = int((before + voice + after) * rate)
    signal = rng.uniform(-0.0005, 0.0005, total)
    start, end = int(before * rate), int((before + voice) * rate)
    t = np.arange(end - start) / rate
    signal[start:end] = amplitude * np.sin(2 * np.pi * 300 * t)
    return signal


def test_un_bon_enregistrement_ne_declenche_aucune_alerte():
    result = check_wav(make_wav(speech(0.6, 2.0, 0.5)), words=5, kind="varie")
    assert result["alertes"] == []
    assert result["format"] == {"frequence": 16000, "canaux": 1, "bits": 16, "ok": True}
    assert result["duree_ms"] == 3100
    assert 580 <= result["silence_debut_ms"] <= 620
    assert result["mots_par_seconde"] == 2.5


def test_trop_court_et_trop_long():
    assert "trop_court" in check_wav(make_wav(speech(0.2, 0.4, 0.2)), words=1, kind="varie")["alertes"]
    assert "trop_long" in check_wav(make_wav(speech(1, 19.5, 1)), words=40, kind="varie")["alertes"]


def test_silence_et_voix_noyee_dans_le_bruit():
    assert "silence" in check_wav(make_wav(np.zeros(RATE * 2)), words=3, kind="varie")["alertes"]
    rng = np.random.default_rng(2)
    noisy = speech(0.5, 2, 0.5, amplitude=0.05) + rng.uniform(-0.03, 0.03, int(3 * RATE))
    assert "bruit" in check_wav(make_wav(noisy), words=5, kind="varie")["alertes"]


def test_saturation_et_parole_coupee():
    assert "sature" in check_wav(make_wav(speech(0.5, 2, 0.5, amplitude=1.5)), words=5, kind="varie")["alertes"]
    assert "coupe" in check_wav(make_wav(speech(0.0, 2, 0.5)), words=5, kind="varie")["alertes"]


def test_debit_de_lecture_anormal():
    # 20 mots en 2 secondes de parole = 10 mots/s : bien trop rapide.
    assert "debit_anormal" in check_wav(make_wav(speech(0.5, 2, 0.5)), words=20, kind="varie")["alertes"]


def test_format_et_frequence():
    stereo = check_wav(make_wav(speech(0.5, 2, 0.5), channels=2), words=5, kind="varie")
    assert "format_invalide" in stereo["alertes"]
    wrong_rate = check_wav(make_wav(speech(0.5, 2, 0.5, rate=48000), rate=48000), words=5, kind="varie")
    assert "frequence_inattendue" in wrong_rate["alertes"]
    principal = check_wav(make_wav(speech(0.5, 2, 0.5, rate=48000), rate=48000), words=5, kind="principale")
    assert principal["alertes"] == []
    assert check_wav(b"pas un wav", words=1, kind="varie")["alertes"] == ["format_invalide"]


def test_seuils_venus_de_la_base():
    strict = check_wav(
        make_wav(speech(0.6, 2.0, 0.5)), words=5, kind="varie", thresholds={"max_words_per_second": 2}
    )
    assert strict["alertes"] == ["debit_anormal"]


def test_voix_basse_mais_nette_comme_sur_iphone():
    # Mesures réelles du 27/10/2026 : voix vers -45 dBFS, bruit vers -70 dBFS.
    quiet = speech(0.6, 2.0, 0.5, amplitude=0.008)
    result = check_wav(make_wav(quiet), words=5, kind="varie")
    assert result["alertes"] == []
