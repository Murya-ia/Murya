// Routes des voix (J2). Chaque requête porte le jeton d'invitation :
//   Authorization: Bearer <jeton>
// L'API en calcule l'empreinte SHA-256 et appelle les fonctions SQL `voice_*` avec elle.
// Les fichiers audio ne passent jamais par ici : l'app reçoit une URL signée et envoie
// le WAV directement dans R2 (spec §8.1).

import { Hono } from 'hono';
import type { Env } from '../env';
import { UPLOAD_URL_SECONDS, WAV_ERROR_STATUS, inspectStoredWav, presignUrl } from '../r2';
import { VoiceError, businessStatus, rpc } from '../supabase';
import { isUuid, sha256Hex } from '../util';

type VoiceContext = { Bindings: Env; Variables: { tokenHash: string } };
type Body = Record<string, unknown>;

export const voice = new Hono<VoiceContext>();

/** Jeton : 32 octets aléatoires en base64 « URL » = 43 caractères. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UI_LANGUAGES = ['dje', 'fr'];
/** Les mesures envoyées par le navigateur sont gardées seulement si elles restent petites. */
const MAX_CLIENT_JSON = 4000;

class BadRequest extends Error {}

voice.use('*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!TOKEN_RE.test(token)) return c.json({ erreur: 'lien_inconnu' }, 401);
  const tokenHash = await sha256Hex(token);

  // Limite principale par jeton. La limite par adresse IP reste large : au Niger, beaucoup
  // d'abonnés d'un même opérateur sortent par la même adresse.
  const ip = c.req.header('CF-Connecting-IP') ?? 'inconnue';
  const [byToken, byIp] = await Promise.all([
    c.env.RL_TOKEN?.limit({ key: tokenHash }),
    c.env.RL_IP?.limit({ key: ip }),
  ]);
  if (byToken?.success === false || byIp?.success === false) {
    return c.json({ erreur: 'trop_de_requetes' }, 429);
  }
  c.set('tokenHash', tokenHash);
  await next();
});

voice.onError((error, c) => {
  if (error instanceof VoiceError) {
    return c.json({ erreur: error.code }, businessStatus(error.code) as 400);
  }
  if (error instanceof BadRequest) return c.json({ erreur: 'requete_invalide' }, 400);
  console.error(`voix ${new URL(c.req.url).pathname} : ${error.message}`);
  return c.json({ erreur: 'erreur_interne' }, 500);
});

voice.get('/session', async (c) =>
  c.json(await rpc(c.env, 'voice_session', { p_token_hash: c.get('tokenHash') })),
);

voice.post('/consentement', async (c) => {
  const body = await readBody(c.req.raw);
  const points = body.points;
  if (!Array.isArray(points) || !points.every((p) => typeof p === 'string')) throw new BadRequest();
  return c.json(
    await rpc(c.env, 'voice_consent', {
      p_token_hash: c.get('tokenHash'),
      p_consent_id: integer(body.consentement_id),
      p_points: points,
      p_ui_language: uiLanguage(body.langue_interface),
      p_full_name: optionalText(body.nom, 200),
      p_contact: optionalText(body.contact, 200),
    }),
  );
});

voice.post('/rappel', async (c) => {
  const body = await readBody(c.req.raw);
  await rpc(c.env, 'voice_reminder', {
    p_token_hash: c.get('tokenHash'),
    p_ui_language: uiLanguage(body.langue_interface),
  });
  return c.json({ ok: true });
});

voice.post('/fiche', async (c) => {
  const body = await readBody(c.req.raw);
  await rpc(c.env, 'voice_profile', {
    p_token_hash: c.get('tokenHash'),
    p_gender: optionalText(body.sexe, 20),
    p_age_range: optionalText(body.tranche_age, 10),
    p_region: optionalText(body.region, 100),
    p_mother_tongue: optionalText(body.langue_maternelle, 100),
    p_phone_model: optionalText(body.telephone, 100),
  });
  return c.json({ ok: true });
});

voice.post('/tutoriel', async (c) => {
  await rpc(c.env, 'voice_tutorial_done', { p_token_hash: c.get('tokenHash') });
  return c.json({ ok: true });
});

voice.get('/phrases', async (c) =>
  c.json(await rpc(c.env, 'voice_sentences', { p_token_hash: c.get('tokenHash') })),
);

interface Prepared {
  cle: string;
  prise: number;
  statut: 'en_envoi' | 'recu';
}

/** Étape 2 de l'envoi : réserve la ligne en base et renvoie une URL signée vers R2. */
voice.post('/envoi/preparer', async (c) => {
  const body = await readBody(c.req.raw);
  const prepared = await prepare(c.env, c.get('tokenHash'), body);
  if (prepared.statut === 'recu') return c.json({ deja_recu: true, cle: prepared.cle });
  const url = await presignUrl(c.env, 'PUT', prepared.cle, UPLOAD_URL_SECONDS);
  return c.json({ url, cle: prepared.cle, prise: prepared.prise, deja_recu: false });
});

/** Étape 4 : vérifie le fichier arrivé dans R2, puis confirme en base (idempotent). */
voice.post('/envoi/confirmer', async (c) => {
  const body = await readBody(c.req.raw);
  const prepared = await prepare(c.env, c.get('tokenHash'), body);
  if (prepared.statut === 'recu') return c.json({ deja_recu: true });

  const wav = await inspectStoredWav(c.env, prepared.cle);
  if (typeof wav === 'string') return c.json({ erreur: wav }, WAV_ERROR_STATUS[wav]);
  // Spec §4 : WAV mono 16 bits ; 16 kHz pour les voix variées, fréquence native pour la principale.
  const expectedRate = prepared.cle.includes('/varie/')
    ? wav.sampleRate === 16_000
    : wav.sampleRate >= 16_000;
  if (wav.channels !== 1 || wav.bits !== 16 || !expectedRate) {
    await c.env.AUDIO.delete(prepared.cle);
    return c.json({ erreur: 'format_invalide' }, 422);
  }

  return c.json(
    await rpc(c.env, 'voice_confirm_upload', {
      p_token_hash: c.get('tokenHash'),
      p_recording_id: body.id,
      // Taille, durée et fréquence viennent du fichier lu par l'API, pas du navigateur.
      p_size_bytes: wav.size,
      p_duration_ms: wav.durationMs,
      p_sample_rate: wav.sampleRate,
      p_client_metrics: smallJson(body.mesures),
      p_mic_settings: smallJson(body.micro),
    }),
  );
});

voice.post('/sauter', async (c) => {
  const body = await readBody(c.req.raw);
  await rpc(c.env, 'voice_skip_sentence', {
    p_token_hash: c.get('tokenHash'),
    p_sentence_id: integer(body.phrase_id),
  });
  return c.json({ ok: true });
});

function prepare(env: Env, tokenHash: string, body: Body): Promise<Prepared> {
  if (!isUuid(body.id)) throw new BadRequest();
  return rpc<Prepared>(env, 'voice_prepare_upload', {
    p_token_hash: tokenHash,
    p_recording_id: body.id,
    p_sentence_id: integer(body.phrase_id),
  });
}

async function readBody(request: Request): Promise<Body> {
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest();
  return body as Body;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new BadRequest();
  return value;
}

function uiLanguage(value: unknown): string {
  if (typeof value !== 'string' || !UI_LANGUAGES.includes(value)) throw new BadRequest();
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequest();
  return value;
}

function smallJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return null;
  return JSON.stringify(value).length <= MAX_CLIENT_JSON ? value : null;
}
