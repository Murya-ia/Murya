import { encodeWav } from '@murya/commun';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import app from '../index';
import { testEnv } from '../test-env';
import { sha256Hex } from '../util';

const TOKEN = 'A'.repeat(43);
const RECORDING = '3f0c1d2e-4b5a-4c6d-8e7f-001122334455';
const KEY = 'dje/varie/V001/dje_V001_T001_1.wav';

/** Appels reçus par le faux Supabase, et réponses à renvoyer par fonction SQL. */
let calls: { fn: string; args: Record<string, unknown> }[];
let replies: Record<string, { status?: number; body: unknown }>;

beforeEach(() => {
  calls = [];
  replies = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const fn = String(input).split('/rpc/')[1]!;
      calls.push({ fn, args: JSON.parse(String(init?.body)) });
      const reply = replies[fn] ?? { body: null };
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const request = (method: string, path: string, body?: unknown, e: Env = testEnv(), token = TOKEN) =>
  app.request(
    path,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    e,
  );

describe('jeton', () => {
  it('refuse une requête sans jeton valide, sans appeler la base', async () => {
    const res = await request('GET', '/voix/session', undefined, testEnv(), 'trop-court');
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("transmet seulement l'empreinte du jeton, jamais le jeton lui-même", async () => {
    replies.voice_session = { body: { langue: 'dje' } };
    const res = await request('GET', '/voix/session');
    expect(res.status).toBe(200);
    expect(calls[0]!.args).toEqual({ p_token_hash: await sha256Hex(TOKEN) });
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it('renvoie les erreurs métier de la base avec un code HTTP clair', async () => {
    replies.voice_session = { status: 400, body: { code: 'P0001', message: 'lien_expire' } };
    const res = await request('GET', '/voix/session');
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ erreur: 'lien_expire' });
  });

  it('applique la limite de débit par jeton', async () => {
    const limited = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await request('GET', '/voix/session', undefined, testEnv({ RL_TOKEN: limited }));
    expect(res.status).toBe(429);
  });

  it("lève la limite par adresse IP pendant un essai de charge, jusqu'à l'heure prévue", async () => {
    const limited = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    const during = testEnv({ RL_IP: limited, CHARGE_JUSQUA: later });
    expect((await request('GET', '/voix/session', undefined, during)).status).toBe(200);
    const after = testEnv({ RL_IP: limited, CHARGE_JUSQUA: earlier });
    expect((await request('GET', '/voix/session', undefined, after)).status).toBe(429);
    // La limite par jeton, elle, reste toujours active.
    const token = testEnv({ RL_TOKEN: limited, CHARGE_JUSQUA: later });
    expect((await request('GET', '/voix/session', undefined, token)).status).toBe(429);
  });
});

describe('consentement et fiche', () => {
  it('valide les champs avant de les transmettre', async () => {
    const res = await request('POST', '/voix/consentement', {
      consentement_id: 1,
      points: ['a'],
      langue_interface: 'en',
    });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('transmet un consentement bien formé', async () => {
    replies.voice_consent = { body: { numero: 'V001' } };
    const res = await request('POST', '/voix/consentement', {
      consentement_id: 1,
      points: ['enregistrement'],
      langue_interface: 'dje',
      nom: 'Awa',
    });
    expect(await res.json()).toEqual({ numero: 'V001' });
    expect(calls[0]!.args).toMatchObject({ p_consent_id: 1, p_full_name: 'Awa', p_contact: null });
  });
});

describe('phrases', () => {
  it("voix principale : donne l'audio de référence par une adresse signée, jamais sa clé", async () => {
    replies.voice_sentences = {
      body: { etape: 'lot', phrases: [], seance: { numero: 2, reference_cle: KEY } },
    };
    const body = (await (await request('GET', '/voix/phrases')).json()) as {
      seance: Record<string, unknown>;
    };
    expect(body.seance.numero).toBe(2);
    expect(body.seance.reference_cle).toBeUndefined();
    expect(new URL(body.seance.reference_url as string).pathname).toBe(
      `/murya-audio-staging/${KEY}`,
    );
  });

  it('sans audio de référence choisi, ne donne pas d’adresse', async () => {
    replies.voice_sentences = {
      body: { etape: 'lot', phrases: [], seance: { numero: 1, reference_cle: null } },
    };
    const body = (await (await request('GET', '/voix/phrases')).json()) as {
      seance: Record<string, unknown>;
    };
    expect(body.seance).toEqual({ numero: 1 });
  });
});

describe('envoi des audios', () => {
  it('prépare un envoi : URL signée vers R2 pour la clé fixée par la base', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'en_envoi' } };
    const res = await request('POST', '/voix/envoi/preparer', { id: RECORDING, phrase_id: 7 });
    const body = (await res.json()) as { url: string; cle: string };
    expect(body.cle).toBe(KEY);
    expect(new URL(body.url).pathname).toBe(`/murya-audio-staging/${KEY}`);
    expect(calls[0]!.args).toMatchObject({ p_recording_id: RECORDING, p_sentence_id: 7 });
  });

  it('ne redonne pas d’URL pour un audio déjà reçu', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'recu' } };
    const res = await request('POST', '/voix/envoi/preparer', { id: RECORDING, phrase_id: 7 });
    expect(await res.json()).toEqual({ deja_recu: true, cle: KEY });
  });

  it('confirme avec la taille et la durée lues dans R2, pas celles du navigateur', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'en_envoi' } };
    replies.voice_confirm_upload = { body: { statut_voix: 'inscrite', deja_recu: false } };
    const wav = encodeWav(new Float32Array(16_000 * 2), 16_000);
    const res = await request(
      'POST',
      '/voix/envoi/confirmer',
      {
        id: RECORDING,
        phrase_id: 7,
        mesures: { duree_ms: 99 },
        micro: { echoCancellation: false },
      },
      testEnv({}, { [KEY]: wav }),
    );
    expect(res.status).toBe(200);
    expect(calls[1]).toEqual({
      fn: 'voice_confirm_upload',
      args: expect.objectContaining({
        p_size_bytes: wav.byteLength,
        p_duration_ms: 2000,
        p_sample_rate: 16_000,
        p_client_metrics: { duree_ms: 99 },
      }),
    });
  });

  it('refuse et supprime un fichier qui n’est pas au format de la spec', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'en_envoi' } };
    const files = { [KEY]: encodeWav(new Float32Array(48_000), 48_000) }; // 48 kHz pour une voix variée
    const res = await request(
      'POST',
      '/voix/envoi/confirmer',
      { id: RECORDING, phrase_id: 7 },
      testEnv({}, files),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ erreur: 'format_invalide' });
    expect(files).toEqual({});
    expect(calls.map((c) => c.fn)).toEqual(['voice_prepare_upload']);
  });

  it('signale un fichier pas encore arrivé dans R2', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'en_envoi' } };
    const res = await request('POST', '/voix/envoi/confirmer', { id: RECORDING, phrase_id: 7 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ erreur: 'fichier_absent' });
  });

  it('confirme en un seul appel à la base grâce au jeton d’envoi donné à la préparation', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'en_envoi' } };
    const prepared = (await (
      await request('POST', '/voix/envoi/preparer', { id: RECORDING, phrase_id: 7 })
    ).json()) as { cle: string; jeton_envoi: string };
    expect(prepared.jeton_envoi).toMatch(/^[0-9a-f]{64}$/);

    calls = [];
    replies.voice_confirm_upload = { body: { statut_voix: 'active', deja_recu: false } };
    const wav = encodeWav(new Float32Array(16_000), 16_000);
    const res = await request(
      'POST',
      '/voix/envoi/confirmer',
      { id: RECORDING, phrase_id: 7, cle: prepared.cle, jeton_envoi: prepared.jeton_envoi },
      testEnv({}, { [KEY]: wav }),
    );
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.fn)).toEqual(['voice_confirm_upload']);
  });

  it('ignore un jeton d’envoi falsifié ou pris à une autre voix : la base est consultée', async () => {
    replies.voice_prepare_upload = { body: { cle: KEY, prise: 1, statut: 'en_envoi' } };
    const other = 'dje/varie/V002/dje_V002_T001_1.wav';
    const files = { [KEY]: encodeWav(new Float32Array(16_000), 16_000) };
    const res = await request(
      'POST',
      '/voix/envoi/confirmer',
      { id: RECORDING, phrase_id: 7, cle: other, jeton_envoi: 'f'.repeat(64) },
      testEnv({}, files),
    );
    expect(res.status).toBe(200);
    // La clé vient de la base (celle de cette voix), pas de la requête.
    expect(calls.map((c) => c.fn)).toEqual(['voice_prepare_upload', 'voice_confirm_upload']);
  });

  it('refuse un identifiant d’enregistrement qui n’est pas un UUID', async () => {
    const res = await request('POST', '/voix/envoi/preparer', { id: '../x', phrase_id: 7 });
    expect(res.status).toBe(400);
  });
});
