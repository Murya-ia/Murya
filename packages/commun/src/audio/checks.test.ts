import { describe, expect, it } from 'vitest';
import type { AudioMetrics } from './analysis';
import { clientProblems } from './checks';

const good: AudioMetrics = {
  durationMs: 4000,
  rmsDbfs: -25,
  speechRmsDbfs: -20,
  noiseDbfs: -65,
  peak: 0.6,
  clippedRatio: 0,
  leadingSilenceMs: 600,
  trailingSilenceMs: 500,
  speechMs: 2900,
};

describe('clientProblems', () => {
  it('accepte un bon enregistrement', () => {
    expect(clientProblems(good)).toEqual([]);
  });

  it('signale un enregistrement trop court', () => {
    expect(clientProblems({ ...good, durationMs: 800 })).toContain('trop_court');
  });

  it('signale une voix trop faible ou absente', () => {
    expect(clientProblems({ ...good, speechRmsDbfs: -58 })).toEqual(['inaudible']);
    expect(clientProblems({ ...good, speechMs: 0, speechRmsDbfs: -100 })).toEqual(['inaudible']);
  });

  it('accepte une voix basse mais nette (iPhone 13 Pro, micro brut)', () => {
    // Mesures réelles du 27/10/2026 : voix -40,8 dBFS, bruit de fond -70,5 dBFS.
    expect(clientProblems({ ...good, speechRmsDbfs: -40.8, noiseDbfs: -70.5 })).toEqual([]);
  });

  it('signale une voix noyée dans le bruit, même assez forte', () => {
    expect(clientProblems({ ...good, speechRmsDbfs: -30, noiseDbfs: -38 })).toEqual(['inaudible']);
  });

  it('signale la saturation', () => {
    expect(clientProblems({ ...good, clippedRatio: 0.01 })).toEqual(['sature']);
  });

  it('signale une parole collée au début ou à la fin', () => {
    expect(clientProblems({ ...good, leadingSilenceMs: 40 })).toEqual(['coupe']);
    expect(clientProblems({ ...good, trailingSilenceMs: 0 })).toEqual(['coupe']);
  });

  it('utilise les seuils fournis par le serveur', () => {
    expect(
      clientProblems({ ...good, durationMs: 1500 }, { ...thresholds(), min_duration_ms: 2000 }),
    ).toEqual(['trop_court']);
  });
});

function thresholds() {
  return {
    min_duration_ms: 1000,
    min_speech_rms_dbfs: -45,
    max_clipped_ratio: 0.001,
    min_edge_silence_ms: 200,
  };
}
