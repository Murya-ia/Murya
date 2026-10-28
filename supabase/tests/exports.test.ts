// Tests des exports (J6b, spec §5.9) : partition d'examen, demande d'export, données
// transmises au worker (jamais d'identité), parties figées après un export.

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
let recruiter: string;
let sentence: number;

async function sql<T>(query: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ r: T }>(query, params);
  return rows[0]!.r;
}

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, () => sql<T>(query, params));
}

interface Overview {
  voix_eligibles: number;
  cible: number;
  examen: { id: string; numero: string; figee: boolean }[];
  proposition: { id: string; numero: string; sexe: string; region: string }[];
}

/** Une voix active, avec sa fiche, et un audio validé. */
async function activeVoice(gender: string, region: string, age = '26-40') {
  const speaker = await createSpeaker(db, recruiter);
  await db.query(
    `update public.speakers set status = 'active', gender = $2, age_range = $3, region = $4,
       mother_tongue = 'zarma' where id = $1`,
    [speaker.id, gender, age, region],
  );
  await db.exec(`insert into prive.identities (speaker_id, full_name) values
    ('${speaker.id}', 'Nom secret ${speaker.number}')`);
  const recording = await createRecording(db, speaker.id, sentence);
  await db.query(
    `update public.recordings set qc_status = 'valide', duration_ms = 3600000 where id = $1`,
    [recording],
  );
  return { ...speaker, recording };
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
  sentence = await createSentence(db, 'S0001', 'Ay ga koy habu.');
  // 20 voix : 12 femmes de Niamey, 8 hommes de Dosso.
  for (let i = 0; i < 12; i++) await activeVoice('femme', 'Niamey');
  for (let i = 0; i < 8; i++) await activeVoice('homme', 'Dosso');
});

describe("partition d'examen", () => {
  it('propose 10 % des voix, réparties comme la population, toujours la même liste', async () => {
    const first = await as<Overview>(admin, `select public.exam_overview('dje') as r`);
    expect(first.voix_eligibles).toBe(20);
    expect(first.cible).toBe(2);
    expect(first.examen).toEqual([]);
    expect(first.proposition).toHaveLength(2);
    // Un groupe de chaque : les deux groupes sont représentés.
    expect(new Set(first.proposition.map((p) => p.region))).toEqual(new Set(['Niamey', 'Dosso']));
    const again = await as<Overview>(admin, `select public.exam_overview('dje') as r`);
    expect(again.proposition).toEqual(first.proposition);
  });

  it('est réservée aux admins', async () => {
    await expect(as(recruiter, `select public.exam_overview('dje') as r`)).rejects.toThrow(
      'acces_refuse',
    );
    await expect(
      as(recruiter, `select public.set_exam_speakers('dje', '{}', '{}') as r`),
    ).rejects.toThrow('acces_refuse');
  });

  it("enregistre le choix de l'admin et le note au journal", async () => {
    const { proposition } = await as<Overview>(admin, `select public.exam_overview('dje') as r`);
    await as(admin, `select public.set_exam_speakers('dje', $1, '{}') as r`, [
      proposition.map((p) => p.id),
    ]);
    const after = await as<Overview>(admin, `select public.exam_overview('dje') as r`);
    expect(after.examen.map((e) => e.numero)).toEqual(proposition.map((p) => p.numero));
    expect(after.proposition).toEqual([]); // la cible est atteinte
    const details = await sql<{ ajoutees: string[] }>(
      `select details as r from public.audit_log where action = 'voix_examen'`,
    );
    expect(details.ajoutees).toHaveLength(2);
  });
});

