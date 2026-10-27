// File d'envoi des audios (spec §3.8) :
//   - chaque audio validé est d'abord écrit dans le téléphone (IndexedDB) ;
//   - il est envoyé en arrière-plan, un à la fois, avec de nouvelles tentatives à délai croissant ;
//   - il n'est supprimé du téléphone qu'après confirmation du serveur ;
//   - la file reprend toute seule à la réouverture de l'app.
// La logique ne dépend ni d'IndexedDB ni du réseau (ils sont « injectés ») : on la teste
// facilement avec des faux.

import { ApiError } from './api';

export interface UploadItem {
  /** UUID généré dans le navigateur : renvoyer le même audio ne crée jamais de doublon. */
  id: string;
  /**
   * Jeton de la voix qui a enregistré. Gardé avec chaque audio : sur un téléphone partagé,
   * si une autre personne ouvre son lien, les audios de la première partent quand même.
   */
  token: string;
  sentenceId: number;
  wav: Blob;
  metrics: Record<string, unknown>;
  mic: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  /** Refusé définitivement par le serveur : gardé pour l'équipe, plus renvoyé. */
  blocked?: string;
}

export interface UploadStore {
  all(): Promise<UploadItem[]>;
  put(item: UploadItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface UploadTransport {
  /** Réserve l'envoi ; `url` absente si le serveur a déjà reçu cet audio. */
  prepare(item: UploadItem): Promise<{ url?: string }>;
  upload(url: string, wav: Blob): Promise<void>;
  confirm(item: UploadItem): Promise<{ statut_voix?: string }>;
}

export interface QueueState {
  /** Audios pas encore confirmés par le serveur (bloqués compris). */
  pending: number;
  blocked: number;
  /** Envoi arrêté : lien expiré, révoqué, ou consentement à refaire. */
  paused: string | null;
}

/** Délais entre deux tentatives : 2 s, 4 s, 8 s… jusqu'à 5 minutes au plus. */
export function retryDelay(attempts: number): number {
  return Math.min(2000 * 2 ** (attempts - 1), 5 * 60_000);
}

/** Erreurs qui arrêtent toute la file : rien ne passera tant que la voix n'a pas agi. */
const PAUSE_CODES = new Set(['lien_inconnu', 'lien_revoque', 'lien_expire', 'consentement_requis']);
/** Erreurs propres à un audio, définitives : le renvoyer ne changerait rien. */
const BLOCK_CODES = new Set([
  'format_invalide',
  'pas_un_wav',
  'fichier_trop_gros',
  'phrase_non_attribuee',
  'phrase_inconnue',
  'enregistrement_inconnu',
  'requete_invalide',
]);

export class UploadQueue {
  private items = new Map<string, UploadItem>();
  private running = false;
  private paused: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: UploadStore,
    private readonly transport: UploadTransport,
    private readonly onChange: (state: QueueState) => void = () => {},
    private readonly onVoiceStatus: (status: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  /** Recharge les audios laissés dans le téléphone (onglet fermé, coupure…) et les envoie. */
  async start(): Promise<void> {
    for (const item of await this.store.all()) this.items.set(item.id, item);
    this.notify();
    void this.kick();
  }

  /** Ajoute un audio validé. Il est écrit dans le téléphone AVANT tout envoi. */
  async add(item: Omit<UploadItem, 'attempts' | 'nextAttemptAt'>): Promise<void> {
    const full: UploadItem = { ...item, attempts: 0, nextAttemptAt: 0 };
    await this.store.put(full);
    this.items.set(full.id, full);
    this.notify();
    void this.kick();
  }

  /** Relance tout de suite (retour du réseau, consentement refait…). */
  retryNow(): void {
    this.paused = null;
    for (const item of this.items.values()) if (!item.blocked) item.nextAttemptAt = 0;
    this.notify();
    void this.kick();
  }

  get state(): QueueState {
    const all = [...this.items.values()];
    return {
      pending: all.length,
      blocked: all.filter((i) => i.blocked).length,
      paused: this.paused,
    };
  }

  /** Phrases dont un audio attend dans le téléphone (pour ne pas les redemander). */
  get pendingSentenceIds(): Set<number> {
    return new Set([...this.items.values()].map((i) => i.sentenceId));
  }

  private async kick(): Promise<void> {
    if (this.running || this.paused) return;
    this.running = true;
    clearTimeout(this.timer);
    try {
      let next: UploadItem | undefined;
      while (!this.paused && (next = this.nextDue())) await this.send(next);
    } finally {
      this.running = false;
    }
    this.scheduleNext();
  }

  private nextDue(): UploadItem | undefined {
    return [...this.items.values()]
      .filter((i) => !i.blocked && i.nextAttemptAt <= this.now())
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  private scheduleNext(): void {
    if (this.paused) return;
    const waiting = [...this.items.values()].filter((i) => !i.blocked);
    if (waiting.length === 0) return;
    const soonest = Math.min(...waiting.map((i) => i.nextAttemptAt));
    this.timer = setTimeout(() => void this.kick(), Math.max(0, soonest - this.now()));
  }

  private async send(item: UploadItem): Promise<void> {
    try {
      const { url } = await this.transport.prepare(item);
      if (url) {
        await this.transport.upload(url, item.wav);
        const { statut_voix } = await this.transport.confirm(item);
        if (statut_voix) this.onVoiceStatus(statut_voix);
      }
      // Confirmé par le serveur : seulement maintenant on efface l'audio du téléphone.
      await this.store.remove(item.id);
      this.items.delete(item.id);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      if (code && PAUSE_CODES.has(code)) {
        this.paused = code;
      } else if (code && BLOCK_CODES.has(code)) {
        item.blocked = code;
        await this.store.put(item);
      } else {
        // Réseau absent ou lent, serveur indisponible, fichier pas encore arrivé : on réessaiera.
        item.attempts += 1;
        item.nextAttemptAt = this.now() + retryDelay(item.attempts);
        await this.store.put(item);
      }
    }
    this.notify();
  }

  private notify(): void {
    this.onChange(this.state);
  }
}
