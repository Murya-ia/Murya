// Tests de la protection des données (J6a) : journal inaltérable et lisible, accès aux
// identités, demandes de retrait, retrait d'une voix (droit à l'effacement, spec §5.8).

import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
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

async function count(query: string, params: unknown[] = []): Promise<number> {
  return Number(await sql<number>(`select count(*) as r from ${query}`, params));
}

/** Une voix passée par le vrai parcours (invitation, consentement avec son nom, fiche). */
async function voice(name: string): Promise<{ id: string; number: string; tokenHash: string }> {
  const token = await asUser(db, recruiter, async () => {
    const { rows } = await db.query<{ token: string }>(
      `select token from public.create_invite($1, 'dje')`,
      [`${name} (surnom)`],
    );
    return rows[0]!.token;
  });
  const tokenHash = hash(token);
  await db.query(`select public.voice_consent($1, $2, $3, 'fr', $4, '+227 90 00 00 00')`, [
    tokenHash,
    consentId,
    POINTS,
    name,
  ]);
  await db.query(`select public.voice_profile($1, 'femme', '26-40', 'Niamey', 'zarma', null)`, [
    tokenHash,
  ]);
  const { rows } = await db.query<{ id: string; number: string }>(
    `select s.id, s.number from public.speakers s
     join public.invites i on i.id = s.invite_id where i.token_hash = decode($1, 'hex')`,
    [tokenHash],
  );
  return { ...rows[0]!, tokenHash };
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
  otherRecruiter = await createMember(db, 'recruteur2', ['recruteur']);
  verifier = await createMember(db, 'verif', ['verificateur']);
  const { rows } = await db.query<{ id: number }>(`
    insert into public.consent_versions (language_code, version, texts, published_at)
    values ('dje', 1, '{"fr": {"intro": "Texte"}}', now() - interval '1 minute') returning id
  `);
  consentId = rows[0]!.id;
});

describe("journal d'activité (spec §5.10)", () => {
  it('ne peut être ni modifié ni effacé, même par le propriétaire de la base', async () => {
    await db.query(
      `insert into public.audit_log (actor_kind, action) values ('systeme', 'essai_journal')`,
    );
    await expect(
      db.query(`update public.audit_log set action = 'falsifie' where action = 'essai_journal'`),
    ).rejects.toThrow('journal_inalterable');
    await expect(
      db.query(`delete from public.audit_log where action = 'essai_journal'`),
    ).rejects.toThrow('journal_inalterable');
    await expect(db.query(`truncate public.audit_log`)).rejects.toThrow('journal_inalterable');
  });

  it('se lit page par page par un admin seulement, avec des filtres', async () => {
    const page = await as<{ id: number; action: string; par: string }[]>(
      admin,
      `select public.journal(null, 5) as r`,
    );
    expect(page.length).toBeGreaterThan(0);
    expect(page.length).toBeLessThanOrEqual(5);
    const filtered = await as<{ action: string }[]>(
      admin,
      `select public.journal(null, 50, 'essai_journal') as r`,
    );
    expect(filtered.map((e) => e.action)).toEqual(['essai_journal']);
    await expect(as(recruiter, `select public.journal() as r`)).rejects.toThrow('acces_refuse');
  });
});

describe('identités (admins seulement, chaque accès journalisé)', () => {
  let awa: { id: string; number: string };

  beforeAll(async () => {
    awa = await voice('Awa Moussa');
  });

  it('un admin retrouve une voix par son nom ou par son numéro', async () => {
    const byName = await as<{ id: string; nom: string; contact: string }[]>(
      admin,
      `select public.find_speakers('dje', 'moussa') as r`,
    );
    expect(byName).toEqual([
      expect.objectContaining({ id: awa.id, nom: 'Awa Moussa', contact: '+227 90 00 00 00' }),
    ]);
    const shortNumber = awa.number.replace(/^V0*/, '');
    const byNumber = await as<{ id: string }[]>(
      admin,
      `select public.find_speakers('dje', $1) as r`,
      [shortNumber.length >= 2 ? shortNumber : awa.number],
    );
    expect(byNumber.map((s) => s.id)).toContain(awa.id);
  });

  it('le texte cherché (un nom) n’est jamais écrit dans le journal', async () => {
    const entry = await sql<{ details: Record<string, unknown> }>(
      `select to_jsonb(l) as r from public.audit_log l
       where action = 'recherche_identite' order by id desc limit 1`,
    );
    expect(JSON.stringify(entry)).not.toContain('moussa');
    expect(entry.details).toMatchObject({ langue: 'dje' });
  });

  it("l'identité d'une voix est lue par un admin, et la lecture est journalisée", async () => {
    const identity = await as<{ nom: string }>(admin, `select public.speaker_identity($1) as r`, [
      awa.id,
    ]);
    expect(identity.nom).toBe('Awa Moussa');
    expect(
      await count(`public.audit_log where action = 'acces_identite' and target_id = $1`, [awa.id]),
    ).toBe(1);
  });

  it('personne d’autre ne voit les identités', async () => {
    for (const user of [recruiter, verifier]) {
      await expect(as(user, `select public.find_speakers('dje', 'awa') as r`)).rejects.toThrow(
        'acces_refuse',
      );
      await expect(as(user, `select public.speaker_identity($1) as r`, [awa.id])).rejects.toThrow(
        'acces_refuse',
      );
    }
  });
});

