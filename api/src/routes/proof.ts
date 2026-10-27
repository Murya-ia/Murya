// Page de preuve audio (J1) : vérifier sur de vrais téléphones que la chaîne
// « enregistrer → WAV → envoi direct dans R2 » fonctionne, avant de construire le parcours complet.
// Protégée par un code et désactivée quand PROOF_CODE n'est pas défini (production).
// Les fichiers vont sous `preuve/` ; une règle de cycle de vie R2 les efface après 7 jours.

import { Hono } from 'hono';
import { parseWavHeader } from '@murya/commun';
import type { Env } from '../env';
import { MAX_AUDIO_BYTES, UPLOAD_URL_SECONDS, presignUrl } from '../r2';
import { isUuid, safeEqual } from '../util';

export const proof = new Hono<{ Bindings: Env; Variables: { proofId: string } }>();

interface ProofBody {
  code?: unknown;
  id?: unknown;
}

const proofKey = (id: string) => `preuve/${id}.wav`;

// Avant chaque route : vérifie le code et l'identifiant envoyés dans le corps JSON.
proof.use('*', async (c, next) => {
  if (!c.env.PROOF_CODE) return c.json({ erreur: 'preuve_desactivee' }, 404);
  const body = await c.req.json<ProofBody>().catch(() => ({}) as ProofBody);
  if (typeof body.code !== 'string' || !safeEqual(body.code, c.env.PROOF_CODE)) {
    return c.json({ erreur: 'code_invalide' }, 403);
  }
  if (!isUuid(body.id)) return c.json({ erreur: 'identifiant_invalide' }, 400);
  c.set('proofId', body.id);
  await next();
});

proof.post('/url-envoi', async (c) => {
  const key = proofKey(c.get('proofId'));
  const url = await presignUrl(c.env, 'PUT', key, UPLOAD_URL_SECONDS);
  return c.json({ url, cle: key, expire_dans_s: UPLOAD_URL_SECONDS });
});

proof.post('/confirmer', async (c) => {
  const key = proofKey(c.get('proofId'));
  const head = await c.env.AUDIO.head(key);
  if (!head) return c.json({ erreur: 'fichier_absent' }, 404);
  if (head.size > MAX_AUDIO_BYTES) {
    await c.env.AUDIO.delete(key);
    return c.json({ erreur: 'fichier_trop_gros' }, 413);
  }

  // On ne lit que le début du fichier : l'en-tête WAV suffit pour vérifier le format.
  const start = await c.env.AUDIO.get(key, { range: { offset: 0, length: 512 } });
  if (!start) return c.json({ erreur: 'fichier_absent' }, 404);
  try {
    const info = parseWavHeader(new Uint8Array(await start.arrayBuffer()));
    const bytesPerSecond = info.sampleRate * info.channels * (info.bitsPerSample / 8);
    return c.json({
      taille: head.size,
      frequence: info.sampleRate,
      canaux: info.channels,
      bits: info.bitsPerSample,
      duree_ms: Math.round(((head.size - info.dataOffset) / bytesPerSecond) * 1000),
    });
  } catch {
    return c.json({ erreur: 'pas_un_wav' }, 422);
  }
});
