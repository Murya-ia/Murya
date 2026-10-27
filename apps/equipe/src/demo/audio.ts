// Son d'exemple du mode démo : une « voix » de synthèse (syllabes sur une note grave), pour
// voir le lecteur et sa forme d'onde sans télécharger de vrai audio.

import { encodeWav } from '@murya/commun';

const RATE = 16_000;
let url: string | null = null;

export function demoAudioUrl(): string {
  if (url) return url;
  const samples = new Float32Array(RATE * 3);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const noise = (Math.random() - 0.5) * 0.004;
    const speaking = t > 0.5 && t < 2.6;
    // Environ 4 syllabes par seconde, comme une lecture calme.
    const envelope = speaking ? Math.max(0, Math.sin(Math.PI * 4 * (t - 0.5))) ** 0.6 : 0;
    const voice =
      0.18 * Math.sin(2 * Math.PI * 140 * t) +
      0.08 * Math.sin(2 * Math.PI * 280 * t) +
      0.04 * Math.sin(2 * Math.PI * 560 * t);
    samples[i] = noise + envelope * voice;
  }
  url = URL.createObjectURL(new Blob([encodeWav(samples, RATE)], { type: 'audio/wav' }));
  return url;
}