describe('export', () => {
  let exportId: number;

  it('crée une version et une tâche pour le worker ; une seule à la fois', async () => {
    const created = await as<{ id: number; version: number }>(
      admin,
      `select public.request_export('dje', 'varie') as r`,
    );
    exportId = created.id;
    expect(created.version).toBe(1);
    expect(await sql(`select payload as r from public.jobs where kind = 'exporter'`)).toEqual({
      export_id: exportId,
    });
    await expect(as(admin, `select public.request_export('dje', 'varie') as r`)).rejects.toThrow(
      'export_en_cours',
    );
    await expect(
      as(recruiter, `select public.request_export('dje', 'varie') as r`),
    ).rejects.toThrow('acces_refuse');
  });

  it('donne au worker les audios validés, avec leur partie, sans aucune identité', async () => {
    // Un audio corrigé (texte corrigé exporté) et un rejeté (jamais exporté).
    const corrected = await activeVoice('femme', 'Tahoua');
    await db.query(
      `update public.recordings set qc_status = 'corrige', corrected_text = 'Ay ga koy habu sohõ.'
       where id = $1`,
      [corrected.recording],
    );
    const rejected = await activeVoice('homme', 'Tahoua');
    await db.query(
      `update public.recordings set qc_status = 'rejete', reject_reason = 'bruit_fort' where id = $1`,
      [rejected.recording],
    );

    const job = await sql<{
      version: number;
      audios: { voix: string; texte: string; partition: string; duree_ms: number }[];
    }>(`select public.worker_export_start($1) as r`, [exportId]);
    expect(job.version).toBe(1);
    expect(job.audios).toHaveLength(21);
    expect(job.audios.some((a) => a.voix === rejected.number)).toBe(false);
    expect(job.audios.find((a) => a.voix === corrected.number)!.texte).toBe('Ay ga koy habu sohõ.');
    expect(job.audios.filter((a) => a.partition === 'test')).toHaveLength(2);
    expect(JSON.stringify(job)).not.toContain('Nom secret');
    expect(await sql(`select status as r from public.exports where id = $1`, [exportId])).toBe(
      'en_cours',
    );
  });

  it('une fois terminé, fige la partie de chaque voix exportée', async () => {
    const { examen } = await as<Overview>(admin, `select public.exam_overview('dje') as r`);
    const numbers = await sql<string[]>(
      `select array_agg(number order by number) as r from public.speakers where status = 'active'`,
    );
    await sql(
      `select public.worker_export_done($1, $2, 'dje/varie/v001', 'murya/murya-dje-varie') as r`,
      [exportId, { audios: 21, heures: 21, voix_liste: numbers }],
    );
    expect(await sql(`select status as r from public.exports where id = $1`, [exportId])).toBe(
      'pret',
    );
    await expect(
      as(admin, `select public.set_exam_speakers('dje', '{}', $1) as r`, [[examen[0]!.id]]),
    ).rejects.toThrow('partition_figee');
    // Une nouvelle voix n'est pas figée : elle peut être proposée.
    const newcomer = await activeVoice('femme', 'Zinder');
    const overview = await as<Overview>(admin, `select public.exam_overview('dje') as r`);
    expect(overview.examen.every((e) => e.figee)).toBe(true);
    expect(overview.proposition.map((p) => p.numero)).toEqual([newcomer.number]);
  });

  it('sert le dossier d’un export prêt aux seuls admins, et note chaque téléchargement', async () => {
    expect(await as(admin, `select public.export_location($1, 'README.md') as r`, [exportId])).toBe(
      'dje/varie/v001',
    );
    expect(
      await as(recruiter, `select public.export_location($1, 'README.md') as r`, [exportId]),
    ).toBeNull();
    expect(
      await sql(
        `select count(*)::int as r from public.audit_log where action = 'export_telecharge'`,
      ),
    ).toBe(1);
  });

  it("n'est visible que des admins ; les fonctions du worker leur sont fermées", async () => {
    expect(await as(admin, `select count(*)::int as r from public.exports`)).toBe(1);
    expect(await as(recruiter, `select count(*)::int as r from public.exports`)).toBe(0);
    await expect(
      as(admin, `select public.worker_export_start($1) as r`, [exportId]),
    ).rejects.toThrow('permission denied');
  });

  it('numérote les versions suivantes et note un échec', async () => {
    const second = await as<{ id: number; version: number }>(
      admin,
      `select public.request_export('dje', 'varie') as r`,
    );
    expect(second.version).toBe(2);
    await sql(`select public.worker_export_failed($1, 'R2 indisponible') as r`, [second.id]);
    expect(await sql(`select status as r from public.exports where id = $1`, [second.id])).toBe(
      'echec',
    );
    const third = await as<{ version: number }>(
      admin,
      `select public.request_export('dje', 'varie') as r`,
    );
    expect(third.version).toBe(3);
  });
});
