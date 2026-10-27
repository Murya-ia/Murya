// URL signées pour R2 : le navigateur envoie et lit les audios directement dans R2,
// sans que les fichiers passent par l'API (spec §8.1, principe n° 1).

import { AwsClient } from 'aws4fetch';
import type { Env } from './env';

/** Durée de validité d'une URL d'envoi. */
export const UPLOAD_URL_SECONDS = 10 * 60;
/** Taille maximale acceptée pour un audio : 20 s en 48 kHz 16 bits ≈ 1,9 Mo, plus une marge. */
export const MAX_AUDIO_BYTES = 2_500_000;

export async function presignUrl(
  env: Env,
  method: 'PUT' | 'GET',
  key: string,
  expiresSeconds: number,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const path = key.split('/').map(encodeURIComponent).join('/');
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_AUDIO}/${path}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
  const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

export type R2Check = 'ok' | 'cles_refusees' | 'non_configure' | 'injoignable';

/**
 * Vérifie que les clés R2 de l'API sont acceptées, sans rien créer : on demande avec une URL
 * signée un fichier qui n'existe pas. Réponse 404 (« introuvable ») = clés acceptées ;
 * 403 (« interdit ») = clés refusées ou sans droit sur ce bucket.
 */
export async function checkR2Credentials(env: Env): Promise<R2Check> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return 'non_configure';
  }
  try {
    const response = await fetch(await presignUrl(env, 'GET', 'sante/fichier-absent.txt', 60));
    if (response.status === 404) return 'ok';
    if (response.status === 403) return 'cles_refusees';
    return 'injoignable';
  } catch {
    return 'injoignable';
  }
}
