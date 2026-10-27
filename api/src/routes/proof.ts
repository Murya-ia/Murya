// Page de preuve audio (J1) : vérifier sur de vrais téléphones que la chaîne
// « enregistrer → WAV → envoi direct dans R2 » fonctionne, avant de construire le parcours complet.
// Protégée par un code et désactivée quand PROOF_CODE n'est pas défini (production).
// Les fichiers vont sous `preuve/` ; une règle de cycle de vie R2 les efface après 7 jours.

import { Hono } from 'hono';
import type { Env } from '../env';
import { UPLOAD_URL_SECONDS, WAV_ERROR_STATUS, inspectStoredWav, presignUrl } from '../r2';
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
  const wav = await inspectStoredWav(c.env, proofKey(c.get('proofId')));
  if (typeof wav === 'string') return c.json({ erreur: wav }, WAV_ERROR_STATUS[wav]);
  return c.json({
    taille: wav.size,
    frequence: wav.sampleRate,
    canaux: wav.channels,
    bits: wav.bits,
    duree_ms: wav.durationMs,
  });
});
