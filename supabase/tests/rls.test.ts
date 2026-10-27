// Tests des règles d'accès (RLS) : qui voit quoi via l'API Supabase.

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
let recruiterA: string; // recrute et vérifie
let recruiterB: string;
let stranger: string; // compte connecté mais pas membre de l'équipe
let speakerOfA: string;
let speakerOfB: string;
let testRecordingOfA: string;
let normalRecordingOfA: string;
let normalRecordingOfB: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  recruiterA = await createMember(db, 'awa', ['recruteur', 'verificateur']);
  recruiterB = await createMember(db, 'bachir', ['recruteur', 'verificateur']);
  stranger = await createMember(db, 'inconnu', null);

  speakerOfA = (await createSpeaker(db, recruiterA)).id;
  speakerOfB = (await createSpeaker(db, recruiterB)).id;

  const testSentence = await createSentence(db, 'T001', 'Phrase de test', { isTest: true });
  const normalSentence = await createSentence(db, 'S0001', 'Phrase normale');
  testRecordingOfA = await createRecording(db, speakerOfA, testSentence);
  normalRecordingOfA = await createRecording(db, speakerOfA, normalSentence);
  normalRecordingOfB = await createRecording(db, speakerOfB, normalSentence);

  for (const [recruiter, label] of [
    [recruiterA, 'Invitation A'],
    [recruiterB, 'Invitation B'],
  ] as const) {
    await db.query(
      `insert into public.invites (token_hash, language_code, recruiter_id, label, expires_at)
       values (sha256(gen_random_uuid()::text::bytea), 'dje', $1, $2, now() + interval '90 days')`,
      [recruiter, label],
    );
  }
  await db.query(`insert into prive.identities (speaker_id, full_name) values ($1, 'Nom Secret')`, [
    speakerOfA,
  ]);
});

const visibleRecordings = (userId: string) =>
  asUser(db, userId, async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.recordings`);
    return rows.map((r) => r.id).sort();
  });

describe('visiteur non connecté (anon)', () => {
  it("n'a accès à aucune table", async () => {
    await asUser(db, null, async () => {
      await expect(db.query(`select * from public.speakers`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from public.languages`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('compte connecté mais hors équipe', () => {
  it('ne voit rien', async () => {
    await asUser(db, stranger, async () => {
      expect((await db.query(`select * from public.languages`)).rows).toEqual([]);
      expect((await db.query(`select * from public.speakers`)).rows).toEqual([]);
      expect((await db.query(`select * from public.recordings`)).rows).toEqual([]);
    });
  });
});

describe('enregistrements (spec §5.4)', () => {
  it("un vérificateur ne voit pas les audios des voix qu'il a recrutées, sauf leur test", async () => {
    expect(await visibleRecordings(recruiterA)).toEqual(
      [testRecordingOfA, normalRecordingOfB].sort(),
    );
    expect(await visibleRecordings(recruiterB)).toEqual(
      [testRecordingOfA, normalRecordingOfA].sort(),
    );
  });

  it('un admin voit tout', async () => {
    expect(await visibleRecordings(admin)).toEqual(
      [testRecordingOfA, normalRecordingOfA, normalRecordingOfB].sort(),
    );
  });

  it('personne ne peut écrire directement, même un admin (les écritures passeront par des fonctions)', async () => {
    for (const user of [recruiterB, admin]) {
      await asUser(db, user, async () => {
        await expect(
          db.query(`update public.recordings set qc_status = 'valide' where id = $1`, [
            normalRecordingOfA,
          ]),
        ).rejects.toThrow(/permission denied/);
      });
    }
  });
});

describe('invitations', () => {
  it('un recruteur ne voit que les siennes', async () => {
    const labels = await asUser(db, recruiterA, async () =>
      (await db.query<{ label: string }>(`select label from public.invites`)).rows.map(
        (r) => r.label,
      ),
    );
    expect(labels).toEqual(['Invitation A']);
  });

  it('un admin les voit toutes', async () => {
    const count = await asUser(
      db,
      admin,
      async () => (await db.query(`select * from public.invites`)).rows.length,
    );
    expect(count).toBe(2);
  });
});

describe('identités (spec §8.3)', () => {
  it("ne sont lisibles par personne via l'API, même un admin", async () => {
    for (const user of [recruiterA, admin]) {
      await asUser(db, user, async () => {
        await expect(db.query(`select * from prive.identities`)).rejects.toThrow(
          /permission denied/,
        );
      });
    }
  });
});

describe('fonctions internes', () => {
  it("l'attribution des numéros de voix n'est pas appelable depuis l'API", async () => {
    await asUser(db, admin, async () => {
      await expect(db.query(`select public.next_speaker_number('dje')`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});

describe('référentiels', () => {
  it('un admin peut modifier une phrase, un vérificateur non', async () => {
    await asUser(db, recruiterA, async () => {
      const { affectedRows } = await db.query(
        `update public.sentences set theme = 'x' where code = 'S0001'`,
      );
      expect(affectedRows).toBe(0);
    });
    await asUser(db, admin, async () => {
      const { affectedRows } = await db.query(
        `update public.sentences set theme = 'santé' where code = 'S0001'`,
      );
      expect(affectedRows).toBe(1);
    });
  });
});
