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
