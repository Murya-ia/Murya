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

describe('numéros de voix', () => {
  it('garde trois chiffres jusqu’à V999, puis continue sans couper (V1000)', async () => {
    await db.exec(`update public.languages set speaker_seq = 998 where code = 'dje'`);
    const numbers = [];
    for (let i = 0; i < 3; i++) {
      const { rows } = await db.query<{ n: string }>(
        `select public.next_speaker_number('dje') as n`,
      );
      numbers.push(rows[0]!.n);
    }
    expect(numbers).toEqual(['V999', 'V1000', 'V1001']);
  });
});
