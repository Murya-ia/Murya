// Effacement des fichiers d'une voix retirée (droit à l'effacement, spec §5.8).
// La base a déjà tout supprimé de son côté et laissé une tâche « effacer_fichiers » avec la
// liste des fichiers. L'API les efface aussitôt après le retrait ; si quelque chose échoue, la
// tâche reste en file et la tâche planifiée (toutes les heures) recommence.

import type { Env } from './env';
import { rpc } from './supabase';

export interface ErasurePayload {
  langue: string;
  numero: string;
  date: string;
  /** Admin qui a retiré la voix (identifiant de membre de l'équipe). */
  par: string;
  prefixes_audio: string[];
  cles_audio: string[];
  cles_identites: string[];
}

/** R2 efface au plus 1 000 fichiers par appel. */
const BATCH = 1000;

async function deleteAll(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += BATCH) {
    await bucket.delete(keys.slice(i, i + BATCH));
  }
}

/** Efface les fichiers de la voix ; renvoie le nombre de fichiers visés. */
export async function eraseFiles(env: Env, payload: ErasurePayload): Promise<number> {
  // Les clés connues de la base, plus tout ce qui se trouve encore dans les dossiers de la
  // voix (un envoi resté à moitié, par exemple).
  const audioKeys = new Set(payload.cles_audio);
  for (const prefix of payload.prefixes_audio) {
    let cursor: string | undefined;
    do {
      const page = await env.AUDIO.list({ prefix, cursor });
      for (const object of page.objects) audioKeys.add(object.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  await deleteAll(env.AUDIO, [...audioKeys]);
  await deleteAll(env.IDENTITES, payload.cles_identites);

  // Trace minimale (numéro, date, admin et clés des fichiers d'identité, aucun nom) :
  //   - la sauvegarde de nuit efface ainsi ses propres copies de ces fichiers ;
  //   - si l'on restaure un jour une sauvegarde plus ancienne que ce retrait, la voix est
  //     retirée à nouveau (docs/sauvegardes.md).
  await env.AUDIO.put(
    `retraits/${payload.langue}/${payload.numero}.json`,
    JSON.stringify({
      langue: payload.langue,
      numero: payload.numero,
      date: payload.date,
      par: payload.par,
      cles_identites: payload.cles_identites,
    }),
    { httpMetadata: { contentType: 'application/json' } },
  );
  return audioKeys.size + payload.cles_identites.length;
}

/** Tâche planifiée : reprend les effacements restés en file (échec réseau, coupure…). */
export async function processPendingErasures(
  env: Env,
): Promise<{ faites: number; echecs: number }> {
  const jobs = await rpc<{ id: number; payload: ErasurePayload }[]>(env, 'worker_claim_jobs', {
    p_worker: 'api-planifiee',
    p_kinds: ['effacer_fichiers'],
    p_limit: 10,
  });
  const stats = { faites: 0, echecs: 0 };
  for (const job of jobs ?? []) {
    try {
      await eraseFiles(env, job.payload);
      await rpc(env, 'worker_job_done', { p_job_id: job.id });
      stats.faites++;
    } catch (error) {
      await rpc(env, 'worker_job_failed', {
        p_job_id: job.id,
        p_error: (error as Error).message,
      });
      stats.echecs++;
    }
  }
  return stats;
}
