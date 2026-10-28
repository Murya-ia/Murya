// Chaque fonction de la base appelée par l'API, le worker ou l'espace équipe doit exister
// dans la partie publique (celle que Supabase expose) : sinon l'appel échoue en ligne,
// alors que les tests de l'API, qui simulent la base, passent.

import type { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/db';

const ROOT = join(import.meta.dirname, '..', '..');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Noms des fonctions appelées : rpc(env, 'nom'…), rpcAsUser(env, jwt, 'nom'…), .rpc('nom'…). */
function calledFunctions(): string[] {
  const names = new Set<string>();
  const patterns = [
    /\brpc(?:<[^>]*>)?\(\s*[\w.]+,\s*'(\w+)'/g,
    /\brpcAsUser(?:<[^>]*>)?\(\s*[\w.]+,\s*[^,]+,\s*'(\w+)'/g,
    /\.rpc\(\s*'(\w+)'/g,
    /\brpc\(\s*"(\w+)"/g,
  ];
  const sources = [
    ...files(join(ROOT, 'api', 'src'), /\.ts$/),
    ...files(join(ROOT, 'apps'), /\.tsx?$/),
    ...files(join(ROOT, 'worker'), /\.py$/),
  ];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const re of patterns) for (const m of text.matchAll(re)) names.add(m[1]!);
  }
  return [...names].sort();
}

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});

describe('fonctions appelées par les applications', () => {
  it('existent toutes dans le schéma public de la base', async () => {
    const called = calledFunctions();
    expect(called.length).toBeGreaterThan(30);
    const { rows } = await db.query<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`,
    );
    const existing = new Set(rows.map((r) => r.proname));
    expect(called.filter((name) => !existing.has(name))).toEqual([]);
  });
});
