// Tests du parcours des voix (J2) : invitation → consentement → fiche → test → lot → fin.
// Les fonctions `voice_*` sont appelées comme le fait l'API, avec l'empreinte SHA-256 du jeton.

import type { PGlite } from '@electric-sql/pglite';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createMember, createSentence, createTestDb } from './helpers/db';

let db: PGlite;
let recruiter: string;
let verifierOnly: string;
let consentId: number;
const POINTS = ['enregistrement', 'entrainement_ia', 'usage_commercial', 'metadonnees', 'majeur'];

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function call<T = Record<string, unknown>>(fn: string, ...args: unknown[]): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query<{ r: T }>(`select public.${fn}(${params}) as r`, args);
  return rows[0]!.r;
}

/** Crée une invitation comme le ferait un recruteur connecté ; renvoie le jeton en clair. */
async function invite(label = 'Awa du marché'): Promise<string> {
  return asUser(db, recruiter, async () => {
    const { rows } = await db.query<{ token: string }>(
      `select token from public.create_invite($1, 'dje')`,
      [label],
    );
    return rows[0]!.token;
  });
}

/** Amène une voix jusqu'à « prête à enregistrer » (consentement + fiche). */
async function readyVoice(): Promise<string> {
  const h = hash(await invite());
  await call('voice_consent', h, consentId, POINTS, 'fr', 'Awa Test', null);
  await call('voice_profile', h, 'femme', '26-40', 'Niamey', 'zarma', null);
  return h;
}

async function recordAndConfirm(h: string, sentenceId: number) {
  const id = randomUUID();
  const prepared = await call<{ cle: string; prise: number }>(
    'voice_prepare_upload',
    h,
    id,
    sentenceId,
  );
  const confirmed = await call<{ statut_voix: string }>(
    'voice_confirm_upload',
    h,
    id,
    64_044,
    2000,
    16_000,
    null,
    null,
  );
  return { id, prepared, confirmed };
}

async function voiceStatus(h: string): Promise<string> {
  const session = await call<{ voix: { statut: string } }>('voice_session', h);
  return session.voix.statut;
}

let testSentences: number[];

beforeAll(async () => {
  db = await createTestDb();
  recruiter = await createMember(db, 'recruteur', ['recruteur', 'verificateur']);
  verifierOnly = await createMember(db, 'verif', ['verificateur']);
  const { rows } = await db.query<{ id: number }>(`
    insert into public.consent_versions (language_code, version, texts, published_at)
    values ('dje', 1, '{"fr": {"intro": "Texte"}}', now() - interval '1 minute') returning id
  `);
  consentId = rows[0]!.id;
  testSentences = [];
  for (let i = 1; i <= 5; i++) {
    testSentences.push(
      await createSentence(db, `T00${i}`, `Phrase de test ${i}`, { isTest: true }),
    );
  }
  for (let i = 1; i <= 6; i++) await createSentence(db, `S000${i}`, `Phrase ${i}`);
  await db.exec(
    `insert into public.settings (scope, key, value) values ('dje', 'batch_size', '3')`,
  );
});

