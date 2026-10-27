// Tests de l'espace équipe (J3) : validation des tests, écoute et vérification, import des
// phrases, consentement oral. Les fonctions sont appelées comme le fait l'espace équipe,
// avec le rôle de la personne connectée.

import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
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
let awa: string; // recrute et vérifie
let bachir: string; // recrute et vérifie
let speakerOfAwa: string;
let testSentence: number;
let sentences: number[];

async function as<T>(user: string, sql: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, async () => {
    const { rows } = await db.query<{ r: T }>(sql, params);
    return rows[0]!.r;
  });
}

const claim = (user: string, mode = 'premiere') =>
  as<{ id: string; phrase: { code: string } } | null>(
    user,
    `select public.review_claim('dje', $1) as r`,
    [mode],
  );

const submit = (user: string, id: string, decision: string, extra: (string | null)[] = []) =>
  as(user, `select public.review_submit($1, $2, $3, $4, $5) as r`, [
    id,
    decision,
    extra[0] ?? null,
    extra[1] ?? null,
    extra[2] ?? null,
  ]);

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  quality = await createMember(db, 'qualite', ['qualite']);
  awa = await createMember(db, 'awa', ['recruteur', 'verificateur']);
  bachir = await createMember(db, 'bachir', ['recruteur', 'verificateur']);
  speakerOfAwa = (await createSpeaker(db, awa)).id;
  testSentence = await createSentence(db, 'T001', 'Phrase de test', { isTest: true });
  sentences = [];
  for (let i = 1; i <= 4; i++) sentences.push(await createSentence(db, `S000${i}`, `Phrase ${i}`));
});

describe('validation du test (spec §3.5)', () => {
  it('seul le recruteur de la voix (ou un admin) peut valider, avec un message pour refaire', async () => {
    const speaker = (await createSpeaker(db, awa)).id;
    await db.query(`update public.speakers set status = 'test_en_attente' where id = $1`, [
      speaker,
    ]);
    const call = (user: string, accepted: boolean, message: string | null) =>
      as(user, `select public.review_speaker_test($1, $2, $3) as r`, [speaker, accepted, message]);

    await expect(call(bachir, true, null)).rejects.toThrow('acces_refuse');
    await expect(call(awa, false, '  ')).rejects.toThrow('message_obligatoire');
    expect(await call(awa, false, 'Parlez plus près du téléphone')).toBe('test_a_refaire');
    await expect(call(awa, true, null)).rejects.toThrow('test_pas_en_attente');

    await db.query(`update public.speakers set status = 'test_en_attente' where id = $1`, [
      speaker,
    ]);
    expect(await call(awa, true, 'Parfait')).toBe('active');
  });
});

