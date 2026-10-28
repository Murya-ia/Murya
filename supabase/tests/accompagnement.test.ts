// Accompagnement des personnes qui lisent peu (spec §3.2) : audios de l'accord, et mode
// « écouter puis répéter » (audio modèle de chaque phrase).

import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createMember, createSentence, createTestDb } from './helpers/db';

let db: PGlite;
let admin: string;
let recruiter: string;
let consentId: number;
const sentences: number[] = [];
const POINTS = ['enregistrement', 'entrainement_ia', 'usage_commercial', 'metadonnees', 'majeur'];

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function sql<T>(query: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ r: T }>(query, params);
  return rows[0]!.r;
}

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, () => sql<T>(query, params));
}

/** Une voix prête (accord, fiche, tutoriel), au statut voulu. */
async function voice(name: string, status = 'active') {
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
  await db.query(`select public.voice_profile($1, 'homme', '41-60', 'Dosso', 'zarma', null)`, [
    tokenHash,
  ]);
  await db.query(`select public.voice_tutorial_done($1)`, [tokenHash]);
  const id = await sql<string>(
    `select s.id as r from public.speakers s join public.invites i on i.id = s.invite_id
     where i.token_hash = decode($1, 'hex')`,
    [tokenHash],
  );
  await db.query(`update public.speakers set status = $2 where id = $1`, [id, status]);
  return { id, tokenHash };
}

/** Un audio reçu d'une voix pour une phrase, avec la décision de l'équipe. */
async function recording(speakerId: string, sentenceId: number, qc = 'valide') {
  const id = randomUUID();
  await db.query(
    `insert into public.recordings (id, speaker_id, sentence_id, sentence_version, take, kind,
       storage_key, upload_status, received_at, qc_status, reviewed_at, reject_reason)
     values ($1, $2, $3, 1, 1, 'varie', $5, 'recu', now(), $4, now(),
             case when $4 = 'rejete' then 'bruit_fort' end)`,
    [id, speakerId, sentenceId, qc, `dje/varie/${id}.wav`],
  );
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
  for (let i = 1; i <= 4; i++) sentences.push(await createSentence(db, `S000${i}`, `Phrase ${i}.`));
});

describe("audios de l'accord", () => {
  it("un admin ajoute un audio à l'accord publié ; l'app de la voix le reçoit", async () => {
    await expect(
      as(recruiter, `select public.set_consent_audio($1, 'dje', 'complet', 'accord/x.m4a') as r`, [
        consentId,
      ]),
    ).rejects.toThrow('acces_refuse');
    await as(
      admin,
      `select public.set_consent_audio($1, 'dje', 'complet', 'accord/v1-a.m4a') as r`,
      [consentId],
    );
    // Remplacé, pas ajouté en double.
    await as(
      admin,
      `select public.set_consent_audio($1, 'dje', 'complet', 'accord/v1-b.m4a') as r`,
      [consentId],
    );
    await as(
      admin,
      `select public.set_consent_audio($1, 'dje', 'rappel', 'accord/v1-r.m4a') as r`,
      [consentId],
    );
    const { tokenHash } = await voice('Écoute');
    const session = await sql<{ consentement: { audios: unknown } }>(
      `select public.voice_session($1) as r`,
      [tokenHash],
    );
    expect(session.consentement.audios).toEqual({
      dje: { complet: 'accord/v1-b.m4a', rappel: 'accord/v1-r.m4a' },
    });
    expect(
      await as(recruiter, `select public.consent_audio_key($1, 'dje', 'rappel') as r`, [consentId]),
    ).toBe('accord/v1-r.m4a');
  });
});

describe('mode « écouter puis répéter »', () => {
  let reader: { id: string; tokenHash: string };
  let listener: { id: string; tokenHash: string };

  beforeAll(async () => {
    reader = await voice('Lectrice');
    listener = await voice('Auditeur');
  });

  it('activé par le recruteur de la voix ou un admin, et annoncé à l’app', async () => {
    const stranger = await createMember(db, 'autre', ['recruteur']);
    await expect(
      as(stranger, `select public.set_assisted_reading($1, true) as r`, [listener.id]),
    ).rejects.toThrow('acces_refuse');
    await as(recruiter, `select public.set_assisted_reading($1, true) as r`, [listener.id]);
    const session = await sql<{ voix: { repetition: boolean } }>(
      `select public.voice_session($1) as r`,
      [listener.tokenHash],
    );
    expect(session.voix.repetition).toBe(true);
  });

  it("sans aucun audio modèle, l'app l'annonce au lieu d'un lot vide", async () => {
    const batch = await sql<{ etape: string }>(`select public.voice_sentences($1) as r`, [
      listener.tokenHash,
    ]);
    expect(batch.etape).toBe('sans_modele');
  });

  it('ne reçoit que des phrases qui ont un modèle, et entend de préférence la voix principale', async () => {
    // Phrases 1 et 2 lues par une autre voix ; la phrase 2 aussi par la voix principale.
    await db.exec(`delete from public.assignments`);
    await recording(reader.id, sentences[0]!);
    await recording(reader.id, sentences[1]!);
    const principal = await voice('Principale');
    await db.query(`update public.speakers set is_principal = true where id = $1`, [principal.id]);
    const best = await recording(principal.id, sentences[1]!);
    // Un audio rejeté ne sert jamais de modèle (phrase 3).
    await recording(reader.id, sentences[2]!, 'rejete');

    const batch = await sql<{ etape: string; phrases: { id: number }[] }>(
      `select public.voice_sentences($1) as r`,
      [listener.tokenHash],
    );
    expect(batch.etape).toBe('lot');
    expect(batch.phrases.map((p) => p.id).sort()).toEqual([sentences[0], sentences[1]].sort());
    expect(
      await sql(`select public.voice_model_key($1, $2) as r`, [listener.tokenHash, sentences[1]]),
    ).toBe(`dje/varie/${best}.wav`);
    await expect(
      sql(`select public.voice_model_key($1, $2) as r`, [listener.tokenHash, sentences[3]]),
    ).rejects.toThrow('phrase_non_attribuee');
    // Une voix qui lit elle-même n'a pas de modèle.
    expect(
      await sql(`select public.voice_model_key($1, $2) as r`, [reader.tokenHash, sentences[0]]),
    ).toBeNull();
  });
});
