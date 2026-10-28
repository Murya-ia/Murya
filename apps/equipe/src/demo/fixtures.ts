// Données d'exemple du mode démo : une campagne en cours, inventée (aucune vraie personne).

import type { Session } from '@supabase/supabase-js';
import type { Dashboard } from '../lib/dashboard';

export const DEMO_USER = '00000000-0000-4000-8000-000000000001';

export const DEMO_SESSION = {
  access_token: 'demo',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'demo',
  user: { id: DEMO_USER, email: 'demo@murya.chat' },
} as unknown as Session;

const MEMBERS = [
  {
    user_id: DEMO_USER,
    display_name: 'Awa',
    roles: ['admin', 'recruteur', 'verificateur', 'qualite'],
  },
  {
    user_id: '00000000-0000-4000-8000-000000000002',
    display_name: 'Bachir',
    roles: ['verificateur'],
  },
  {
    user_id: '00000000-0000-4000-8000-000000000003',
    display_name: 'Mariama',
    roles: ['recruteur'],
  },
];

const TEXTS = [
  'Ay ga koy habu.',
  'Ni kaani baani?',
  'Le marché de Niamey ouvre tôt le matin.',
  'Il a plu toute la nuit sur le fleuve.',
  'Mon frère vend du mil et du riz.',
  'Nous irons au village la semaine prochaine.',
  'Les enfants jouent devant la maison.',
  'Ma tante prépare le repas du soir pour toute la famille.',
];

const SENTENCES = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  code: i < 5 ? `T000${i + 1}` : `S${String(i - 4).padStart(4, '0')}`,
  text: TEXTS[i % TEXTS.length]!,
  translation_fr: i % 3 === 0 ? 'Traduction française de la phrase.' : null,
  theme: ['marché', 'famille', 'salutations', 'météo'][i % 4]!,
  active: i !== 17,
  is_test: i < 5,
  version: i === 9 ? 2 : 1,
  validated_reads: i < 5 ? 0 : [0, 1, 1, 2, 3, 0, 2][i % 7]!,
  pending_reads: i % 5 === 0 ? 1 : 0,
}));

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const INVITES = [
  ['Fati (cousine de Mariama)', 'V012', 'test_en_attente', false],
  ['Monsieur Issa, enseignant', 'V011', 'active', false],
  ['Hadiza', 'V010', 'terminee', false],
  ['Grand-mère de Bachir', 'V009', 'active', true],
  ['Ali du quartier Lazaret', null, null, false],
  ['Zeinabou', 'V008', 'test_a_refaire', false],
].map(([label, number, status, assisted], i) => ({
  id: `inv-${i}`,
  label,
  created_at: day(-i * 2),
  expires_at: day(14 - i * 2),
  revoked_at: null,
  recruiter_id: MEMBERS[i % 2 === 0 ? 0 : 2]!.user_id,
  speakers: number
    ? {
        id: `spk-${i}`,
        number,
        status,
        test_feedback: status === 'test_a_refaire' ? 'Parlez un peu plus fort.' : null,
        assisted_reading: assisted,
      }
    : null,
}));

const PROGRESS = INVITES.flatMap((invite, i) =>
  invite.speakers
    ? [
        {
          speaker_id: invite.speakers.id,
          total: 150,
          enregistrees: [12, 96, 150, 40, 0, 0][i]!,
          sautees: i === 2 ? 0 : i,
        },
      ]
    : [],
);

const part = (audios: number, heures: number, voix: number) => ({ audios, heures, voix });

const EXPORTS = [
  {
    id: 3,
    kind: 'varie',
    version: 3,
    status: 'en_cours',
    requested_at: day(0),
    finished_at: null,
    stats: null,
    hf_repo: null,
    error: null,
  },
  {
    id: 2,
    kind: 'varie',
    version: 2,
    status: 'pret',
    requested_at: day(-7),
    finished_at: day(-7),
    stats: {
      ...part(5210, 6.42, 31),
      train: part(4688, 5.79, 28),
      test: part(522, 0.63, 3),
      archive_octets: 742_000_000,
    },
    hf_repo: 'murya-ai/murya-dje-varie@v002',
    error: null,
  },
  {
    id: 1,
    kind: 'varie',
    version: 1,
    status: 'pret',
    requested_at: day(-21),
    finished_at: day(-21),
    stats: {
      ...part(1904, 2.31, 14),
      train: part(1720, 2.08, 13),
      test: part(184, 0.23, 1),
      archive_octets: 268_000_000,
    },
    hf_repo: 'murya-ai/murya-dje-varie@v001',
    error: null,
  },
];

const exam = (
  id: string,
  numero: string,
  sexe: string,
  age: string,
  region: string,
  figee?: boolean,
) => ({ id, numero, sexe, age, region, figee });

const EXAM_OVERVIEW = {
  voix_eligibles: 47,
  cible: 5,
  examen: [
    exam('ex-1', 'V004', 'femme', '26-40', 'Niamey', true),
    exam('ex-2', 'V017', 'homme', '41-60', 'Dosso', true),
    exam('ex-3', 'V023', 'femme', '18-25', 'Tillabéri', false),
  ],
  proposition: [
    exam('ex-4', 'V031', 'homme', '18-25', 'Niamey'),
    exam('ex-5', 'V042', 'femme', '60+', 'Tahoua'),
  ],
};