describe('écoute', () => {
  it("donne la clé d'un audio seulement à qui a le droit de l'écouter", async () => {
    const normal = await createRecording(db, speakerOfAwa, sentences[0]!);
    const test = await createRecording(db, speakerOfAwa, testSentence);
    const key = (user: string, id: string) =>
      as<string | null>(user, `select public.team_audio_key($1) as r`, [id]);
    expect(await key(bachir, normal)).toMatch(/^test\//);
    expect(await key(awa, normal)).toBeNull(); // sa propre recrue
    expect(await key(awa, test)).toMatch(/^test\//); // sauf le test, qu'il doit valider
    await db.query(`delete from public.recordings where id in ($1, $2)`, [normal, test]);
  });
});

describe('file de vérification (spec §5.4)', () => {
  let speakerOfBachir: string;
  let oldest: string;
  let suspect: string;
  let recent: string;

  beforeAll(async () => {
    speakerOfBachir = (await createSpeaker(db, bachir)).id;
    oldest = await createRecording(db, speakerOfBachir, sentences[0]!);
    suspect = await createRecording(db, speakerOfBachir, sentences[1]!);
    recent = await createRecording(db, speakerOfBachir, sentences[2]!);
    await db.query(
      `update public.recordings set received_at = now() - interval '3 days' where id = $1`,
      [oldest],
    );
    await db.query(
      `update public.recordings set received_at = now() - interval '1 day', suspect = true where id = $1`,
      [suspect],
    );
    await db.query(
      `insert into public.assignments (speaker_id, sentence_id, position) values ($1, $2, 1)`,
      [speakerOfBachir, sentences[0]],
    );
    await db.query(`update public.sentences set pending_reads = 1 where id = $1`, [sentences[0]]);
  });

  it('les suspects passent en premier, puis les plus anciens ; jamais ses propres recrues', async () => {
    expect(await claim(bachir)).toBeNull(); // tout vient de ses recrues
    const first = await claim(awa);
    expect(first!.id).toBe(suspect);
    // Recharger la page redonne le même audio réservé.
    expect((await claim(awa))!.id).toBe(suspect);
  });

  it('deux vérificateurs ne reçoivent jamais le même audio', async () => {
    const other = await claim(admin);
    expect(other!.id).toBe(oldest);
    // L'audio réservé par Awa ne peut pas être noté par quelqu'un d'autre.
    await expect(submit(admin, suspect, 'valide')).rejects.toThrow('reserve_par_autre');
    await expect(submit(quality, suspect, 'valide')).rejects.toThrow('reserve_par_autre');
  });

  it('valide : compte une lecture de plus pour la phrase', async () => {
    await submit(admin, oldest, 'valide');
    const { rows } = await db.query<{ validated_reads: number; pending_reads: number }>(
      `select validated_reads, pending_reads from public.sentences where id = $1`,
      [sentences[0]],
    );
    expect(rows[0]).toEqual({ validated_reads: 1, pending_reads: 0 });
    await expect(submit(admin, oldest, 'rejete', [null, 'bruit_fort'])).rejects.toThrow(
      'deja_verifie',
    );
  });

  it('à corriger : le texte corrigé est gardé sur l’audio, la phrase reste intacte', async () => {
    await expect(submit(awa, suspect, 'corrige')).rejects.toThrow('texte_corrige_obligatoire');
    await submit(awa, suspect, 'corrige', ['  Phrase deux corrigée ']);
    const { rows } = await db.query<{ corrected_text: string; text: string }>(
      `select r.corrected_text, s.text from public.recordings r join public.sentences s on s.id = r.sentence_id where r.id = $1`,
      [suspect],
    );
    expect(rows[0]).toEqual({ corrected_text: 'Phrase deux corrigée', text: 'Phrase 2' });
  });

  it('doute : part chez le responsable qualité, qui tranche (arbitrage)', async () => {
    expect((await claim(awa))!.id).toBe(recent);
    await submit(awa, recent, 'doute', [null, null, 'Deux voix ?']);
    await expect(claim(awa, 'doute')).rejects.toThrow('acces_refuse');
    const item = await as<{ id: string; avis: { commentaire: string }[] }>(
      quality,
      `select public.review_claim('dje', 'doute') as r`,
    );
    expect(item.id).toBe(recent);
    expect(item.avis[0]!.commentaire).toBe('Deux voix ?');
    await expect(submit(quality, recent, 'rejete')).rejects.toThrow('motif_obligatoire');
    await submit(quality, recent, 'rejete', [null, 'autre_voix', 'Bruit de télé']);
    const { rows } = await db.query<{ kind: string }>(
      `select kind from public.reviews where recording_id = $1 order by id`,
      [recent],
    );
    expect(rows.map((r) => r.kind)).toEqual(['premiere', 'arbitrage']);
  });

  it('un audio rejeté apparaît dans la liste « À refaire » de la voix (spec §3.7)', async () => {
    const token = 'jeton-de-test-bachir';
    const { rows } = await db.query<{ id: string }>(
      `insert into public.invites (token_hash, language_code, recruiter_id, label, expires_at)
       values (sha256(convert_to($1, 'UTF8')), 'dje', $2, 'x', now() + interval '1 day') returning id`,
      [token, bachir],
    );
    await db.query(
      `insert into public.consent_versions (language_code, version, texts, published_at)
       values ('dje', 1, '{}', now() - interval '1 minute') on conflict do nothing`,
    );
    await db.query(
      `update public.speakers set invite_id = $1, status = 'active', profile_completed_at = now(),
         consent_version_id = (select id from public.consent_versions where version = 1)
       where id = $2`,
      [rows[0]!.id, speakerOfBachir],
    );
    const hash = createHash('sha256').update(token).digest('hex');
    const { rows: result } = await db.query<{ r: { a_refaire: { code: string }[] } }>(
      `select public.voice_sentences($1) as r`,
      [hash],
    );
    expect(result[0]!.r.a_refaire.map((s) => s.code)).toEqual(['S0003']);
  });
});

describe('import des phrases (spec §5.2)', () => {
  const rows = (overrides: Record<string, string>[] = []) =>
    JSON.stringify([
      { id: 'S0100', zarma: 'Ay go koy', francais: 'Je pars', theme: 'vie', statut: 'Validée' },
      { id: 'S0101', zarma: 'Brouillon', francais: '', theme: '', statut: 'À relire' },
      { id: 'S 102', zarma: 'Mauvais id', francais: '', theme: '', statut: 'Validée' },
      ...overrides,
    ]);
  const runImport = (user: string, data: string) =>
    as<Record<string, unknown>>(user, `select public.import_sentences('dje', $1::jsonb) as r`, [
      data,
    ]);

  it('est réservé aux admins', async () => {
    await expect(runImport(awa, rows())).rejects.toThrow('acces_refuse');
  });

  it("n'importe que les phrases « Validée », et signale les identifiants invalides", async () => {
    const result = await runImport(admin, rows());
    expect(result).toMatchObject({ ajoutees: 1, ignorees: 1, modifiees: 0 });
    expect(result.erreurs).toEqual([{ ligne: 4, id: 'S 102', erreur: 'id_invalide' }]);
  });

  it('réimporter met à jour par id, et crée une nouvelle version si le texte change', async () => {
    expect(await runImport(admin, rows())).toMatchObject({ ajoutees: 0, inchangees: 1 });
    const changed = JSON.stringify([
      { id: 'S0100', zarma: 'Ay ga koy', francais: 'Je pars', theme: 'vie', statut: 'validee' },
    ]);
    expect(await runImport(admin, changed)).toMatchObject({ modifiees: 1, nouvelles_versions: 1 });
    const { rows: versions } = await db.query<{ version: number }>(
      `select v.version from public.sentence_versions v join public.sentences s on s.id = v.sentence_id
       where s.code = 'S0100' order by v.version`,
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });
});

describe('consentement oral', () => {
  it("crée la voix avec un consentement « oral » et range le fichier avec l'identité", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.invites (token_hash, language_code, recruiter_id, label, expires_at)
       values (sha256(gen_random_uuid()::text::bytea), 'dje', $1, 'Mariama', now() + interval '1 day') returning id`,
      [awa],
    );
    const invite = rows[0]!.id;
    const key = `consentements-oraux/${invite}/${randomUUID()}.m4a`;
    await expect(
      as(bachir, `select public.record_oral_consent($1, 'Mariama', null, $2) as r`, [invite, key]),
    ).rejects.toThrow('acces_refuse');
    const result = await as<{ numero: string }>(
      awa,
      `select public.record_oral_consent($1, 'Mariama', '+227', $2) as r`,
      [invite, key],
    );
    expect(result.numero).toMatch(/^V\d{3}$/);
    const { rows: check } = await db.query<{ mode: string; assisted: boolean; key: string }>(
      `select c.mode, s.assisted_reading as assisted, i.oral_consent_key as key
       from public.speakers s join public.consents c on c.speaker_id = s.id
       join prive.identities i on i.speaker_id = s.id where s.invite_id = $1`,
      [invite],
    );
    expect(check[0]).toEqual({ mode: 'oral', assisted: true, key });
  });
});

describe('suivi des voix', () => {
  it("donne l'avancement de chaque voix", async () => {
    const progress = await as<{ total: number; enregistrees: number }>(
      awa,
      `select to_jsonb(p) as r from public.speaker_progress p where speaker_id = $1`,
      [speakerOfAwa],
    );
    expect(progress).toMatchObject({ total: 0, enregistrees: 0 });
  });
});

describe('compteurs de l’écoute', () => {
  it('comptent comme la file, et mettent à part les audios de ses propres recrues', async () => {
    const recruiter = await createMember(db, 'compteurs', ['recruteur', 'verificateur', 'qualite']);
    const mine = (await createSpeaker(db, recruiter)).id;
    const doubt = await createRecording(db, mine, sentences[3]!);
    await db.query(`update public.recordings set qc_status = 'doute' where id = $1`, [doubt]);

    const counts = await as<{ doutes: number; doutes_vos_recrues: number }>(
      recruiter,
      `select public.review_counts('dje') as r`,
    );
    expect(counts.doutes_vos_recrues).toBe(1);
    // La file des doutes ne lui propose pas cet audio : le compteur principal non plus.
    const claimable = await as<{ id: string } | null>(
      recruiter,
      `select public.review_claim('dje', 'doute') as r`,
    );
    expect(counts.doutes).toBe(claimable ? 1 : 0);
    expect(claimable?.id).not.toBe(doubt);
  });

  it('ne compte rien pour un membre qui n’écoute pas', async () => {
    const recruiterOnly = await createMember(db, 'recrute-seulement', ['recruteur']);
    const counts = await as<Record<string, number>>(
      recruiterOnly,
      `select public.review_counts('dje') as r`,
    );
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});
