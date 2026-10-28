// Scripts de l'essai de charge (infra/charge) : préparation des voix d'essai, puis nettoyage.
// Ils tournent avec psql contre la base d'essai ; ici on vérifie leur SQL sur une base locale.

import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMember, createTestDb } from './helpers/db';

const DIR = join(import.meta.dirname, '../../infra/charge');
let db: PGlite;

/** Le SQL d'un script, sans les commandes propres à psql (\copy, variables :'n'). */
function script(name: string, n = 3): string {
  return readFileSync(join(DIR, name), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('\\'))
    .join('\n')
    .replace(":'n'", `'${n}'`);
}

async function one<T>(query: string): Promise<T> {
  const { rows } = await db.query<{ r: T }>(query);
  return rows[0]!.r;
}

beforeAll(async () => {
  db = await createTestDb();
  await createMember(db, 'admin', ['admin']);
});

describe('essai de charge (spec §9)', () => {
  it('prépare des voix prêtes à enregistrer, dans une langue à part', async () => {
    await db.exec(script('preparer.sql'));
    const tokens = (await db.query<{ jeton: string }>('select jeton from charge_jetons')).rows;
    expect(tokens).toHaveLength(3);
    expect(tokens.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t.jeton))).toBe(true);

    // Une voix d'essai reçoit directement un lot de 100 phrases.
    const hash = await one<string>(
      `select encode(sha256(convert_to('${tokens[0]!.jeton}', 'UTF8')), 'hex') as r`,
    );
    const lot = await one<{ etape: string; phrases: unknown[] }>(
      `select public.voice_sentences('${hash}') as r`,
    );
    expect(lot.etape).toBe('lot');
    expect(lot.phrases).toHaveLength(100);
    expect(
      await one(`select count(*)::int as r from public.speakers where language_code = 'dje'`),
    ).toBe(0);
  });

  it('peut être relancé, puis efface tout ce que les voix ont produit', async () => {
    await db.exec('drop table charge_jetons');
    await db.exec(script('preparer.sql', 2));
    expect(
      await one(`select count(*)::int as r from public.speakers where language_code = 'zz'`),
    ).toBe(5);

    await db.exec(script('nettoyer.sql'));
    expect(
      await one(`select count(*)::int as r from public.speakers where language_code = 'zz'`),
    ).toBe(0);
    expect(
      await one(`select count(*)::int as r from public.invites where language_code = 'zz'`),
    ).toBe(0);
    expect(await one(`select count(*)::int as r from prive.identities`)).toBe(0);
  });
});
