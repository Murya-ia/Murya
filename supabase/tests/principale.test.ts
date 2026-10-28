// Tests de la voix principale (J5, spec §5.7) : désignation, séances, verrou entre séances,
// audio de référence, fin du corpus.

import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createMember, createSentence, createTestDb } from './helpers/db';

let db: PGlite;
let admin: string;
let recruiter: string;
let consentId: number;
const POINTS = ['enregistrement', 'entrainement_ia', 'usage_commercial', 'metadonnees', 'majeur'];

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function sql<T>(query: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ r: T }>(query, params);
  return rows[0]!.r;
}

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, () => sql<T>(query, params));
}

/** Une voix passée par le parcours (accord, fiche, tutoriel), test réussi : active. */
async function voice(name: string): Promise<{ id: string; tokenHash: string }> {
  const token = await asUser(db, recruiter, async () => {
    const { rows } = await db.query<{ token: string }>(
      `select token from public.create_invite($1, 'dje')`,
      [name],
    );
    return rows[0]!.token;
  });
  const tokenHash = hash(token);
  await db.query(`select public.voice_consent($1, $2, $3, 'fr', $4, null)`, [
    tokenHash,
    consentId,
    POINTS,
    name,
  ]);
  await db.query(`select public.voice_profile($1, 'femme', '26-40', 'Niamey', 'zarma', null)`, [
    tokenHash,
  ]);
  await db.query(`select public.voice_tutorial_done($1)`, [tokenHash]);
  const id = await sql<string>(
    `select s.id as r from public.speakers s join public.invites i on i.id = s.invite_id
     where i.token_hash = decode($1, 'hex')`,
    [tokenHash],
  );
  return { id, tokenHash };
}

interface Batch {
  etape: string;
  phrases: { id: number; code: string }[];
  a_refaire?: { id: number }[];
  seance?: { numero: number; reference_cle: string | null };
}

const sentencesFor = (tokenHash: string) =>
  sql<Batch>(`select public.voice_sentences($1) as r`, [tokenHash]);

/** Enregistre une phrase comme le ferait l'app : préparer, puis confirmer. */
async function record(tokenHash: string, sentenceId: number): Promise<string> {
  const id = randomUUID();
  await db.query(`select public.voice_prepare_upload($1, $2, $3)`, [tokenHash, id, sentenceId]);
  await db.query(`select public.voice_confirm_upload($1, $2, 1000, 3000, 48000)`, [tokenHash, id]);
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
  const { rows } = await db.query<{ id: number }>(`
    insert into public.consent_versions (language_code, version, texts, published_at)
    values ('dje', 1, '{"fr": {"intro": "Texte"}}', now() - interval '1 minute') returning id
  `);
  consentId = rows[0]!.id;
  // Corpus de 7 phrases, séances de 3 : séances de 3, 3 et 1 phrase.
  for (let i = 1; i <= 7; i++) await createSentence(db, `S000${i}`, `Phrase ${i}.`);
  await createSentence(db, 'T01', 'Phrase de test.', { isTest: true });
  await db.exec(
    `insert into public.settings (scope, key, value) values ('dje', 'principal_session_size', '3')`,
  );
});

describe('désignation (admins seulement)', () => {
  it('une seule voix principale par langue, jamais une voix déjà en lot', async () => {
    const first = await voice('Principale');
    const second = await voice('Autre');
    await expect(
      as(recruiter, `select public.set_principal($1, true) as r`, [first.id]),
    ).rejects.toThrow('acces_refuse');
    await as(admin, `select public.set_principal($1, true) as r`, [first.id]);
    await expect(
      as(admin, `select public.set_principal($1, true) as r`, [second.id]),
    ).rejects.toThrow('principale_existe');

    // Une voix variée qui a déjà son lot ne peut plus devenir principale.
    await db.query(`update public.speakers set status = 'active' where id = $1`, [second.id]);
    await sentencesFor(second.tokenHash);
    await as(admin, `select public.set_principal($1, false) as r`, [first.id]);
    await expect(
      as(admin, `select public.set_principal($1, true) as r`, [second.id]),
    ).rejects.toThrow('deja_en_lot');
    await as(admin, `select public.set_principal($1, true) as r`, [first.id]);
    // Remise à zéro des compteurs de lectures (lot de l'autre voix) pour la suite.
    await db.exec(`delete from public.speakers where id = '${second.id}'`);
  });
});

