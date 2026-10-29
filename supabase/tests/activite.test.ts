// Vue d'ensemble de l'activité de l'équipe (page « Activité », admins).

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
let verifier: string;
let quality: string;
let recruiter: string;

interface Activity {
  jours: number;
  equipe: { decisions: number; a_verifier: number; doutes: number };
  membres: {
    user_id: string;
    nom: string;
    ecoute: {
      premieres: number;
      valide: number;
      rejete: number;
      doute: number;
      doubles: number;
      rythme_s: number | null;
      par_jour: { jour: string; n: number }[] | null;
    };
    controle: { controles: number; accords: number };
    recrutement: { invitations: number; tests_valides: number };
  }[];
}

async function activity(user: string, days: number): Promise<Activity> {
  return asUser(db, user, async () => {
    const { rows } = await db.query<{ r: Activity }>(
      `select public.team_activity('dje', $1) as r`,
      [days],
    );
    return rows[0]!.r;
  });
}

/** Décision d'écoute écrite directement, à une date donnée (il y a `minutes` minutes). */
async function review(reviewer: string, recording: string, decision: string, minutes: number) {
  await db.query(
    `insert into public.reviews (recording_id, reviewer_id, kind, decision, created_at)
     values ($1, $2, 'premiere', $3, now() - $4 * interval '1 minute')`,
    [recording, reviewer, decision, minutes],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  verifier = await createMember(db, 'verif', ['verificateur']);
  quality = await createMember(db, 'qualite', ['qualite']);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
  const speaker = (await createSpeaker(db, recruiter)).id;
  const recordings: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const sentence = await createSentence(db, `S00${i}`, `Phrase ${i}`);
    recordings.push(await createRecording(db, speaker, sentence));
  }
  // Le vérificateur : 4 décisions à 30 s d'écart, puis une il y a 3 jours.
  await review(verifier, recordings[0]!, 'valide', 2);
  await review(verifier, recordings[1]!, 'valide', 1.5);
  await review(verifier, recordings[2]!, 'rejete', 1);
  await review(verifier, recordings[3]!, 'doute', 0.5);
  await review(verifier, recordings[4]!, 'valide', 3 * 24 * 60);
  // Une de ses décisions réécoutée en double écoute : le responsable qualité est d'accord.
  await db.query(
    `insert into public.double_reviews (recording_id, week, first_reviewer_id, first_decision,
                                        reviewer_id, decision, agrees, reviewed_at)
     values ($1, current_date, $2, 'valide', $3, 'valide', true, now())`,
    [recordings[0], verifier, quality],
  );
});

describe("vue d'ensemble de l'activité", () => {
  it('compte les décisions de chacun, par jour, avec son rythme', async () => {
    const week = await activity(admin, 7);
    const v = week.membres.find((m) => m.user_id === verifier)!;
    expect(v.ecoute).toMatchObject({ premieres: 5, valide: 3, rejete: 1, doute: 1 });
    expect(v.ecoute.par_jour).toHaveLength(7);
    expect(v.ecoute.par_jour!.reduce((sum, d) => sum + d.n, 0)).toBe(5);
    // 30 s entre les décisions qui se suivent ; la pause de 3 jours ne compte pas.
    expect(v.ecoute.rythme_s).toBe(30);
    expect(v.controle).toEqual({ controles: 1, accords: 1 });
    // Le plus actif d'abord.
    expect(week.membres[0]!.user_id).toBe(verifier);
    expect(week.equipe.decisions).toBe(5);
  });

  it("ne compte que la période choisie (aujourd'hui)", async () => {
    const today = await activity(admin, 1);
    const v = today.membres.find((m) => m.user_id === verifier)!;
    expect(today.jours).toBe(1);
    // Les décisions d'il y a 2 minutes sont aujourd'hui sauf juste après minuit à Niamey.
    expect(v.ecoute.premieres).toBeGreaterThanOrEqual(0);
    expect(v.ecoute.premieres).toBeLessThanOrEqual(4);
  });

  it('montre aussi les membres sans activité, avec des zéros', async () => {
    const week = await activity(admin, 7);
    const r = week.membres.find((m) => m.user_id === recruiter)!;
    expect(r.ecoute.premieres).toBe(0);
    expect(r.ecoute.par_jour).toBeNull();
    expect(r.recrutement.invitations).toBe(0);
  });

  it('est réservée aux admins', async () => {
    await expect(activity(verifier, 7)).rejects.toThrow('acces_refuse');
    await expect(activity(quality, 7)).rejects.toThrow('acces_refuse');
  });
});
