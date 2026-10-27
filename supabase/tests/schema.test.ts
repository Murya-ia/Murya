import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMember, createSentence, createSpeaker, createTestDb } from './helpers/db';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

describe('migrations', () => {
  it('activent la sécurité au niveau des lignes sur toutes les tables', async () => {
    const { rows } = await db.query<{ table: string }>(`
      select n.nspname || '.' || c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname in ('public', 'prive') and not c.relrowsecurity
    `);
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it('installent la langue zarma et les réglages par défaut', async () => {
    const { rows } = await db.query<{ value: unknown }>(
      `select public.get_setting('dje', 'batch_size') as value`,
    );
    expect(rows[0]!.value).toBe(150);
  });
});

describe('réglages', () => {
  it('une valeur propre à une langue remplace la valeur globale', async () => {
    await db.exec(
      `insert into public.settings (scope, key, value) values ('dje', 'target_reads', '2')`,
    );
    const { rows } = await db.query<{ dje: unknown; hau: unknown }>(`
      select public.get_setting('dje', 'target_reads') as dje,
             public.get_setting('hau', 'target_reads') as hau
    `);
    expect(rows[0]).toEqual({ dje: 2, hau: 3 });
  });
});

describe('numéros de voix', () => {
  it('sont séquentiels et propres à chaque langue', async () => {
    await db.exec(
      `insert into public.languages (code, name_fr, active) values ('hau', 'Haoussa', true)`,
    );
    const recruiter = await createMember(db, 'numeros', ['recruteur']);
    expect((await createSpeaker(db, recruiter, 'dje')).number).toBe('V001');
    expect((await createSpeaker(db, recruiter, 'dje')).number).toBe('V002');
    expect((await createSpeaker(db, recruiter, 'hau')).number).toBe('V001');
  });
});

describe('équipe', () => {
  it('refuse un troisième admin', async () => {
    await createMember(db, 'admin1', ['admin']);
    await createMember(db, 'admin2', ['admin', 'verificateur']);
    await expect(createMember(db, 'admin3', ['admin'])).rejects.toThrow('Deux admins au maximum');
  });

  it('refuse un rôle inconnu', async () => {
    await expect(createMember(db, 'inconnu', ['chef'])).rejects.toThrow();
  });
});

describe('phrases', () => {
  it('normalisent le texte en Unicode NFC', async () => {
    // « ẽ » écrit en deux caractères (e + tilde combinant) devient un seul caractère.
    const id = await createSentence(db, 'S9001', '  Nẽ ga ka  ');
    const { rows } = await db.query<{ text: string }>(
      `select text from public.sentences where id = $1`,
      [id],
    );
    expect(rows[0]!.text).toBe('Nẽ ga ka');
  });

  it('créent une nouvelle version à chaque changement de texte, sans perdre l’historique', async () => {
    const id = await createSentence(db, 'S9002', 'Ay go koy');
    await db.query(`update public.sentences set theme = 'marché' where id = $1`, [id]);
    await db.query(`update public.sentences set text = 'Ay ga koy' where id = $1`, [id]);

    const { rows } = await db.query<{ version: number; text: string }>(
      `select version, text from public.sentence_versions where sentence_id = $1 order by version`,
      [id],
    );
    expect(rows).toEqual([
      { version: 1, text: 'Ay go koy' },
      { version: 2, text: 'Ay ga koy' },
    ]);
  });

  it('comptent les mots (pour la vitesse de lecture)', async () => {
    const id = await createSentence(db, 'S9003', 'Ay   ga  koy habu');
    const { rows } = await db.query<{ word_count: number }>(
      `select word_count from public.sentences where id = $1`,
      [id],
    );
    expect(rows[0]!.word_count).toBe(4);
  });

  it('refusent un code inutilisable dans un nom de fichier', async () => {
    await expect(createSentence(db, 'S 12/3', 'Texte')).rejects.toThrow();
  });
});

describe('consentement', () => {
  it('une version publiée ne peut plus être modifiée ni supprimée', async () => {
    const { rows } = await db.query<{ id: number }>(`
      insert into public.consent_versions (language_code, version, texts, published_at)
      values ('dje', 1, '{"fr": {"intro": "Texte"}}', now()) returning id
    `);
    const id = rows[0]!.id;
    await expect(
      db.query(`update public.consent_versions set texts = '{}' where id = $1`, [id]),
    ).rejects.toThrow('créez une nouvelle version');
    await expect(
      db.query(`delete from public.consent_versions where id = $1`, [id]),
    ).rejects.toThrow('créez une nouvelle version');
  });

  it('un brouillon peut encore être modifié', async () => {
    const { rows } = await db.query<{ id: number }>(`
      insert into public.consent_versions (language_code, version, texts)
      values ('dje', 2, '{"fr": {"intro": "Brouillon"}}') returning id
    `);
    await db.query(
      `update public.consent_versions set texts = '{"fr": {"intro": "Corrigé"}}' where id = $1`,
      [rows[0]!.id],
    );
  });
});

describe('enregistrements', () => {
  it('un même UUID ne peut pas être inséré deux fois', async () => {
    const recruiter = await createMember(db, 'uuid', ['recruteur']);
    const speaker = await createSpeaker(db, recruiter);
    const sentence = await createSentence(db, 'S9010', 'Texte');
    const insert = `insert into public.recordings (id, speaker_id, sentence_id, sentence_version, take, kind, storage_key)
                    values ('00000000-0000-4000-8000-000000000001', $1, $2, 1, 1, 'varie', $3)`;
    await db.query(insert, [speaker.id, sentence, 'a.wav']);
    await expect(db.query(insert, [speaker.id, sentence, 'b.wav'])).rejects.toThrow();
  });

  it('un rejet exige un motif, une correction exige un texte', async () => {
    const recruiter = await createMember(db, 'motif', ['recruteur']);
    const speaker = await createSpeaker(db, recruiter);
    const sentence = await createSentence(db, 'S9011', 'Texte');
    const insert = (status: string) =>
      db.query(
        `insert into public.recordings (id, speaker_id, sentence_id, sentence_version, take, kind, storage_key, qc_status)
         values (gen_random_uuid(), $1, $2, 1, 1, 'varie', gen_random_uuid()::text, $3)`,
        [speaker.id, sentence, status],
      );
    await expect(insert('rejete')).rejects.toThrow();
    await expect(insert('corrige')).rejects.toThrow();
  });
});