const session = (
  numero: number,
  statut: string,
  enregistrees: number,
  a_verifier: number,
  rejetees: number,
  opened: number,
) => ({
  numero,
  statut,
  ouverte_le: day(opened),
  terminee_le: statut === 'en_cours' ? null : day(opened + 2),
  verifiee_le: statut === 'verifiee' ? day(opened + 3) : null,
  phrases: 150,
  enregistrees,
  a_verifier,
  rejetees,
});

const PRINCIPAL = {
  phrases_total: 3000,
  voix: {
    id: 'spk-principale',
    numero: 'V004',
    statut: 'active',
    libelle: 'Hadiza (voix principale)',
    reference: { id: 'test-0', code: 'S0012', texte: 'Ay ga koy habu suba.' },
    phrases_validees: 437,
    seances: [
      session(1, 'verifiee', 150, 0, 6, -12),
      session(2, 'verifiee', 150, 0, 3, -8),
      session(3, 'a_verifier', 150, 41, 1, -4),
    ],
    candidats_reference: SENTENCES.slice(0, 4).map((s, i) => ({
      id: `test-${i}`,
      code: s.code,
      texte: s.text,
    })),
  },
  candidats: [],
};

const TABLES: Record<string, unknown[]> = {
  team_members: MEMBERS,
  exports: EXPORTS,
  consent_versions: [{ id: 1, version: 1 }],
  consent_audios: [{ ui_language: 'dje', kind: 'complet', uploaded_at: day(-2) }],
  withdrawal_requests: [
    {
      speaker_id: 'spk-3',
      requested_by: MEMBERS[2]!.user_id,
      requested_at: day(-1),
      note: 'Elle préfère arrêter.',
    },
  ],
  speakers: INVITES.filter((i) => i.speakers?.status === 'test_en_attente').map((i) => i.speakers),
  sentence_flags: [{ sentence_id: 8 }, { sentence_id: 8 }, { sentence_id: 21 }],
  sentences: SENTENCES,
  invites: INVITES,
  speaker_progress: PROGRESS,
  orthography_decisions: [
    {
      id: 1,
      word: 'ŋwa',
      chosen_spelling: 'ŋwa',
      rejected_variants: ['ngwa'],
      note: 'Arrêté de 1999',
      decided_at: day(-3),
    },
  ],
  recordings: SENTENCES.slice(0, 5).map((s, i) => ({
    id: `test-${i}`,
    take: 1,
    created_at: day(-1),
    sentences: { code: s.code, text: s.text, is_test: true },
  })),
};

/** Heures par semaine : une campagne qui monte en puissance sur 12 semaines. */
function weeks(): Dashboard['par_semaine'] {
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const recorded = [0, 0, 0.4, 1.1, 2.3, 3.0, 4.6, 5.2, 6.8, 7.5, 8.1, 3.2];
  return recorded.map((h, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - 7 * (11 - i));
    return {
      semaine: d.toISOString().slice(0, 10),
      enregistrees: h,
      validees: i === 11 ? 1.1 : Math.round(h * 0.82 * 100) / 100,
    };
  });
}

const DASHBOARD: Dashboard = {
  voix_par_statut: {
    invitee: 6,
    inscrite: 4,
    test_en_attente: 3,
    test_a_refaire: 1,
    active: 31,
    terminee: 12,
    retiree: 1,
  },
  heures: { enregistrees: 42.2, validees: 33.4 },
  par_semaine: weeks(),
  audios: { recus: 9480, a_verifier: 1210, doutes: 14, valides: 7610, rejetes: 646, suspects: 87 },
  taux_rejet: 0.078,
  repartition: {
    total: 47,
    sexe: { femme: 21, homme: 25, non_precise: 1 },
    age: { '18-25': 18, '26-40': 17, '41-60': 9, '60+': 3 },
    region: { niamey: 29, dosso: 7, tillaberi: 6, maradi: 2, autre_pays: 3 },
    langue_maternelle: { zarma: 38, haoussa: 6, peul: 3 },
  },
  quotas: {
    femmes_min: 0.5,
    plus_40_ans_min: 0.2,
    hors_niamey_min: 0.3,
    langue_maternelle_min: 0.7,
  },
  langue_maternelle_code: 'zarma',
  par_recruteur: [
    { recruteur: 'Awa', voix: 21, actives: 14, terminees: 6, audios: 4210 },
    { recruteur: 'Bachir', voix: 9, actives: 7, terminees: 1, audios: 1630 },
    { recruteur: 'Mariama', voix: 18, actives: 10, terminees: 5, audios: 3640 },
  ],
  phrases_lectures: { zero: 820, une: 1340, deux: 610, trois_ou_plus: 230, total: 3000 },
  voix_principale: { numero: 4, validees: 1180, total: 3000 },
  alertes: {
    voix_trop_de_rejets: [{ numero: 27, rejets: 4, sur: 10 }],
    audios_en_attente: { nombre: 58, plus_ancien: day(-6), jours: 3 },
  },
  double_ecoute: {
    part: 0.1,
    a_faire: 23,
    faites: 140,
    desaccords: 9,
    par_verificateur: [
      { verificateur: 'Awa', faites: 52, desaccords: 2 },
      { verificateur: 'Bachir', faites: 61, desaccords: 6 },
      { verificateur: 'Mariama', faites: 27, desaccords: 1 },
    ],
  },
  taches: { en_attente: 4, en_echec: 0, derniere_terminee: day(-0.004) },
};