describe('demandes de retrait', () => {
  let fati: { id: string };

  beforeAll(async () => {
    fati = await voice('Fati Issa');
  });

  it('le recruteur de la voix fait la demande ; un autre recruteur ou un vérificateur ne peut pas', async () => {
    await expect(
      as(otherRecruiter, `select public.request_withdrawal($1) as r`, [fati.id]),
    ).rejects.toThrow('acces_refuse');
    await expect(
      as(verifier, `select public.request_withdrawal($1) as r`, [fati.id]),
    ).rejects.toThrow('acces_refuse');
    await as(recruiter, `select public.request_withdrawal($1, 'Elle a changé d''avis') as r`, [
      fati.id,
    ]);
    const visible = await asUser(db, admin, async () => {
      const { rows } = await db.query(`select * from public.withdrawal_requests`);
      return rows;
    });
    expect(visible).toEqual([
      expect.objectContaining({ speaker_id: fati.id, requested_by: recruiter }),
    ]);
    // La note n'est pas recopiée dans le journal.
    const entry = await sql<Record<string, unknown>>(
      `select to_jsonb(l) as r from public.audit_log l where action = 'demande_retrait'`,
    );
    expect(JSON.stringify(entry)).not.toContain('avis');
  });

  it('elle peut être annulée par son auteur ou par un admin', async () => {
    await as(recruiter, `select public.cancel_withdrawal_request($1) as r`, [fati.id]);
    expect(await count(`public.withdrawal_requests`)).toBe(0);
    await as(recruiter, `select public.request_withdrawal($1) as r`, [fati.id]);
    await expect(
      as(otherRecruiter, `select public.cancel_withdrawal_request($1) as r`, [fati.id]),
    ).rejects.toThrow('acces_refuse');
    await as(admin, `select public.cancel_withdrawal_request($1) as r`, [fati.id]);
    expect(await count(`public.withdrawal_requests`)).toBe(0);
  });
});

