// Routes de l'espace équipe. Chaque requête porte la session Supabase du membre connecté :
//   Authorization: Bearer <jeton de session>
// L'API ne décide jamais seule des droits : elle demande à la base, avec cette session.

import { Hono } from 'hono';
import type { Env } from '../env';
import { eraseFiles, type ErasurePayload } from '../erasure';
import { isExportFile, signedDownloadUrl } from '../exports';
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

const CONSENT_LANGUAGES = ['dje', 'fr'];
const CONSENT_KINDS = ['complet', 'rappel'];

/**
 * Audio de l'accord (spec §3.2), enregistré par l'équipe pour les personnes qui lisent peu :
 * un admin l'envoie, il est rangé avec les audios (ce n'est pas une donnée personnelle).
 */
team.post('/accord-audio', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const version = Number(form?.get('version_id'));
  const language = form?.get('langue');
  const kind = form?.get('type');
  const file = form?.get('fichier');
  if (
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    typeof language !== 'string' ||
    !CONSENT_LANGUAGES.includes(language) ||
    typeof kind !== 'string' ||
    !CONSENT_KINDS.includes(kind) ||
    !(file instanceof File)
  ) {
    return c.json({ erreur: 'requete_invalide' }, 400);
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!file.type.startsWith('audio/') && !AUDIO_EXTENSIONS.includes(extension)) {
    return c.json({ erreur: 'pas_un_audio' }, 400);
  }
  if (file.size > MAX_ORAL_CONSENT_BYTES) return c.json({ erreur: 'fichier_trop_gros' }, 413);

  const safeExtension = AUDIO_EXTENSIONS.includes(extension) ? extension : 'audio';
  const key = `accord/v${version}/${language}-${kind}-${crypto.randomUUID()}.${safeExtension}`;
  await c.env.AUDIO.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  try {
    await rpcAsUser(c.env, c.get('jwt'), 'set_consent_audio', {
      p_consent_version_id: version,
      p_ui_language: language,
      p_kind: kind,
      p_storage_key: key,
    });
  } catch (error) {
    await c.env.AUDIO.delete(key);
    throw error;
  }
  return c.json({ ok: true });
});

/** Adresse d'écoute (15 min) d'un audio de l'accord, pour l'équipe. */
team.get('/accord-audio/:version/:langue/:type', async (c) => {
  const version = Number(c.req.param('version'));
  const language = c.req.param('langue');
  const kind = c.req.param('type');
  if (
    !Number.isSafeInteger(version) ||
    !CONSENT_LANGUAGES.includes(language) ||
    !CONSENT_KINDS.includes(kind)
  ) {
    return c.json({ erreur: 'requete_invalide' }, 400);
  }
  const key = await rpcAsUser<string | null>(c.env, c.get('jwt'), 'consent_audio_key', {
    p_consent_version_id: version,
    p_ui_language: language,
    p_kind: kind,
  });
  if (!key) return c.json({ erreur: 'introuvable' }, 404);
  return c.json({ url: await presignUrl(c.env, 'GET', key, LISTEN_URL_SECONDS) });
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

/**
 * Lien de téléchargement d'un fichier d'export (spec §5.9), pour un admin. La base vérifie le
 * rôle, note le téléchargement au journal et donne le dossier ; le lien signé vaut 15 minutes.
 */
team.post('/exports/:id/lien', async (c) => {
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => null)) as { fichier?: unknown } | null;
  if (!Number.isInteger(id) || id <= 0 || !isExportFile(body?.fichier)) {
    return c.json({ erreur: 'requete_invalide' }, 400);
  }
  const location = await rpcAsUser<string | null>(c.env, c.get('jwt'), 'export_location', {
    p_export_id: id,
    p_file: body.fichier,
  });
  if (!location) return c.json({ erreur: 'introuvable' }, 404);
  return c.json({
    url: await signedDownloadUrl(c.env, new URL(c.req.url).origin, location, body.fichier),
  });
});

const ROLES = ['recruteur', 'verificateur', 'qualite', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Nouveau membre de l'équipe, créé par un admin depuis la page « Membres » : le compte de
 * connexion (e-mail + mot de passe provisoire, confirmé d'office) puis sa place dans l'équipe.
 * La création d'un compte demande la clé secrète : c'est pourquoi elle passe par l'API.
 */
team.post('/membres', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    email?: unknown;
    mot_de_passe?: unknown;
    nom?: unknown;
    roles?: unknown;
  } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.mot_de_passe === 'string' ? body.mot_de_passe : '';
  const name = typeof body?.nom === 'string' ? body.nom.trim() : '';
  const roles = Array.isArray(body?.roles) ? body.roles : null;
  if (
    !EMAIL_RE.test(email) ||
    password.length < 10 ||
    password.length > 72 ||
    !name ||
    name.length > 80 ||
    !roles ||
    !roles.every((r) => typeof r === 'string' && ROLES.includes(r))
  ) {
    return c.json({ erreur: 'requete_invalide' }, 400);
  }
  // La base dit si la personne connectée est admin (avec SA session).
  if (!(await rpcAsUser<boolean>(c.env, c.get('jwt'), 'has_role', { p_role: 'admin' }))) {
    return c.json({ erreur: 'acces_refuse' }, 403);
  }

  const auth = { apikey: c.env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const created = await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (created.status === 422) return c.json({ erreur: 'email_existe' }, 409);
  if (!created.ok) throw new Error(`création du compte : HTTP ${created.status}`);
  const { id } = (await created.json()) as { id: string };

  try {
    await rpcAsUser(c.env, c.get('jwt'), 'add_team_member', {
      p_user_id: id,
      p_name: name,
      p_roles: roles,
    });
  } catch (error) {
    // La base refuse (ex. déjà deux admins) : on ne laisse pas un compte sans équipe.
    await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: auth,
    });
    throw error;
  }
  return c.json({ ok: true, email });
});