export function tableRows(table: string): unknown[] {
  if (table === 'dashboard_snapshots') {
    return [{ data: DASHBOARD, computed_at: day(-0.003) }];
  }
  return TABLES[table] ?? [];
}

let claims = 0;

/** Audio à écouter : chaque nouvelle demande en donne un autre. */
function reviewItem(mode: string): Record<string, unknown> {
  claims++;
  const sentence = SENTENCES[5 + (claims % 30)]!;
  return {
    id: `rec-${claims}`,
    statut: mode === 'doute' ? 'doute' : 'a_verifier',
    type: 'varie',
    prise: 1,
    duree_ms: 3100,
    suspect: claims % 3 === 0,
    verifications_serveur:
      claims % 4 === 1
        ? null
        : {
            format: { frequence: 16000, canaux: 1, bits: 16, ok: true },
            rsb_db: claims % 3 === 0 ? 11.2 : 21.4,
            mots_par_seconde: 2.6,
            alertes: claims % 3 === 0 ? ['bruit'] : [],
          },
    mesures_navigateur: {
      voix_dbfs: -24,
      bruit_dbfs: -52,
      saturation: 0,
      silence_avant_ms: 540,
      silence_apres_ms: 420,
    },
    reserve_jusqua: day(5 / 1440),
    phrase: {
      code: sentence.code,
      texte: sentence.text,
      traduction: sentence.translation_fr,
      mots: sentence.text.split(/\s+/).length,
    },
    voix: `V0${10 + (claims % 20)}`,
    avis:
      mode === 'doute'
        ? [{ decision: 'doute', motif: null, commentaire: 'Un mot semble différent à la fin.' }]
        : [],
    ...(mode === 'double' ? { double_ecoute: true } : {}),
  };
}

const JOURNAL = [
  ['retrait_voix', 'Awa', 'V007', { audios: 37 }],
  ['demande_retrait', 'Mariama', 'V009', {}],
  ['acces_identite', 'Awa', 'V011', {}],
  ['recherche_identite', 'Awa', 'dje', { resultats: 1 }],
  ['audio_corrige', 'Bachir', 'V011 · S0004', {}],
  ['audio_rejete', 'Bachir', 'V010 · S0012', {}],
  ['double_ecoute', 'Awa', 'V008 · S0003', { accord: false }],
  ['test_valide', 'Mariama', 'V011', {}],
  ['import_phrases', 'Awa', 'dje', { ajoutees: 120, modifiees: 3, erreurs: 0 }],
  ['phrase_desactivee', 'Awa', 'S0013', {}],
  ['membre_modifie', 'Awa', 'Bachir', { roles: ['verificateur'], actif: true }],
  ['test_envoye', 'la voix', 'V012', {}],
].map(([action, par, cible, details], i) => ({
  id: 500 - i,
  date: day(-i * 0.3),
  action,
  par,
  cible,
  details,
}));

export function rpcResult(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'review_counts':
      return { a_verifier: 1210, a_verifier_vos_recrues: 96, doutes: 14, doutes_vos_recrues: 0 };
    case 'review_claim':
      return reviewItem(String(args.p_mode ?? 'premiere'));
    case 'double_review_claim':
      return reviewItem('double');
    case 'double_review_submit':
      return claims % 2 === 0;
    case 'create_invite':
      return { token: 'exemple-de-lien', expires_at: day(14) };
    case 'import_sentences':
      return { importees: 0, mises_a_jour: 0, ignorees: 0 };
    case 'find_speakers':
      return [
        {
          id: 'spk-1',
          numero: 'V011',
          statut: 'active',
          recruteur: 'Mariama',
          nom: 'Issa Moussa',
          contact: '+227 90 00 00 00',
          consentement_oral: false,
          retrait_demande: false,
        },
      ];
    case 'speaker_identity':
      return { nom: 'Issa Moussa', contact: '+227 90 00 00 00', consentement_oral: false };
    case 'team_directory':
      return MEMBERS.map((m, i) => ({
        user_id: m.user_id,
        nom: m.display_name,
        email: `${m.display_name.toLowerCase()}@murya.org`,
        roles: m.roles,
        actif: true,
        derniere_connexion: i === 3 ? null : day(-i),
      }));
    case 'principal_overview':
      return PRINCIPAL;
    case 'exam_overview':
      return EXAM_OVERVIEW;
    case 'request_export':
      return { id: 4, version: 4 };
    case 'journal':
      return JOURNAL.filter((e) => !args.p_action || e.action === args.p_action);
    default:
      return null;
  }
}