describe('invitations', () => {
  it('un recruteur crée un lien : seul le hachage du jeton est stocké', async () => {
    const token = await invite();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await db.query<{ hex: string }>(
      `select encode(token_hash, 'hex') as hex from public.invites where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [token],
    );
    expect(rows[0]!.hex).toBe(hash(token));
  });

  it("un membre qui n'est pas recruteur ne peut pas inviter", async () => {
    await asUser(db, verifierOnly, async () => {
      await expect(db.query(`select * from public.create_invite('X', 'dje')`)).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('refuse un lien inconnu, révoqué ou expiré', async () => {
    await expect(call('voice_session', hash('faux'))).rejects.toThrow('lien_inconnu');
    await expect(call('voice_session', 'pas-un-hash')).rejects.toThrow('lien_inconnu');

    const revoked = await invite();
    await db.query(
      `update public.invites set revoked_at = now() where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [revoked],
    );
    await expect(call('voice_session', hash(revoked))).rejects.toThrow('lien_revoque');

    const expired = await invite();
    await db.query(
      `update public.invites set expires_at = now() - interval '1 day' where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [expired],
    );
    await expect(call('voice_session', hash(expired))).rejects.toThrow('lien_expire');
  });
});

describe('consentement', () => {
  it('avant le consentement, la session donne le texte mais aucune voix', async () => {
    const session = await call<{ voix: unknown; consentement: { id: number } }>(
      'voice_session',
      hash(await invite()),
    );
    expect(session.voix).toBeNull();
    expect(session.consentement.id).toBe(consentId);
  });

  it('refuse un consentement incomplet', async () => {
    const h = hash(await invite());
    await expect(
      call('voice_consent', h, consentId, POINTS.slice(0, 4), 'fr', 'Nom', null),
    ).rejects.toThrow('consentement_incomplet');
  });

  it('crée la voix avec un numéro anonyme et range le nom à part (schéma prive)', async () => {
    const h = hash(await invite());
    const { numero } = await call<{ numero: string }>(
      'voice_consent',
      h,
      consentId,
      POINTS,
      'dje',
      'Moussa Test',
      '+227 00 00 00 00',
    );
    expect(numero).toMatch(/^V\d{3}$/);
    // Un second envoi (double clic, réseau) ne crée ni nouvelle voix ni nouveau consentement.
    await call('voice_consent', h, consentId, POINTS, 'dje', 'Moussa Test', null);
    const { rows } = await db.query<{ speakers: number; consents: number; name: string }>(
      `select count(distinct s.id)::int as speakers, count(c.id)::int as consents, max(i.full_name) as name
       from public.speakers s
       join public.invites v on v.id = s.invite_id and v.token_hash = decode($1, 'hex')
       left join public.consents c on c.speaker_id = s.id
       left join prive.identities i on i.speaker_id = s.id`,
      [h],
    );
    expect(rows[0]).toEqual({ speakers: 1, consents: 1, name: 'Moussa Test' });
  });

  it("demande l'écran de rappel après une heure sans activité, plus après confirmation", async () => {
    const h = await readyVoice();
    type S = { voix: { rappel_requis: boolean } };
    expect((await call<S>('voice_session', h)).voix.rappel_requis).toBe(false);
    await db.query(
      `update public.speakers set last_seen_at = now() - interval '2 hours'
       where invite_id = (select id from public.invites where token_hash = decode($1, 'hex'))`,
      [h],
    );
    expect((await call<S>('voice_session', h)).voix.rappel_requis).toBe(true);
    await call('voice_reminder', h, 'fr');
    expect((await call<S>('voice_session', h)).voix.rappel_requis).toBe(false);
  });
});

describe('test et lot', () => {
  it('enregistre les 5 phrases de test, puis passe en attente du recruteur', async () => {
    const h = await readyVoice();
    const etape = await call<{ etape: string; phrases: { id: number }[] }>('voice_sentences', h);
    expect(etape.etape).toBe('test');
    expect(etape.phrases.map((p) => p.id)).toEqual(testSentences);

    for (const [i, sentence] of testSentences.entries()) {
      const { confirmed } = await recordAndConfirm(h, sentence);
      expect(confirmed.statut_voix).toBe(i < 4 ? 'inscrite' : 'test_en_attente');
    }
    expect((await call<{ etape: string }>('voice_sentences', h)).etape).toBe('attente');
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.jobs where kind = 'verifier_audio'`,
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(5);
  });

  it("l'envoi est idempotent et numérote les prises selon la spec (§4.3)", async () => {
    const h = await readyVoice();
    const { numero } = await call<{ voix: { numero: string } }>('voice_session', h).then((s) => ({
      numero: s.voix.numero,
    }));
    const id = randomUUID();
    const first = await call<{ cle: string; prise: number }>(
      'voice_prepare_upload',
      h,
      id,
      testSentences[0],
    );
    const again = await call<{ cle: string; prise: number }>(
      'voice_prepare_upload',
      h,
      id,
      testSentences[0],
    );
    expect(again).toEqual(first);
    expect(first.cle).toBe(`dje/varie/${numero}/dje_${numero}_T001_1.wav`);

    const second = await call<{ prise: number }>(
      'voice_prepare_upload',
      h,
      randomUUID(),
      testSentences[0],
    );
    expect(second.prise).toBe(2);

    await call('voice_confirm_upload', h, id, 64_044, 2000, 16_000, null, null);
    const twice = await call<{ deja_recu: boolean }>(
      'voice_confirm_upload',
      h,
      id,
      64_044,
      2000,
      16_000,
      null,
      null,
    );
    expect(twice.deja_recu).toBe(true);
  });

  it("refuse une phrase qui n'a pas été attribuée à la voix", async () => {
    const h = await readyVoice();
    const { rows } = await db.query<{ id: number }>(
      `select id from public.sentences where code = 'S0001'`,
    );
    await expect(call('voice_prepare_upload', h, randomUUID(), rows[0]!.id)).rejects.toThrow(
      'phrase_non_attribuee',
    );
  });

  it('attribue un lot sans doublon, aux phrases les moins lues, puis termine la voix', async () => {
    const h = await readyVoice();
    for (const s of testSentences) await recordAndConfirm(h, s);
    // Le recruteur valide le test (écran prévu au J3).
    await db.query(
      `update public.speakers set status = 'active', test_reviewed_at = now()
       where invite_id = (select id from public.invites where token_hash = decode($1, 'hex'))`,
      [h],
    );
    // Une phrase déjà très lue ne doit pas être choisie en premier.
    await db.exec(`update public.sentences set validated_reads = 10 where code = 'S0001'`);

    const lot = await call<{ etape: string; phrases: { id: number; code: string }[] }>(
      'voice_sentences',
      h,
    );
    expect(lot.etape).toBe('lot');
    expect(lot.phrases).toHaveLength(3);
    expect(new Set(lot.phrases.map((p) => p.id)).size).toBe(3);
    expect(lot.phrases.map((p) => p.code)).not.toContain('S0001');
    // Redemander le lot ne réattribue rien.
    expect((await call<{ phrases: unknown[] }>('voice_sentences', h)).phrases).toHaveLength(3);

    await call('voice_skip_sentence', h, lot.phrases[0]!.id);
    const { rows: flags } = await db.query(
      `select * from public.sentence_flags where sentence_id = $1`,
      [lot.phrases[0]!.id],
    );
    expect(flags).toHaveLength(1);

    await recordAndConfirm(h, lot.phrases[1]!.id);
    const last = await recordAndConfirm(h, lot.phrases[2]!.id);
    expect(last.confirmed.statut_voix).toBe('terminee');
    expect(await voiceStatus(h)).toBe('terminee');
  });

  it("bloque l'enregistrement tant que la fiche n'est pas remplie", async () => {
    const h = hash(await invite());
    await call('voice_consent', h, consentId, POINTS, 'fr', 'Nom', null);
    await expect(call('voice_sentences', h)).rejects.toThrow('fiche_requise');
  });

  // À garder en dernier dans ce fichier : il publie une version 99 qui reste la version courante.
  it('redemande le consentement complet quand une nouvelle version est publiée', async () => {
    const h = await readyVoice();
    const { rows } = await db.query<{ id: number }>(`
      insert into public.consent_versions (language_code, version, texts, published_at)
      values ('dje', 99, '{"fr": {"intro": "Texte v99"}}', now()) returning id
    `);
    const session = await call<{ voix: { consentement_a_jour: boolean } }>('voice_session', h);
    expect(session.voix.consentement_a_jour).toBe(false);
    await expect(call('voice_sentences', h)).rejects.toThrow('consentement_requis');
    await call('voice_consent', h, rows[0]!.id, POINTS, 'fr', null, null);
    expect((await call<typeof session>('voice_session', h)).voix.consentement_a_jour).toBe(true);
  });
});

describe('droits', () => {
  it('les fonctions des voix ne sont pas appelables depuis un navigateur, même connecté', async () => {
    for (const user of [null, recruiter]) {
      await asUser(db, user, async () => {
        await expect(db.query(`select public.voice_session('00')`)).rejects.toThrow(
          /permission denied/,
        );
      });
    }
  });
});
