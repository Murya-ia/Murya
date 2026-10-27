import { describe, expect, it } from 'vitest';
import { analyzeSamples } from './analysis';

const RATE = 16_000;

/** Fabrique un signal : silence léger, puis un son de 440 Hz, puis silence léger. */
function signal(silenceBeforeS: number, toneS: number, silenceAfterS: number, amplitude = 0.3) {
  const total = Math.round((silenceBeforeS + toneS + silenceAfterS) * RATE);
  const start = Math.round(silenceBeforeS * RATE);
  const end = start + Math.round(toneS * RATE);
  let seed = 1;
  const noise = () => {
    // Petit générateur pseudo-aléatoire déterministe : bruit de fond à environ -70 dBFS.
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.001;
  };
  return Float32Array.from({ length: total }, (_, i) =>
    i >= start && i < end ? amplitude * Math.sin((2 * Math.PI * 440 * i) / RATE) : noise(),
  );
}

describe('analyzeSamples', () => {
  it('mesure le silence avant et après la parole', () => {
    const m = analyzeSamples(signal(0.6, 2, 0.4), RATE);
    expect(m.durationMs).toBeCloseTo(3000, 0);
    expect(m.leadingSilenceMs).toBeGreaterThanOrEqual(580);
    expect(m.leadingSilenceMs).toBeLessThanOrEqual(620);
    expect(m.trailingSilenceMs).toBeGreaterThanOrEqual(380);
    expect(m.trailingSilenceMs).toBeLessThanOrEqual(420);
    expect(m.speechMs).toBeGreaterThanOrEqual(1980);
    expect(m.clippedRatio).toBe(0);
  });

  it('repère une parole qui commence dès le début du fichier', () => {
    const m = analyzeSamples(signal(0, 2, 0.5), RATE);
    expect(m.leadingSilenceMs).toBe(0);
  });

  it('distingue le niveau de la parole du bruit de fond', () => {
    const m = analyzeSamples(signal(0.5, 1, 0.5, 0.3), RATE);
    // Sinus d'amplitude 0,3 : niveau efficace = 0,3/√2 ≈ -13,5 dBFS
    expect(m.speechRmsDbfs).toBeCloseTo(-13.5, 0);
    expect(m.noiseDbfs).toBeLessThan(-60);
  });

  it('détecte la saturation', () => {
    const m = analyzeSamples(
      signal(0.5, 1, 0.5, 1.5).map((s) => Math.max(-1, Math.min(1, s))),
      RATE,
    );
    expect(m.clippedRatio).toBeGreaterThan(0.1);
    expect(m.peak).toBe(1);
  });

  it('ne trouve aucune parole dans un silence', () => {
    const m = analyzeSamples(new Float32Array(RATE), RATE);
    expect(m.speechMs).toBe(0);
    expect(m.leadingSilenceMs).toBe(1000);
    expect(m.rmsDbfs).toBe(-100);
  });
});