describe('séances', () => {
  let principal: { id: string; tokenHash: string };
  const seen = new Set<number>();

  beforeAll(async () => {
    principal = {
      ...(await sql<{ id: string }>(
        `select jsonb_build_object('id', id) as r from public.speakers where is_principal`,
      )),
      tokenHash: '',
    };
    principal.tokenHash = await sql<string>(
      `select encode(i.token_hash, 'hex') as r from public.invites i
       join public.speakers s on s.invite_id = i.id where s.id = $1`,
      [principal.id],
    );
    // Test réussi (comme toute voix), puis enregistrement en séances.
    await db.query(`update public.speakers set status = 'active' where id = $1`, [principal.id]);
  });

  it('ouvre la séance 1 avec les premières phrases, mélangées, sans les phrases du test', async () => {
    const batch = await sentencesFor(principal.tokenHash);
    expect(batch.etape).toBe('lot');
    expect(batch.seance).toEqual({ numero: 1, reference_cle: null });
    expect(batch.phrases).toHaveLength(3);
    expect(batch.phrases.some((p) => p.code === 'T01')).toBe(false);
    batch.phrases.forEach((p) => seen.add(p.id));
    // Même liste à chaque ouverture de l'app.
    expect((await sentencesFor(principal.tokenHash)).phrases).toEqual(batch.phrases);
  });

  it('les phrases d’une séance n’expirent jamais', async () => {
    await db.exec(`update public.assignments set assigned_at = now() - interval '60 days'`);
    await sql(`select public.expire_assignments() as r`);
    expect(
      await sql(`select count(*)::int as r from public.assignments where status = 'expiree'`),
    ).toBe(0);
  });

  it('séance enregistrée : attente de vérification, pas de séance suivante', async () => {
    const batch = await sentencesFor(principal.tokenHash);
    const ids = [];
    for (const p of batch.phrases) ids.push(await record(principal.tokenHash, p.id));
    expect((await sentencesFor(principal.tokenHash)).etape).toBe('verification');
    expect(await sql(`select status as r from public.speakers where id = $1`, [principal.id])).toBe(
      'active',
    );

    // Deux validées, une en doute : toujours bloqué.
    await db.query(`update public.recordings set qc_status = 'valide' where id = any($1)`, [
      ids.slice(0, 2),
    ]);
    await db.query(`update public.recordings set qc_status = 'doute' where id = $1`, [ids[2]]);
    expect((await sentencesFor(principal.tokenHash)).etape).toBe('verification');
  });

  it('séance entièrement vérifiée : la suivante s’ouvre seule, les rejetées sont à refaire', async () => {
    await db.exec(`update public.recordings set qc_status = 'rejete', reject_reason = 'bruit_fort'
                   where qc_status = 'doute'`);
    const batch = await sentencesFor(principal.tokenHash);
    expect(batch.etape).toBe('lot');
    expect(batch.seance!.numero).toBe(2);
    expect(batch.phrases).toHaveLength(3);
    expect(batch.phrases.every((p) => !seen.has(p.id))).toBe(true);
    expect(batch.a_refaire).toHaveLength(1);
  });

  it("donne l'audio de référence choisi par un admin (un audio validé de la voix)", async () => {
    const rejected = await sql<string>(
      `select id as r from public.recordings where qc_status = 'rejete'`,
    );
    await expect(
      as(admin, `select public.set_reference_audio($1, $2) as r`, [principal.id, rejected]),
    ).rejects.toThrow('reference_invalide');
    const valid = await sql<{ id: string; storage_key: string }>(
      `select jsonb_build_object('id', id, 'storage_key', storage_key) as r
       from public.recordings where qc_status = 'valide' limit 1`,
    );
    await as(admin, `select public.set_reference_audio($1, $2) as r`, [principal.id, valid.id]);
    const batch = await sentencesFor(principal.tokenHash);
    expect(batch.seance!.reference_cle).toBe(valid.storage_key);
    expect(valid.storage_key).toMatch(/^dje\/principale\//);
  });

  it('montre l’avancement aux admins et au responsable qualité, pas aux autres', async () => {
    const overview = await as<{
      phrases_total: number;
      voix: { seances: { numero: number; statut: string; rejetees: number }[] };
    }>(admin, `select public.principal_overview('dje') as r`);
    expect(overview.phrases_total).toBe(7);
    expect(overview.voix.seances.map((s) => [s.numero, s.statut])).toEqual([
      [1, 'verifiee'],
      [2, 'en_cours'],
    ]);
    expect(overview.voix.seances[0]!.rejetees).toBe(1);
    await expect(as(recruiter, `select public.principal_overview('dje') as r`)).rejects.toThrow(
      'acces_refuse',
    );
  });

  it('termine la voix quand tout le corpus est lu et vérifié', async () => {
    for (let round = 0; round < 3; round++) {
      const batch = await sentencesFor(principal.tokenHash);
      if (batch.etape !== 'lot') break;
      for (const p of batch.phrases) await record(principal.tokenHash, p.id);
      await db.exec(
        `update public.recordings set qc_status = 'valide' where qc_status = 'a_verifier'`,
      );
    }
    const end = await sentencesFor(principal.tokenHash);
    expect(end.etape).toBe('fin');
    expect(await sql(`select status as r from public.speakers where id = $1`, [principal.id])).toBe(
      'terminee',
    );
    expect(
      await sql(`select count(*)::int as r from public.principal_sessions where speaker_id = $1`, [
        principal.id,
      ]),
    ).toBe(3);
  });
});
