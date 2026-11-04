// Corrections du test d'intrusion : qui voit les voix et leurs audios, et dans quelles langues
// on peut valider. Chaque test rejoue une attaque qui avait marché.

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
let otherRecruiter: string;
let verifier: string;
let quality: string;
let noRole: string;
let zarmaAudio: string;
let testAudio: string;
let tamasheqAudio: string;

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T[]> {
  return asUser(db, user, async () => (await db.query<T>(query, params)).rows);
}

const audioKey = (user: string, id: string) =>
  as<{ k: string | null }>(user, `select public.team_audio_key($1) as k`, [id]).then(
    (rows) => rows[0]!.k,
  );

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin'], []);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
  otherRecruiter = await createMember(db, 'autre', ['recruteur']);
  verifier = await createMember(db, 'verificateur', ['verificateur']);
  quality = await createMember(db, 'qualite', ['qualite']);
  noRole = await createMember(db, 'sans-role', []);
  const tamasheqRecruiter = await createMember(db, 'zidane', ['recruteur'], ['ttq']);

  const speaker = await createSpeaker(db, recruiter);
  zarmaAudio = await createRecording(
    db,
    speaker.id,
    await createSentence(db, 'S1', 'Ay ga koy habu.'),
  );
  testAudio = await createRecording(
    db,
    speaker.id,
    await createSentence(db, 'T1', 'Phrase de test.', { isTest: true }),
  );
  tamasheqAudio = await createRecording(
    db,
    (await createSpeaker(db, tamasheqRecruiter, 'ttq')).id,
    await createSentence(db, 'T2', 'Tekst.', { language: 'ttq' }),
  );
});

describe('écouter les audios', () => {
  it('le vérificateur écoute les audios de ses langues', async () => {
    expect(await audioKey(verifier, zarmaAudio)).toBeTruthy();
    expect(await audioKey(quality, zarmaAudio)).toBeTruthy();
    expect(await audioKey(admin, tamasheqAudio)).toBeTruthy();
  });

  it("le vérificateur n'écoute pas une langue qui n'est pas la sienne", async () => {
    expect(await audioKey(verifier, tamasheqAudio)).toBeNull();
    expect(
      await as(verifier, `select id from public.recordings where id = $1`, [tamasheqAudio]),
    ).toEqual([]);
  });

  it('un membre sans rôle n’écoute rien', async () => {
    expect(await audioKey(noRole, zarmaAudio)).toBeNull();
    expect(await audioKey(noRole, testAudio)).toBeNull();
  });

  it("un recruteur n'écoute pas les recrues d'un autre, même leur test", async () => {
    expect(await audioKey(otherRecruiter, zarmaAudio)).toBeNull();
    expect(await audioKey(otherRecruiter, testAudio)).toBeNull();
  });

  it('un recruteur écoute le test de sa recrue, mais pas ses autres audios', async () => {
    expect(await audioKey(recruiter, testAudio)).toBeTruthy();
    expect(await audioKey(recruiter, zarmaAudio)).toBeNull();
  });
});

describe('voir les fiches des voix', () => {
  it('un membre sans rôle ne voit aucune fiche', async () => {
    expect(await as(noRole, `select id from public.speakers`)).toEqual([]);
  });

  it('un recruteur voit seulement ses recrues', async () => {
    expect(await as(recruiter, `select id from public.speakers`)).toHaveLength(1);
    expect(await as(otherRecruiter, `select id from public.speakers`)).toEqual([]);
  });

  it('un vérificateur voit les fiches de ses langues', async () => {
    const rows = await as<{ language_code: string }>(
      verifier,
      `select distinct language_code from public.speakers`,
    );
    expect(rows).toEqual([{ language_code: 'dje' }]);
  });

  it('un admin voit toutes les langues', async () => {
    expect(await as(admin, `select id from public.speakers`)).toHaveLength(2);
  });
});

describe('agir sur un audio', () => {
  it("refuse de valider un audio d'une autre langue, même avec son identifiant", async () => {
    await expect(
      as(verifier, `select public.review_submit($1, 'valide')`, [tamasheqAudio]),
    ).rejects.toThrow('langue_non_attribuee');
    await expect(
      as(quality, `select public.double_review_submit($1, 'valide')`, [tamasheqAudio]),
    ).rejects.toThrow('langue_non_attribuee');
  });

  it('valide normalement dans sa langue', async () => {
    await as(verifier, `select public.review_submit($1, 'valide')`, [zarmaAudio]);
    const { rows } = await db.query<{ qc_status: string }>(
      `select qc_status from public.recordings where id = $1`,
      [zarmaAudio],
    );
    expect(rows[0]!.qc_status).toBe('valide');
  });

  it('un audio inconnu garde son message habituel', async () => {
    await expect(
      as(verifier, `select public.review_submit(gen_random_uuid(), 'valide')`),
    ).rejects.toThrow('enregistrement_inconnu');
  });
});

describe('mots décidés', () => {
  const decide = (user: string, language: string, word: string) =>
    as(
      user,
      `insert into public.orthography_decisions (language_code, word, chosen_spelling, decided_by)
       values ($1, $2, $2, auth.uid())`,
      [language, word],
    );

  it('seulement dans ses langues (admin : toutes)', async () => {
    await decide(quality, 'dje', 'koy');
    await expect(decide(quality, 'ttq', 'mot')).rejects.toThrow(/row-level security/);
    await decide(admin, 'ttq', 'mot');
  });
});

describe('accord oral : contrôle avant d’écrire le fichier', () => {
  let invite: string;

  beforeAll(async () => {
    const rows = await as<{ invite_id: string }>(
      recruiter,
      `select invite_id from public.create_invite('Mariama', 'dje')`,
    );
    invite = rows[0]!.invite_id;
  });

  it('accepte le recruteur du lien et les admins', async () => {
    await as(recruiter, `select public.check_oral_consent($1)`, [invite]);
    await as(admin, `select public.check_oral_consent($1)`, [invite]);
  });

  it('refuse un autre recruteur et un lien inconnu', async () => {
    await expect(
      as(otherRecruiter, `select public.check_oral_consent($1)`, [invite]),
    ).rejects.toThrow('acces_refuse');
    await expect(
      as(recruiter, `select public.check_oral_consent(gen_random_uuid())`),
    ).rejects.toThrow('lien_inconnu');
  });
});

describe('sans compte', () => {
  it('ne peut plus appeler create_invite ni is_member', async () => {
    await expect(
      asUser(db, null, () => db.query(`select * from public.create_invite('x', 'dje')`)),
    ).rejects.toThrow(/permission denied for function create_invite/);
    await expect(asUser(db, null, () => db.query(`select public.is_member()`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("is_member dit si la session est celle d'un membre actif", async () => {
    const rows = await as<{ m: boolean }>(noRole, `select public.is_member() as m`);
    expect(rows[0]!.m).toBe(true);
    const outsider = await createMember(db, 'dehors', null);
    const out = await as<{ m: boolean }>(outsider, `select public.is_member() as m`);
    expect(out[0]!.m).toBe(false);
  });
});
