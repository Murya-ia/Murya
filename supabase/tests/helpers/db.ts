// Base de données de test : un Postgres en mémoire (PGlite) avec les migrations appliquées.
// Chaque fichier de test crée sa propre base, donc les tests sont indépendants.

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_DIR = join(import.meta.dirname, '..', '..');
const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'));
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    } catch (error) {
      throw new Error(`Échec de la migration ${file} : ${(error as Error).message}`);
    }
  }
  return db;
}

/**
 * Exécute `fn` comme le ferait l'API Supabase pour un utilisateur :
 * rôle `authenticated` (ou `anon` si userId est null) et identifiant dans le JWT.
 * Le rôle d'administration de la base est rétabli ensuite, même en cas d'erreur.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const role = userId ? 'authenticated' : 'anon';
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

/**
 * Crée un compte et, si des rôles sont donnés, un membre de l'équipe (en zarma par défaut).
 * Renvoie son identifiant.
 */
export async function createMember(
  db: PGlite,
  name: string,
  roles: string[] | null,
  languages: string[] = ['dje'],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [`${name}@test.murya`],
  );
  const id = rows[0]!.id;
  if (roles) {
    await db.query(
      `insert into public.team_members (user_id, display_name, roles, languages)
       values ($1, $2, $3, $4)`,
      [id, name, roles, languages],
    );
  }
  return id;
}

/** Crée une voix rattachée à un recruteur. Renvoie son identifiant. */
export async function createSpeaker(db: PGlite, recruiterId: string, language = 'dje') {
  const { rows } = await db.query<{ id: string; number: string }>(
    `insert into public.speakers (language_code, number, recruiter_id)
     values ($1, public.next_speaker_number($1), $2)
     returning id, number`,
    [language, recruiterId],
  );
  return rows[0]!;
}

/** Crée une phrase. Renvoie son identifiant. */
export async function createSentence(
  db: PGlite,
  code: string,
  text: string,
  options: { isTest?: boolean; language?: string } = {},
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `insert into public.sentences (language_code, code, text, translation_fr, is_test)
     values ($1, $2, $3, 'traduction', $4) returning id`,
    [options.language ?? 'dje', code, text, options.isTest ?? false],
  );
  return rows[0]!.id;
}

/** Crée un enregistrement reçu pour une voix et une phrase. */
export async function createRecording(db: PGlite, speakerId: string, sentenceId: number) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.recordings (id, speaker_id, sentence_id, sentence_version, take, kind,
                                    storage_key, upload_status, received_at)
     values (gen_random_uuid(), $1, $2, 1, 1, 'varie', 'test/' || gen_random_uuid() || '.wav',
             'recu', now())
     returning id`,
    [speakerId, sentenceId],
  );
  return rows[0]!.id;
}
