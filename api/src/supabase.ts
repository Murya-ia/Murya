// Appel des fonctions SQL de Supabase (PostgREST « rpc »), de deux façons :
//   - `rpc` : avec la clé secrète, pour les voix (fonctions réservées à l'API) ;
//   - `rpcAsUser` : avec la session d'un membre de l'équipe ; la base applique alors SES
//     droits (RLS), exactement comme si l'espace équipe appelait la fonction lui-même.

import type { Env } from './env';

/** Erreur « métier » levée par une fonction SQL (ex. `lien_expire`), à renvoyer telle quelle à l'app. */
export class VoiceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Erreurs métier connues et code HTTP correspondant. Toute autre erreur SQL = erreur interne. */
const BUSINESS_ERRORS: Record<string, number> = {
  lien_inconnu: 401,
  lien_revoque: 410,
  lien_expire: 410,
  consentement_requis: 409,
  consentement_perime: 409,
  consentement_incomplet: 400,
  consentement_indisponible: 409,
  nom_obligatoire: 400,
  fiche_requise: 409,
  fiche_incomplete: 400,
  phrase_inconnue: 400,
  phrase_non_attribuee: 409,
  enregistrement_inconnu: 404,
  acces_refuse: 403,
  session_expiree: 401,
  voix_inconnue: 404,
  confirmation_incorrecte: 400,
  deux_admins_max: 409,
  dernier_admin: 409,
  membre_inconnu: 404,
  langue_non_attribuee: 403,
  langue_inconnue: 400,
};

export function businessStatus(code: string): number {
  return BUSINESS_ERRORS[code] ?? 500;
}

export function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  return call<T>(env, fn, args, { apikey: env.SUPABASE_SECRET_KEY });
}

/** `jwt` : jeton de session Supabase du membre connecté (envoyé par l'espace équipe). */
export function rpcAsUser<T>(
  env: Env,
  jwt: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  return call<T>(env, fn, args, {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${jwt}`,
  });
}

async function call<T>(
  env: Env,
  fn: string,
  args: Record<string, unknown>,
  auth: Record<string, string>,
): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (response.ok) return (text ? JSON.parse(text) : null) as T;

  // PostgREST renvoie { code, message } ; P0001 = `raise exception` dans nos fonctions.
  const error = (text ? JSON.parse(text) : {}) as { code?: string; message?: string };
  if (response.status === 401) throw new VoiceError('session_expiree');
  if (error.code === 'P0001' && error.message && error.message in BUSINESS_ERRORS) {
    throw new VoiceError(error.message);
  }
  throw new Error(`Supabase ${fn} : ${response.status} ${error.code ?? ''} ${error.message ?? ''}`);
}
