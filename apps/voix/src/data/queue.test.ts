import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  UploadQueue,
  retryDelay,
  type UploadItem,
  type UploadStore,
  type UploadTransport,
} from './queue';

/** Faux stockage du téléphone : survit à la « fermeture de l'onglet » (nouvelle file). */
function memoryStore(): UploadStore & { data: Map<string, UploadItem> } {
  const data = new Map<string, UploadItem>();
  return {
    data,
    all: async () => [...data.values()].map((i) => ({ ...i })),
    put: async (item) => void data.set(item.id, { ...item }),
    remove: async (id) => void data.delete(id),
  };
}

/** Faux réseau : chaque étape peut échouer selon le scénario du test. */
function fakeTransport() {
  const received = new Set<string>();
  const log: string[] = [];
  const receipts: string[] = [];
  const failures: { step: 'prepare' | 'upload' | 'confirm'; error: Error }[] = [];
  const failIfAsked = (step: 'prepare' | 'upload' | 'confirm') => {
    const i = failures.findIndex((f) => f.step === step);
    if (i >= 0) throw failures.splice(i, 1)[0]!.error;
  };
  const transport: UploadTransport = {
    async prepare(item) {
      log.push(`prepare ${item.id}`);
      failIfAsked('prepare');
      return received.has(item.id)
        ? {}
        : { url: `https://r2/${item.id}`, receipt: { jeton_envoi: `jeton-${item.id}` } };
    },
    async upload(url) {
      log.push(`upload ${url}`);
      failIfAsked('upload');
    },
    async confirm(item, receipt) {
      log.push(`confirm ${item.id}`);
      receipts.push(receipt?.jeton_envoi ?? '');
      failIfAsked('confirm');
      received.add(item.id);
      return { statut_voix: 'inscrite' };
    },
  };
  return { transport, received, log, failures, receipts };
}

const audio = (id: string, createdAt = 1) => ({
  id,
  token: 'jeton',
  sentenceId: 1,
  wav: new Blob(['RIFF']),
  metrics: {},
  mic: {},
  createdAt,
});
const offline = () => new TypeError('Failed to fetch');
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('UploadQueue', () => {
  it("écrit l'audio dans le téléphone avant l'envoi, et ne l'efface qu'après confirmation", async () => {
    const store = memoryStore();
    const net = fakeTransport();
    let storedBeforeUpload = false;
    const original = net.transport.upload;
    net.transport.upload = async (url, wav) => {
      storedBeforeUpload = store.data.has('a');
      return original(url, wav);
    };
    const queue = new UploadQueue(store, net.transport);
    await queue.add(audio('a'));
    await flush();
    expect(storedBeforeUpload).toBe(true);
    expect(net.received.has('a')).toBe(true);
    // Le jeton d'envoi donné à la préparation est renvoyé à la confirmation.
    expect(net.receipts).toEqual(['jeton-a']);
    expect(store.data.size).toBe(0);
    expect(queue.state.pending).toBe(0);
  });

  it('garde l’audio sans réseau et réessaie avec un délai croissant', async () => {
    const store = memoryStore();
    const net = fakeTransport();
    net.failures.push({ step: 'prepare', error: offline() }, { step: 'upload', error: offline() });
    const queue = new UploadQueue(store, net.transport);
    await queue.add(audio('a'));
    await flush();
    expect(store.data.get('a')?.attempts).toBe(1);
    expect(queue.state.pending).toBe(1);

    await vi.advanceTimersByTimeAsync(retryDelay(1)); // 2 s : échoue à l'envoi vers R2
    expect(store.data.get('a')?.attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(retryDelay(2) - 1); // pas encore
    expect(net.received.has('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // 4 s : réussit
    expect(net.received.has('a')).toBe(true);
    expect(store.data.size).toBe(0);
  });

  it('reprend les audios restés dans le téléphone après la fermeture de l’onglet', async () => {
    const store = memoryStore();
    const net = fakeTransport();
    net.failures.push({ step: 'prepare', error: offline() });
    await new UploadQueue(store, net.transport).add(audio('a'));
    await flush();
    expect(store.data.size).toBe(1);

    // « Réouverture » : une nouvelle file, le même stockage.
    const reopened = new UploadQueue(store, net.transport);
    await reopened.start();
    await vi.advanceTimersByTimeAsync(retryDelay(1));
    expect(net.received.has('a')).toBe(true);
    expect(store.data.size).toBe(0);
  });

  it('ne renvoie pas un audio déjà reçu (coupure juste après la confirmation)', async () => {
    const store = memoryStore();
    const net = fakeTransport();
    net.received.add('a');
    const queue = new UploadQueue(store, net.transport);
    await queue.add(audio('a'));
    await flush();
    expect(net.log).toEqual(['prepare a']);
    expect(store.data.size).toBe(0);
  });

  it('bloque un audio refusé définitivement sans bloquer les autres', async () => {
    const store = memoryStore();
    const net = fakeTransport();
    net.failures.push({ step: 'confirm', error: new ApiError(422, 'format_invalide') });
    const queue = new UploadQueue(store, net.transport);
    await queue.add(audio('a', 1));
    await queue.add(audio('b', 2));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.data.get('a')?.blocked).toBe('format_invalide');
    expect(net.received.has('b')).toBe(true);
    expect(queue.state).toEqual({ pending: 1, blocked: 1, paused: null });
  });

  it("s'arrête si le lien a expiré, sans rien effacer, et repart à la demande", async () => {
    const store = memoryStore();
    const net = fakeTransport();
    net.failures.push({ step: 'prepare', error: new ApiError(410, 'lien_expire') });
    const queue = new UploadQueue(store, net.transport);
    await queue.add(audio('a'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(queue.state.paused).toBe('lien_expire');
    expect(store.data.size).toBe(1);

    queue.retryNow();
    await flush();
    expect(net.received.has('a')).toBe(true);
    expect(queue.state).toEqual({ pending: 0, blocked: 0, paused: null });
  });

  it('se souvient des phrases enregistrées, en attente comme déjà envoyées', async () => {
    const net = fakeTransport();
    net.failures.push({ step: 'prepare', error: offline() });
    const queue = new UploadQueue(memoryStore(), net.transport);
    await queue.add({ ...audio('a'), sentenceId: 7 });
    await flush();
    expect(queue.recordedSentenceIds).toEqual(new Set([7])); // en attente
    await vi.advanceTimersByTimeAsync(retryDelay(1));
    expect(queue.state.pending).toBe(0);
    expect(queue.recordedSentenceIds).toEqual(new Set([7])); // envoyée : toujours comptée
  });

  it('envoie dans l’ordre d’enregistrement, un à la fois', async () => {
    const net = fakeTransport();
    const queue = new UploadQueue(memoryStore(), net.transport);
    await queue.add(audio('b', 2));
    await queue.add(audio('a', 1));
    await flush();
    expect(net.log.filter((l) => l.startsWith('confirm'))).toEqual(['confirm b', 'confirm a']);
  });
});
