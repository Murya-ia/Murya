// Décisions des vérifications instantanées du navigateur (spec §6.1).
// Les seuils viennent du serveur (réglage `client_checks`) ; ces valeurs ne servent
// que de secours si la configuration n'a pas pu être téléchargée.

import type { AudioMetrics } from './analysis';

export interface ClientCheckThresholds {
  min_duration_ms: number;
  min_speech_rms_dbfs: number;
  max_clipped_ratio: number;
  min_edge_silence_ms: number;
}

export const DEFAULT_CLIENT_CHECKS: ClientCheckThresholds = {
  min_duration_ms: 1000,
  min_speech_rms_dbfs: -45,
  max_clipped_ratio: 0.001,
  min_edge_silence_ms: 200,
};

/** Problèmes possibles, dans l'ordre où on les signale à la voix (un seul message à la fois). */
export type ClientProblem = 'trop_court' | 'inaudible' | 'sature' | 'coupe';

export function clientProblems(
  m: AudioMetrics,
  t: ClientCheckThresholds = DEFAULT_CLIENT_CHECKS,
): ClientProblem[] {
  const problems: ClientProblem[] = [];
  if (m.durationMs < t.min_duration_ms) problems.push('trop_court');
  if (m.speechMs === 0 || m.speechRmsDbfs < t.min_speech_rms_dbfs) problems.push('inaudible');
  if (m.clippedRatio > t.max_clipped_ratio) problems.push('sature');
  if (
    m.speechMs > 0 &&
    (m.leadingSilenceMs < t.min_edge_silence_ms || m.trailingSilenceMs < t.min_edge_silence_ms)
  ) {
    problems.push('coupe');
  }
  return problems;
}