describe("retrait d'une voix (spec §5.8)", () => {
  let target: { id: string; number: string; tokenHash: string };
  let other: string;
  let validated: number;
  let assigned: number;

  beforeAll(async () => {
    target = await voice('Mariama Retrait');
    other = (await createSpeaker(db, recruiter)).id;
    validated = await createSentence(db, 'R0001', 'Phrase validée');
    assigned = await createSentence(db, 'R0002', 'Phrase attribuée');
    // La voix à retirer : un audio validé, un audio rejeté, une phrase attribuée non lue.
    const ok = await createRecording(db, target.id, validated);
    const ko = await createRecording(db, target.id, assigned);
    await db.query(`update public.recordings set qc_status = 'valide' where id = $1`, [ok]);
    await db.query(
      `update public.recordings set qc_status = 'rejete', reject_reason = 'inaudible' where id = $1`,
      [ko],
    );
    await db.query(
      `insert into public.reviews (recording_id, reviewer_id, kind, decision) values ($1, $2, 'premiere', 'valide')`,
      [ok, verifier],
    );
    await db.query(
      `insert into public.assignments (speaker_id, sentence_id, position) values ($1, $2, 1)`,
      [target.id, assigned],
    );
    await db.query(
      `update prive.identities set oral_consent_key = 'consentements-oraux/x/y.m4a' where speaker_id = $1`,
      [target.id],
    );
    // Une autre voix a aussi validé la première phrase : sa lecture doit rester comptée.
    const otherOk = await createRecording(db, other, validated);
    await db.query(`update public.recordings set qc_status = 'valide' where id = $1`, [otherOk]);
    await db.query(`update public.sentences set validated_reads = 2 where id = $1`, [validated]);
    await db.query(`update public.sentences set pending_reads = 1 where id = $1`, [assigned]);
    await as(recruiter, `select public.request_withdrawal($1) as r`, [target.id]);
  });

  it('réservé aux admins, avec le numéro de la voix retapé pour confirmer', async () => {
    await expect(
      as(recruiter, `select public.withdraw_speaker($1, $2) as r`, [target.id, target.number]),
    ).rejects.toThrow('acces_refuse');
    await expect(
      as(admin, `select public.withdraw_speaker($1, 'V999') as r`, [target.id]),
    ).rejects.toThrow('confirmation_incorrecte');
    expect(await count(`public.speakers where id = $1`, [target.id])).toBe(1);
  });

  it('efface la voix et tout ce qui la concerne, et ne garde que numéro, date et admin', async () => {
    const result = await as<{
      numero: string;
      audios: number;
      prefixes_audio: string[];
      cles_audio: string[];
      cles_identites: string[];
    }>(admin, `select public.withdraw_speaker($1, $2) as r`, [
      target.id,
      target.number.toLowerCase(),
    ]);
    expect(result.numero).toBe(target.number);
    expect(result.audios).toBe(2);
    expect(result.cles_audio).toHaveLength(2);
    expect(result.cles_identites).toEqual(['consentements-oraux/x/y.m4a']);
    expect(result.prefixes_audio).toEqual([
      `dje/varie/${target.number}/`,
      `dje/principale/${target.number}/`,
    ]);

    for (const table of [
      'public.speakers where id = $1',
      'prive.identities where speaker_id = $1',
      'public.consents where speaker_id = $1',
      'public.recordings where speaker_id = $1',
      'public.assignments where speaker_id = $1',
      'public.withdrawal_requests where speaker_id = $1',
    ]) {
      expect(await count(table, [target.id]), table).toBe(0);
    }
    expect(await count(`public.reviews where reviewer_id = $1`, [verifier])).toBe(0);
    expect(
      await count(`public.invites where token_hash = decode($1, 'hex')`, [target.tokenHash]),
    ).toBe(0);

    expect(
      await sql(`select to_jsonb(w) - 'id' - 'withdrawn_at' as r from public.withdrawals w`),
    ).toEqual({ language_code: 'dje', speaker_number: target.number, withdrawn_by: admin });
    const job = await sql<{ kind: string; status: string; payload: { cles_audio: string[] } }>(
      `select to_jsonb(j) as r from public.jobs j where kind = 'effacer_fichiers'`,
    );
    expect(job.status).toBe('en_attente');
    expect(job.payload.cles_audio).toEqual(result.cles_audio);
    const log = await sql<{ target_id: string; details: { audios: number } }>(
      `select to_jsonb(l) as r from public.audit_log l where action = 'retrait_voix'`,
    );
    expect(log).toMatchObject({ target_id: target.number, details: { audios: 2 } });
    expect(JSON.stringify(log)).not.toContain('Mariama');
  });

  it('retire sa contribution aux compteurs de lectures, pas celle des autres voix', async () => {
    const reads = await sql<{ validated: number; pending: number }>(
      `select jsonb_build_object(
         'validated', (select validated_reads from public.sentences where id = $1),
         'pending', (select pending_reads from public.sentences where id = $2)) as r`,
      [validated, assigned],
    );
    expect(reads).toEqual({ validated: 1, pending: 0 });
  });

  it('son lien ne fonctionne plus', async () => {
    await expect(db.query(`select public.voice_session($1)`, [target.tokenHash])).rejects.toThrow();
  });

  it('le journal affiche le numéro de la voix retirée', async () => {
    const entries = await as<{ action: string; cible: string; par: string }[]>(
      admin,
      `select public.journal(null, 20, 'retrait_voix') as r`,
    );
    expect(entries[0]).toMatchObject({
      action: 'retrait_voix',
      cible: target.number,
      par: 'admin',
    });
    // Les anciennes entrées qui visaient la voix (par son identifiant) restent lisibles.
    const requests = await as<{ cible: string }[]>(
      admin,
      `select public.journal(null, 20, 'demande_retrait') as r`,
    );
    expect(requests.some((e) => e.cible === 'voix retirée')).toBe(true);
  });
});
