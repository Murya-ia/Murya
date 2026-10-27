import { describe, expect, it } from 'vitest';
import { amplify, listeningGain } from './listening';

describe('listeningGain', () => {
  it('remonte une voix basse pour que sa crête atteigne 0,9', () => {
    // Crête 0,038 : mesurée sur l'iPhone 13 Pro le 27/10/2026.
    const gain = listeningGain(Float32Array.from([0, 0.038, -0.02]));
    expect(gain).toBeCloseTo(0.9 / 0.038, 5);
  });

  it("ne baisse jamais le son et plafonne l'amplification à +30 dB", () => {
    expect(listeningGain(Float32Array.from([0.95]))).toBe(1);
    expect(listeningGain(Float32Array.from([0.001]))).toBeCloseTo(31.6, 5);
    expect(listeningGain(new Float32Array(10))).toBe(1);
  });
});

describe('amplify', () => {
  it("renvoie une copie amplifiée sans toucher à l'original", () => {
    const original = Float32Array.from([0.1, -0.2]);
    const louder = amplify(original, 3);
    expect(Array.from(louder)).toEqual([0.1 * 3, -0.2 * 3].map((v) => Math.fround(v)));
    expect(Array.from(original)).toEqual([0.1, -0.2].map((v) => Math.fround(v)));
  });
});
