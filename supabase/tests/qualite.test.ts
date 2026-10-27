// Tests de la qualité (J4) : file des tâches du worker, vérifications serveur, expiration des
// phrases, double écoute, tableau de bord.

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  createMember,
  createRecording,
  createSentence,
  createSpeaker,
  createTestDb,
} from './helpers/db';

let db: PGlite;
let admin: string;
let quality: string;
let verifier: string;
let recruiter: string;
let speaker: string;
let sentences: number[];

async function sql<T>(query: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ r: T }>(query, params);
  return rows[0]!.r;
}

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, () => sql<T>(query, params));
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  quality = await createMember(db, 'qualite', ['qualite']);
  verifier = await createMember(db, 'verif', ['verificateur']);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
  speaker = (await createSpeaker(db, recruiter)).id;
  sentences = [];
  for (let i = 1; i <= 10; i++) sentences.push(await createSentence(db, `S00${i}`, `Phrase ${i}`));
});

describe('file des tâches du worker', () => {
  it('donne chaque tâche à un seul worker, et la reprend si le worker disparaît', async () => {
    await db.exec(`delete from public.jobs`);
    await db.exec(
      `insert into public.jobs (kind, payload) values ('verifier_audio', '{"n": 1}'), ('verifier_audio', '{"n": 2}')`,
    );
    const first = await sql<{ id: number }[]>(
      `select public.worker_claim_jobs('w1', array['verifier_audio'], 1) as r`,
    );
    expect(first).toHaveLength(1);
    const second = await sql<{ id: number }[]>(
      `select public.worker_claim_jobs('w2', array['verifier_audio'], 5) as r`,
    );
    expect(second.map((j) => j.id)).not.toContain(first[0]!.id);
    // Le worker w1 a disparu : sa réservation expire, la tâche redevient prenable.
    await db.query(
      `update public.jobs set locked_until = now() - interval '1 minute' where id = $1`,
      [first[0]!.id],
    );
    const retaken = await sql<{ id: number; attempts: number }[]>(
      `select public.worker_claim_jobs('w3', array['verifier_audio'], 5) as r`,
    );
    expect(retaken).toEqual([expect.objectContaining({ id: first[0]!.id, attempts: 2 })]);
  });

  it('réessaie plus tard après un échec, puis abandonne après le maximum', async () => {
    await db.exec(`delete from public.jobs`);
    const id = await sql<number>(
      `insert into public.jobs (kind, max_attempts) values ('verifier_audio', 2) returning id as r`,
    );
    await sql(`select public.worker_claim_jobs('w', array['verifier_audio']) as r`);
    await db.query(`select public.worker_job_failed($1, 'R2 injoignable')`, [id]);
    const after1 = await sql<{ status: string; later: boolean }>(
      `select jsonb_build_object('status', status, 'later', run_after > now()) as r from public.jobs where id = $1`,
      [id],
    );
    expect(after1).toEqual({ status: 'en_attente', later: true });
    await db.query(`update public.jobs set run_after = now() where id = $1`, [id]);
    await sql(`select public.worker_claim_jobs('w', array['verifier_audio']) as r`);
    await db.query(`select public.worker_job_failed($1, 'encore')`, [id]);
    expect(await sql(`select status as r from public.jobs where id = $1`, [id])).toBe('echec');
  });

  it("ne sont pas appelables depuis l'espace équipe", async () => {
    await asUser(db, admin, async () => {
      await expect(
        db.query(`select public.worker_claim_jobs('x', array['verifier_audio'])`),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe('vérifications serveur', () => {
  it('enregistrent les résultats, marquent suspect et repèrent les doublons', async () => {
    const a = await createRecording(db, speaker, sentences[0]!);
    const b = await createRecording(db, speaker, sentences[1]!);
    const hash = 'ab'.repeat(32);
    const clean = await sql<{ alertes: string[] }>(
      `select public.worker_save_checks($1, '{"alertes": []}', $2) as r`,
      [a, hash],
    );
    expect(clean.alertes).toEqual([]);
    const duplicate = await sql<{ alertes: string[] }>(
      `select public.worker_save_checks($1, '{"alertes": ["bruit"]}', $2) as r`,
      [b, hash],
    );
    expect(duplicate.alertes).toEqual(['bruit', 'doublon']);
    const flags = await db.query<{ suspect: boolean }>(
      `select suspect from public.recordings where id in ($1, $2) order by suspect`,
      [a, b],
    );
    expect(flags.rows.map((r) => r.suspect)).toEqual([false, true]);
  });
});

describe('expiration des phrases attribuées (spec §7)', () => {
  it('libère les phrases non enregistrées après le délai', async () => {
    const other = (await createSpeaker(db, recruiter)).id;
    await db.query(
      `insert into public.assignments (speaker_id, sentence_id, position, assigned_at)
       values ($1, $2, 1, now() - interval '10 days'), ($1, $3, 2, now())`,
      [other, sentences[8], sentences[9]],
    );
    await db.query(`update public.sentences set pending_reads = 1 where id in ($1, $2)`, [
      sentences[8],
      sentences[9],
    ]);
    await db.exec(`select public.expire_assignments()`);
    const { rows } = await db.query<{ status: string; pending_reads: number }>(
      `select a.status, t.pending_reads from public.assignments a join public.sentences t on t.id = a.sentence_id
       where a.speaker_id = $1 order by a.position`,
      [other],
    );
    expect(rows).toEqual([
      { status: 'expiree', pending_reads: 0 },
      { status: 'attribuee', pending_reads: 1 },
    ]);
  });
});

describe('double écoute (spec §5.5)', () => {
  let validated: string[];

  beforeAll(async () => {
    validated = [];
    for (let i = 2; i < 8; i++) {
      const id = await createRecording(db, speaker, sentences[i]!);
      await db.query(
        `update public.recordings set qc_status = 'valide', reviewer_id = $2, reviewed_at = now() where id = $1`,
        [id, verifier],
      );
      validated.push(id);
    }
    await db.query(`update public.sentences set validated_reads = 1 where id = any($1)`, [
      sentences,
    ]);
  });

  it('tire au hasard 10 % des audios validés de la semaine (arrondi au-dessus)', async () => {
    expect(await sql<number>(`select public.sample_double_reviews('dje') as r`)).toBe(1);
    // Déjà tirés : un second tirage la même semaine ne les reprend pas.
    await db.exec(
      `insert into public.settings (scope, key, value) values ('dje', 'double_review_ratio', '1')`,
    );
    expect(await sql<number>(`select public.sample_double_reviews('dje') as r`)).toBe(5);
  });

  it("se fait à l'aveugle, jamais sur ses propres décisions", async () => {
    await expect(as(verifier, `select public.double_review_claim('dje') as r`)).rejects.toThrow(
      'acces_refuse',
    );
    const item = await as<{ id: string; avis: unknown[]; double_ecoute: boolean }>(
      quality,
      `select public.double_review_claim('dje') as r`,
    );
    expect(validated).toContain(item.id);
    expect(item.avis).toEqual([]);
    expect(item.double_ecoute).toBe(true);
  });

  it("mesure l'accord, et applique la décision du responsable qualité en cas de désaccord", async () => {
    const first = await as<{ id: string }>(
      quality,
      `select public.double_review_claim('dje') as r`,
    );
    expect(
      await as<boolean>(quality, `select public.double_review_submit($1, 'valide') as r`, [
        first.id,
      ]),
    ).toBe(true);

    const second = await as<{ id: string }>(
      quality,
      `select public.double_review_claim('dje') as r`,
    );
    expect(
      await as<boolean>(
        quality,
        `select public.double_review_submit($1, 'rejete', null, 'bruit_fort') as r`,
        [second.id],
      ),
    ).toBe(false);
    const { rows } = await db.query<{ qc_status: string; validated_reads: number }>(
      `select r.qc_status, t.validated_reads from public.recordings r join public.sentences t on t.id = r.sentence_id
       where r.id = $1`,
      [second.id],
    );
    expect(rows[0]).toEqual({ qc_status: 'rejete', validated_reads: 0 });
  });
});

describe('tableau de bord (spec §5.1)', () => {
  it("est calculé à l'avance et lisible par toute l'équipe, pas au-delà", async () => {
    await db.exec(`select public.refresh_dashboard('dje')`);
    const data = await as<{
      voix_par_statut: Record<string, number>;
      audios: { recus: number };
      phrases_lectures: { total: number };
      double_ecoute: { faites: number; desaccords: number };
    }>(verifier, `select data as r from public.dashboard_snapshots where language_code = 'dje'`);
    expect(data.voix_par_statut.inscrite).toBeGreaterThanOrEqual(2);
    expect(data.audios.recus).toBeGreaterThan(0);
    expect(data.phrases_lectures.total).toBe(10);
    expect(data.double_ecoute).toMatchObject({ faites: 2, desaccords: 1 });

    const outsider = await createMember(db, 'exterieur', null);
    const hidden = await asUser(
      db,
      outsider,
      async () => (await db.query(`select * from public.dashboard_snapshots`)).rows.length,
    );
    expect(hidden).toBe(0);
  });

  it('signale une voix avec trop de rejets et les audios qui attendent trop', async () => {
    const noisy = (await createSpeaker(db, recruiter)).id;
    for (let i = 0; i < 4; i++) {
      const id = await createRecording(db, noisy, sentences[i]!);
      await db.query(
        `update public.recordings set qc_status = 'rejete', reject_reason = 'bruit_fort', reviewed_at = now() where id = $1`,
        [id],
      );
    }
    const old = await createRecording(db, noisy, sentences[5]!);
    await db.query(
      `update public.recordings set received_at = now() - interval '5 days' where id = $1`,
      [old],
    );
    const data = await sql<{
      alertes: { voix_trop_de_rejets: { rejets: number }[]; audios_en_attente: { nombre: number } };
    }>(`select public.compute_dashboard('dje') as r`);
    expect(data.alertes.voix_trop_de_rejets).toEqual([expect.objectContaining({ rejets: 4 })]);
    expect(data.alertes.audios_en_attente.nombre).toBeGreaterThanOrEqual(1);
  });

  it("peut être recalculé à la demande par un membre de l'équipe", async () => {
    await as(verifier, `select public.refresh_dashboard_now('dje') as r`);
    const outsider = await createMember(db, 'exterieur2', null);
    await expect(as(outsider, `select public.refresh_dashboard_now('dje') as r`)).rejects.toThrow(
      'acces_refuse',
    );
  });
});
