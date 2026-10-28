// Liens entre tables dont dépendent les requêtes de l'espace équipe (jointures PostgREST).

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/db';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

describe('liens entre tables', () => {
  it('relie directement un audio à sa phrase (écoute du test, page Voix)', async () => {
    const { rows } = await db.query<{ cible: string }>(`
      select confrelid::regclass::text as cible from pg_constraint
      where conrelid = 'public.recordings'::regclass and contype = 'f'
        and conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.recordings'::regclass
                              and attname = 'sentence_id')]::int2[]
    `);
    expect(rows.map((r) => r.cible)).toContain('sentences');
  });
});
