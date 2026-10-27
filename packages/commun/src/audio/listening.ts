// Amplification pour L'ÉCOUTE seulement (espace équipe). Les fichiers de la collecte restent
// « bruts » comme le demande la spec (§4.1) ; mais un micro brut enregistre souvent bas
// (iPhone : voix vers -45 dBFS), trop bas pour bien juger un audio au casque.

/** Gain maximal appliqué : +30 dB (×31,6), pour ne pas transformer un souffle en vacarme. */
const MAX_GAIN = 31.6;
/** Niveau de crête visé après amplification (un peu sous le maximum, pour éviter la saturation). */
const TARGET_PEAK = 0.9;

/** Facteur par lequel multiplier les échantillons pour une écoute confortable (1 = inchangé). */
export function listeningGain(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  if (peak === 0) return 1;
  return Math.max(1, Math.min(MAX_GAIN, TARGET_PEAK / peak));
}

/** Copie amplifiée des échantillons (l'original n'est pas modifié). */
export function amplify(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * gain;
  return out;
}
