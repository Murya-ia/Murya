// Toutes les langues du Niger : chaque membre ne travaille que dans ses langues, les admins
// dans toutes ; les nouvelles langues ont leur accord et leurs audios.

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createMember, createTestDb } from './helpers/db';

let db: PGlite;
let admin: string;
let zarma: string;
let kanouri: string;

async function sql<T>(query: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ r: T }>(query, params);
  return rows[0]!.r;
}

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, () => sql<T>(query, params));
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin'], []);
  zarma = await createMember(db, 'raphiou', ['recruteur', 'verificateur'], ['dje']);
  kanouri = await createMember(db, 'ousmane', ['recruteur', 'verificateur'], ['kby']);
});

describe('les langues du Niger', () => {
  it('sont toutes enregistrées, trois actives', async () => {
    const { rows } = await db.query<{ code: string; active: boolean }>(
      `select code, active from public.languages order by code`,
    );
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.active).map((r) => r.code)).toEqual(['dje', 'kby', 'ttq']);
  });

  it("ont chacune un nom de colonne pour l'import", async () => {
    expect(
      await sql<string>(`select mother_tongue_code as r from public.languages where code = 'ttq'`),
    ).toBe('tamasheq');
  });
});

describe('les langues des membres', () => {
  it('limitent les actions aux langues du membre', async () => {
    await expect(as(zarma, `select public.review_counts('dje') as r`)).resolves.toBeTruthy();
    await expect(as(zarma, `select public.review_counts('kby') as r`)).rejects.toThrow(
      'langue_non_attribuee',
    );
    await expect(as(kanouri, `select public.review_counts('kby') as r`)).resolves.toBeTruthy();
  });

  it("laissent l'admin travailler dans toutes les langues", async () => {
    await expect(as(admin, `select public.review_counts('ttq') as r`)).resolves.toBeTruthy();
    await expect(as(admin, `select public.review_counts('hau') as r`)).resolves.toBeTruthy();
  });

  it("refusent une langue inactive, même attribuée, sauf à l'admin", async () => {
    const haoussa = await createMember(db, 'haoussa', ['verificateur'], ['hau']);
    await expect(as(haoussa, `select public.review_counts('hau') as r`)).rejects.toThrow(
      'langue_non_attribuee',
    );
    await db.exec(`update public.languages set active = true where code = 'hau'`);
    await expect(as(haoussa, `select public.review_counts('hau') as r`)).resolves.toBeTruthy();
    await db.exec(`update public.languages set active = false where code = 'hau'`);
  });

  it("refusent les personnes hors de l'équipe", async () => {
    const outsider = await createMember(db, 'exterieur', null);
    await expect(as(outsider, `select public.review_counts('dje') as r`)).rejects.toThrow(
      'acces_refuse',
    );
  });

  it('refusent une langue inconnue', async () => {
    await expect(
      db.query(`update public.team_members set languages = '{xyz}' where user_id = $1`, [zarma]),
    ).rejects.toThrow('langue_inconnue');
  });

  it('se choisissent à la création du membre', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('zidane@test.murya') returning id`,
    );
    const id = rows[0]!.id;
    await as(admin, `select public.add_team_member($1, 'Zidane', '{verificateur}', '{ttq}') as r`, [
      id,
    ]);
    expect(
      await sql<string[]>(`select languages as r from public.team_members where user_id = $1`, [
        id,
      ]),
    ).toEqual(['ttq']);
    const directory = await as<{ nom: string; langues: string[] }[]>(
      admin,
      `select public.team_directory() as r`,
    );
    expect(directory.find((m) => m.nom === 'Zidane')?.langues).toEqual(['ttq']);
  });
});

describe('les liens des voix', () => {
  it('se créent seulement dans une langue du recruteur', async () => {
    await expect(
      as(kanouri, `select count(*) as r from public.create_invite('Fatima', 'kby')`),
    ).resolves.toBe(1);
    await expect(
      as(kanouri, `select count(*) as r from public.create_invite('Fatima', 'dje')`),
    ).rejects.toThrow('langue_non_attribuee');
  });

  it("ne s'ajoutent pas directement dans une autre langue", async () => {
    await expect(
      asUser(db, kanouri, () =>
        db.query(
          `insert into public.invites (token_hash, language_code, recruiter_id, label, expires_at)
           values ('\\x00', 'dje', $1, 'Test', now() + interval '1 day')`,
          [kanouri],
        ),
      ),
    ).rejects.toThrow();
  });

  it("rangent l'accord oral dans la langue de la voix", async () => {
    await db.exec(
      `insert into public.consent_versions (language_code, version, texts, published_at)
       values ('kby', 1, '{"fr": {"intro": "Accord"}}', now())`,
    );
    const invite = await as<string>(
      kanouri,
      `select invite_id as r from public.create_invite('Kaltouma', 'kby')`,
    );
    await as(kanouri, `select public.record_oral_consent($1, 'Kaltouma', null, 'k') as r`, [
      invite,
    ]);
    expect(
      await sql<{ ui: string; consent: string }>(
        `select jsonb_build_object('ui', s.ui_language, 'consent', c.ui_language) as r
         from public.speakers s join public.consents c on c.speaker_id = s.id
         where s.invite_id = $1`,
        [invite],
      ),
    ).toEqual({ ui: 'kby', consent: 'kby' });
  });
});

describe("les audios de l'accord", () => {
  it('acceptent les langues enregistrées et le français', async () => {
    const consent = await sql<number>(
      `select id as r from public.consent_versions where language_code = 'kby'`,
    );
    await as(admin, `select public.set_consent_audio($1, 'kby', 'complet', 'a/kby.webm') as r`, [
      consent,
    ]);
    await as(admin, `select public.set_consent_audio($1, 'fr', 'complet', 'a/fr.webm') as r`, [
      consent,
    ]);
    await expect(
      as(admin, `select public.set_consent_audio($1, 'xyz', 'complet', 'a/x.webm') as r`, [
        consent,
      ]),
    ).rejects.toThrow('requete_invalide');
  });
});
