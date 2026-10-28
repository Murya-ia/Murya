// Données de la voix gardées dans le téléphone : jeton, langue d'interface, et dernières
// réponses du serveur (pour que l'app s'ouvre et qu'on puisse enregistrer sans réseau).

import type { ClientCheckThresholds } from '@murya/commun';
import type { UiLanguage } from '../i18n/i18n';

export interface ConsentText {
  intro?: string;
  points?: Record<string, string>;
  rappel?: string;
}

export interface Session {
  langue: string;
  consentement: {
    id: number;
    version: number;
    points: string[];
    textes: Partial<Record<UiLanguage, ConsentText>>;
    audios: Partial<Record<UiLanguage, string | { complet?: string; rappel?: string }>>;
  } | null;
  reglages: {
    verifications: ClientCheckThresholds | null;
    duree_max_s: number | null;
    pause_toutes: number | null;
  };
  voix: {
    numero: string;
    statut: 'inscrite' | 'test_en_attente' | 'test_a_refaire' | 'active' | 'terminee';
    consentement_a_jour: boolean;
    rappel_requis: boolean;
    fiche_remplie: boolean;
    tutoriel_vu: boolean;
    message_test: string | null;
    principale: boolean;
    /** Mode « écouter puis répéter » : la personne ne lit pas, elle répète un modèle. */
    repetition?: boolean;
  } | null;
}

export interface Sentence {
  id: number;
  code: string;
  texte: string;
  version: number;
  enregistree?: boolean;
  sautee?: boolean;
}

export interface Sentences {
  /** `verification` : voix principale, séance finie, en attente de la vérification de l'équipe. */
  etape: 'test' | 'attente' | 'lot' | 'verification' | 'sans_modele' | 'fin';
  phrases: Sentence[];
  a_refaire?: Sentence[];
  total?: number;
  /** Voix principale : séance en cours et audio de référence (adresse signée, 1 h). */
  seance?: { numero: number; reference_url?: string };
}

const KEYS = {
  token: 'murya-jeton',
  language: 'murya-langue',
  session: 'murya-session',
  sentences: 'murya-phrases',
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Navigation privée ou stockage plein : l'app marche quand même, sans mémoire.
  }
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function readToken(): string | null {
  const token = read(KEYS.token);
  return token && TOKEN_RE.test(token) ? token : null;
}

/** Nouveau lien ouvert : on garde le jeton et on oublie les réponses de l'ancien lien. */
export function saveToken(token: string): void {
  if (read(KEYS.token) !== token) {
    write(KEYS.session, null);
    write(KEYS.sentences, null);
  }
  write(KEYS.token, token);
}

export function readLanguage(): UiLanguage | null {
  const value = read(KEYS.language);
  return value === 'dje' || value === 'fr' ? value : null;
}

export function saveLanguage(language: UiLanguage): void {
  write(KEYS.language, language);
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(read(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

export const cache = {
  session: () => readJson<Session>(KEYS.session),
  saveSession: (s: Session) => write(KEYS.session, JSON.stringify(s)),
  sentences: () => readJson<Sentences>(KEYS.sentences),
  saveSentences: (s: Sentences) => write(KEYS.sentences, JSON.stringify(s)),
};

/** Une coupure réseau (fetch impossible) se reconnaît à une TypeError. */
export function isOffline(error: unknown): boolean {
  return error instanceof TypeError;
}
