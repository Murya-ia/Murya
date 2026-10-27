// Routes de l'espace équipe. Chaque requête porte la session Supabase du membre connecté :
//   Authorization: Bearer <jeton de session>
// L'API ne décide jamais seule des droits : elle demande à la base, avec cette session.

import { Hono } from 'hono';
import type { Env } from '../env';
import { eraseFiles, type ErasurePayload } from '../erasure';
import { presignUrl } from '../r2';
import { VoiceError, businessStatus, rpc, rpcAsUser } from '../supabase';
import { isUuid } from '../util';

type TeamContext = { Bindings: Env; Variables: { jwt: string } };

export const team = new Hono<TeamContext>();

/** Durée de validité d'une adresse d'écoute. */
const LISTEN_URL_SECONDS = 15 * 60;
/** Consentement oral : enregistrement du téléphone du recruteur, quelques minutes au plus. */
const MAX_ORAL_CONSENT_BYTES = 15_000_000;
const AUDIO_EXTENSIONS = ['m4a', 'mp3', 'ogg', 'opus', 'wav', 'aac', 'amr', '3gp', 'webm'];

team.use('*', async (c, next) => {
  const jwt = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!jwt) return c.json({ erreur: 'session_expiree' }, 401);
  c.set('jwt', jwt);
  await next();
});

team.onError((error, c) => {
  if (error instanceof VoiceError) {
    return c.json({ erreur: error.code }, businessStatus(error.code) as 400);
  }
  console.error(`equipe ${new URL(c.req.url).pathname} : ${error.message}`);
  return c.json({ erreur: 'erreur_interne' }, 500);
});

/** Adresse d'écoute signée (15 min) d'un audio que la personne a le droit d'écouter. */
team.get('/audio/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ erreur: 'requete_invalide' }, 400);
  const key = await rpcAsUser<string | null>(c.env, c.get('jwt'), 'team_audio_key', {
    p_recording_id: id,
  });
  // Absent ou interdit : même réponse, pour ne rien révéler.
  if (!key) return c.json({ erreur: 'introuvable' }, 404);
  return c.json({ url: await presignUrl(c.env, 'GET', key, LISTEN_URL_SECONDS) });
});

/**
 * Consentement oral (spec §3.2) : le fichier va dans le bucket des identités, jamais avec les
 * audios des voix. Exception au principe « les fichiers ne passent pas par l'API » : ces
 * fichiers sont rares et petits, et cela évite une deuxième clé d'accès au stockage.
 */
team.post('/consentement-oral', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const inviteId = form?.get('invite_id');
  const name = form?.get('nom');
  const contact = form?.get('contact');
  const file = form?.get('fichier');
  if (!isUuid(inviteId) || typeof name !== 'string' || !(file instanceof File)) {
    return c.json({ erreur: 'requete_invalide' }, 400);
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!file.type.startsWith('audio/') && !AUDIO_EXTENSIONS.includes(extension)) {
    return c.json({ erreur: 'pas_un_audio' }, 400);
  }
  if (file.size > MAX_ORAL_CONSENT_BYTES) return c.json({ erreur: 'fichier_trop_gros' }, 413);

  const safeExtension = AUDIO_EXTENSIONS.includes(extension) ? extension : 'audio';
  const key = `consentements-oraux/${inviteId}/${crypto.randomUUID()}.${safeExtension}`;
  await c.env.IDENTITES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  try {
    const result = await rpcAsUser(c.env, c.get('jwt'), 'record_oral_consent', {
      p_invite_id: inviteId,
      p_full_name: name,
      p_contact: typeof contact === 'string' && contact.trim() ? contact : null,
      p_audio_key: key,
    });
    return c.json(result);
  } catch (error) {
    // Refusé par la base : on ne garde pas un fichier orphelin.
    await c.env.IDENTITES.delete(key);
    throw error;
  }
});

/**
 * Retrait d'une voix (spec §5.8), par un admin qui retape le numéro de la voix pour confirmer.
 * La base vérifie les droits et efface tout de son côté ; l'API efface ensuite les fichiers.
 * Si cela échoue, la tâche reste en file et sera reprise par la tâche planifiée.
 */
team.post('/retrait/:speakerId', async (c) => {
  const speakerId = c.req.param('speakerId');
  const body = (await c.req.json().catch(() => null)) as { confirmation?: unknown } | null;
  if (!isUuid(speakerId) || typeof body?.confirmation !== 'string') {
    return c.json({ erreur: 'requete_invalide' }, 400);
  }
  const result = await rpcAsUser<ErasurePayload & { tache: number; audios: number }>(
    c.env,
    c.get('jwt'),
    'withdraw_speaker',
    { p_speaker_id: speakerId, p_confirm_number: body.confirmation },
  );
  let filesErased = false;
  try {
    await eraseFiles(c.env, result);
    await rpc(c.env, 'worker_job_done', { p_job_id: result.tache });
    filesErased = true;
  } catch (error) {
    console.error(`retrait : effacement des fichiers à reprendre (${(error as Error).message})`);
  }
  return c.json({ numero: result.numero, audios: result.audios, fichiers_effaces: filesErased });
});
