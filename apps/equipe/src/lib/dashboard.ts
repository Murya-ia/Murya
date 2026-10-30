// Données du tableau de bord (spec §5.1) : calculées par la base (`compute_dashboard`) et
// gardées dans `dashboard_snapshots`. Ici, seulement la mise en forme pour l'affichage.

export interface Dashboard {
  voix_par_statut: Record<
    | 'invitee'
    | 'inscrite'
    | 'test_en_attente'
    | 'test_a_refaire'
    | 'active'
    | 'terminee'
    | 'retiree',
    number
  >;
  heures: { enregistrees: number; validees: number };
  par_semaine: Week[];
  audios: {
    recus: number;
    a_verifier: number;
    doutes: number;
    valides: number;
    rejetes: number;
    suspects: number;
  };
  taux_rejet: number | null;
  repartition: {
    total: number;
    sexe: Record<string, number>;
    age: Record<string, number>;
    region: Record<string, number>;
    langue_maternelle: Record<string, number>;
  };
  quotas: Partial<Record<QuotaKey, number>> | null;
  langue_maternelle_code: string | null;
  par_recruteur: {
    recruteur: string;
    voix: number;
    actives: number;
    terminees: number;
    audios: number;
  }[];
  phrases_lectures: {
    zero: number;
    une: number;
    deux: number;
    trois_ou_plus: number;
    total: number;
  };
  voix_principale: { numero: number | null; validees: number; total: number };
  alertes: {
    voix_trop_de_rejets: { numero: number; rejets: number; sur: number }[];
    audios_en_attente: { nombre: number; plus_ancien: string | null; jours: number };
  };
  double_ecoute: {
    /** Part des audios validés de la semaine réécoutés (réglage). */
    part: number;
    a_faire: number;
    faites: number;
    desaccords: number;
    par_verificateur: { verificateur: string; faites: number; desaccords: number }[];
  };
  taches: { en_attente: number; en_echec: number; derniere_terminee: string | null };
}

export interface Week {
  /** Lundi de la semaine, « AAAA-MM-JJ » (date_trunc('week') de Postgres, en UTC). */
  semaine: string;
  enregistrees: number;
  validees: number;
}

export type QuotaKey =
  'femmes_min' | 'plus_40_ans_min' | 'hors_niamey_min' | 'langue_maternelle_min';

export interface QuotaRow {
  key: QuotaKey;
  label: string;
  /** Part actuelle (0 à 1), ou null s'il n'y a encore aucune fiche remplie. */
  actual: number | null;
  target: number;
  reached: boolean | null;
}

/** Libellés des valeurs de la fiche de la voix (mêmes codes que l'app de la voix). */
export const PROFILE_LABELS: Record<string, string> = {
  femme: 'Femmes',
  homme: 'Hommes',
  non_precise: 'Non précisé',
  inconnu: 'Inconnu',
  inconnue: 'Inconnue',
  '18-25': '18 à 25 ans',
  '26-40': '26 à 40 ans',
  '41-60': '41 à 60 ans',
  '60+': 'Plus de 60 ans',
  agadez: 'Agadez',
  diffa: 'Diffa',
  dosso: 'Dosso',
  maradi: 'Maradi',
  niamey: 'Niamey',
  tahoua: 'Tahoua',
  tillaberi: 'Tillabéri',
  zinder: 'Zinder',
  autre_pays: 'Autre pays',
  zarma: 'Zarma',
  haoussa: 'Haoussa',
  peul: 'Peul (fulfulde)',
  tamasheq: 'Tamasheq',
  kanouri: 'Kanouri',
  gourmantche: 'Gourmantché',
  toubou: 'Toubou',
  arabe: 'Arabe',
  tagdal: 'Tagdal',
  tasawaq: 'Tasawaq',
  boudouma: 'Boudouma',
  francais: 'Français',
  autre: 'Autre',
};

export function profileLabel(code: string): string {
  return PROFILE_LABELS[code] ?? code;
}

/** Quotas de diversité (spec §5.6) comparés aux fiches remplies. */
export function quotaRows(data: Dashboard): QuotaRow[] {
  const { total, sexe, age, region, langue_maternelle } = data.repartition;
  const mother = data.langue_maternelle_code;
  const share = (n: number) => (total > 0 ? n / total : null);
  const rows: [QuotaKey, string, number | null][] = [
    ['femmes_min', 'Femmes', share(sexe.femme ?? 0)],
    ['plus_40_ans_min', 'Plus de 40 ans', share((age['41-60'] ?? 0) + (age['60+'] ?? 0))],
    ['hors_niamey_min', 'Hors de Niamey', share(total - (region.niamey ?? 0))],
    [
      'langue_maternelle_min',
      `Langue maternelle ${mother ? profileLabel(mother).toLowerCase() : ''}`.trim(),
      mother ? share(langue_maternelle[mother] ?? 0) : null,
    ],
  ];
  return rows.flatMap(([key, label, actual]) => {
    const target = data.quotas?.[key];
    if (target === undefined) return [];
    return [{ key, label, actual, target, reached: actual === null ? null : actual >= target }];
  });
}

/** Les 12 dernières semaines, y compris celles sans enregistrement (à zéro). */
export function fillWeeks(weeks: Week[], now: Date, count = 12): Week[] {
  const byWeek = new Map(weeks.map((w) => [w.semaine, w]));
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const result: Week[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() - 7 * i);
    const key = day.toISOString().slice(0, 10);
    result.push(byWeek.get(key) ?? { semaine: key, enregistrees: 0, validees: 0 });
  }
  return result;
}

/** Graduations « rondes » de 0 jusqu'au moins `max` (1, 2, 2,5 ou 5 × 10^n). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = 0; v < max + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1]! < max) ticks.push(Number((ticks.length * step).toFixed(10)));
  return ticks;
}

/** Durée lisible à partir d'un nombre d'heures : « 0,2 min », « 42 min », « 3,5 h »
 * (espace insécable avant l'unité : elle ne passe jamais seule à la ligne). */
export function formatHours(hours: number): string {
  const minutes = hours * 60;
  if (minutes > 0 && minutes < 10) {
    return `${minutes.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u00a0min`;
  }
  if (hours < 1) return `${Math.round(minutes)}\u00a0min`;
  return `${hours.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u00a0h`;
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}\u00a0%`;
}

/** « 26 oct. » pour le lundi d'une semaine. */
export function weekLabel(monday: string): string {
  return new Date(`${monday}T00:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** « il y a 3 min », « il y a 2 h »… */
export function since(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} jours`;
}
