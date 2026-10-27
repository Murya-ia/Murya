import { describe, expect, it } from 'vitest';
import {
  fillWeeks,
  formatHours,
  formatPercent,
  niceTicks,
  quotaRows,
  since,
  type Dashboard,
} from './dashboard';

function dashboard(repartition: Partial<Dashboard['repartition']>): Dashboard {
  return {
    repartition: { total: 0, sexe: {}, age: {}, region: {}, langue_maternelle: {}, ...repartition },
    quotas: {
      femmes_min: 0.5,
      plus_40_ans_min: 0.2,
      hors_niamey_min: 0.3,
      langue_maternelle_min: 0.7,
    },
    langue_maternelle_code: 'zarma',
  } as Dashboard;
}

describe('quotas (spec §5.6)', () => {
  it('compare chaque part aux objectifs', () => {
    const rows = quotaRows(
      dashboard({
        total: 10,
        sexe: { femme: 4, homme: 6 },
        age: { '18-25': 5, '41-60': 2, '60+': 1, '26-40': 2 },
        region: { niamey: 8, dosso: 2 },
        langue_maternelle: { zarma: 9, haoussa: 1 },
      }),
    );
    expect(rows.map((r) => [r.key, r.actual, r.reached])).toEqual([
      ['femmes_min', 0.4, false],
      ['plus_40_ans_min', 0.3, true],
      ['hors_niamey_min', 0.2, false],
      ['langue_maternelle_min', 0.9, true],
    ]);
    expect(rows[3]!.label).toBe('Langue maternelle zarma');
  });

  it('sans fiche remplie, aucune part n’est calculée', () => {
    const rows = quotaRows(dashboard({ total: 0 }));
    expect(rows.every((r) => r.actual === null && r.reached === null)).toBe(true);
  });

  it('un quota absent des réglages n’est pas affiché', () => {
    const data = dashboard({ total: 2, sexe: { femme: 1 } });
    data.quotas = { femmes_min: 0.5 };
    expect(quotaRows(data).map((r) => r.key)).toEqual(['femmes_min']);
  });
});

describe('semaines du graphique', () => {
  it('complète les 12 dernières semaines (lundis UTC) avec des zéros', () => {
    // Mardi 27 octobre 2026 : la semaine courante commence le lundi 26.
    const weeks = fillWeeks(
      [{ semaine: '2026-10-19', enregistrees: 1.5, validees: 1 }],
      new Date('2026-10-27T10:00:00Z'),
    );
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toEqual({ semaine: '2026-10-26', enregistrees: 0, validees: 0 });
    expect(weeks[10]).toEqual({ semaine: '2026-10-19', enregistrees: 1.5, validees: 1 });
    expect(weeks[0]!.semaine).toBe('2026-08-10');
  });

  it('un dimanche appartient à la semaine commencée le lundi précédent', () => {
    expect(fillWeeks([], new Date('2026-11-01T23:00:00Z'), 1)[0]!.semaine).toBe('2026-10-26');
  });
});

describe('mise en forme', () => {
  it('graduations rondes qui couvrent le maximum', () => {
    expect(niceTicks(3.7)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(4.6)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(0.03)).toEqual([0, 0.01, 0.02, 0.03]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('heures, pourcentages et ancienneté', () => {
    expect(formatHours(0.25)).toBe('15 min');
    expect(formatHours(3.46)).toBe('3,5 h');
    expect(formatPercent(0.125)).toBe('12,5 %');
    expect(formatPercent(null)).toBe('—');
    const now = new Date('2026-10-27T12:00:00Z');
    expect(since('2026-10-27T11:57:00Z', now)).toBe('il y a 3 min');
    expect(since('2026-10-27T09:00:00Z', now)).toBe('il y a 3 h');
  });
});
