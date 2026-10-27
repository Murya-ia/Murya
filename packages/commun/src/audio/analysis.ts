// Mesures sur un enregistrement, utilisées par les vérifications instantanées
// du navigateur (spec §6.1). Les seuils de décision ne sont pas ici : ils viennent
// de la configuration du serveur.

/** Durée d'une trame d'analyse : 20 ms est un découpage classique pour la parole. */
const FRAME_MS = 20;
/** Une trame compte comme « parole » si elle dépasse le bruit de fond d'au moins ce nombre de dB. */
const SPEECH_ABOVE_NOISE_DB = 15;
/** …et si elle dépasse ce niveau absolu (évite de prendre du souffle pour de la parole).
 * Bas, car le micro « brut » de certains téléphones enregistre faiblement (iPhone : -41 dBFS). */
const SPEECH_MIN_DBFS = -60;
/** Un échantillon est considéré écrêté (saturé) au-delà de cette amplitude. */
const CLIP_LEVEL = 0.99;
/** Niveau plancher pour éviter log(0) sur un silence numérique parfait. */
const FLOOR_DBFS = -100;

export interface AudioMetrics {
  durationMs: number;
  /** Niveau moyen sur tout le fichier, en dB par rapport au maximum (0 dBFS = maximum). */
  rmsDbfs: number;
  /** Niveau moyen des seules trames de parole. */
  speechRmsDbfs: number;
  /** Bruit de fond estimé (trames les plus calmes). */
  noiseDbfs: number;
  /** Plus grande amplitude, entre 0 et 1. */
  peak: number;
  /** Part des échantillons écrêtés, entre 0 et 1. */
  clippedRatio: number;
  /** Silence avant la première trame de parole (= durée totale si aucune parole). */
  leadingSilenceMs: number;
  /** Silence après la dernière trame de parole (= durée totale si aucune parole). */
  trailingSilenceMs: number;
  /** Durée entre le début et la fin de la parole. */
  speechMs: number;
}

export function analyzeSamples(samples: Float32Array, sampleRate: number): AudioMetrics {
  const durationMs = (samples.length / sampleRate) * 1000;
  const frameSize = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const frameCount = Math.floor(samples.length / frameSize);

  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const a = Math.abs(s);
    sumSquares += s * s;
    if (a > peak) peak = a;
    if (a >= CLIP_LEVEL) clipped++;
  }

  const frameDb = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    for (let i = f * frameSize; i < (f + 1) * frameSize; i++) sum += samples[i]! * samples[i]!;
    frameDb[f] = toDbfs(Math.sqrt(sum / frameSize));
  }

  // Bruit de fond = 10e centile des trames : robuste même si la personne parle presque tout le temps.
  const noiseDbfs = frameCount > 0 ? percentile(frameDb, 0.1) : FLOOR_DBFS;
  const speechThreshold = Math.max(noiseDbfs + SPEECH_ABOVE_NOISE_DB, SPEECH_MIN_DBFS);

  let first = -1;
  let last = -1;
  let speechSquares = 0;
  let speechFrames = 0;
  for (let f = 0; f < frameCount; f++) {
    if (frameDb[f]! >= speechThreshold) {
      if (first < 0) first = f;
      last = f;
      speechSquares += Math.pow(10, frameDb[f]! / 10);
      speechFrames++;
    }
  }

  const noSpeech = first < 0;
  return {
    durationMs,
    rmsDbfs: samples.length > 0 ? toDbfs(Math.sqrt(sumSquares / samples.length)) : FLOOR_DBFS,
    speechRmsDbfs: speechFrames > 0 ? 10 * Math.log10(speechSquares / speechFrames) : FLOOR_DBFS,
    noiseDbfs,
    peak,
    clippedRatio: samples.length > 0 ? clipped / samples.length : 0,
    leadingSilenceMs: noSpeech ? durationMs : first * FRAME_MS,
    trailingSilenceMs: noSpeech ? durationMs : Math.max(0, durationMs - (last + 1) * FRAME_MS),
    speechMs: noSpeech ? 0 : (last - first + 1) * FRAME_MS,
  };
}

function toDbfs(rms: number): number {
  return rms > 0 ? Math.max(FLOOR_DBFS, 20 * Math.log10(rms)) : FLOOR_DBFS;
}

function percentile(values: Float64Array, p: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}
