import { encodeWav } from '@murya/commun';
import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import app from './index';
import { safeEqual } from './util';

const ID = '3f0c1d2e-4b5a-4c6d-8e7f-001122334455';

/** Faux bucket R2 en mémoire : suffisant pour tester la logique de l'API sans réseau. */
function fakeBucket(files: Record<string, Uint8Array> = {}) {
  return {
    files,
    async head(key: string) {
      return files[key] ? { size: files[key].byteLength } : null;
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const file = files[key];
      if (!file) return null;
      const { offset = 0, length = file.byteLength } = options?.range ?? {};
      const part = file.slice(offset, offset + length);
      return { arrayBuffer: async () => part.buffer };
    },
    async delete(key: string) {
      delete files[key];
    },
  };
}

function env(overrides: Partial<Env> = {}, files?: Record<string, Uint8Array>): Env {
  return {
    ENVIRONMENT: 'local',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    R2_ACCOUNT_ID: 'compte',
    R2_BUCKET_AUDIO: 'murya-audio-staging',
    R2_ACCESS_KEY_ID: 'cle',
    R2_SECRET_ACCESS_KEY: 'secret',
    PROOF_CODE: 'zarma2027',
    AUDIO: fakeBucket(files) as unknown as R2Bucket,
    ...overrides,
  };
}

const post = (path: string, body: unknown, e: Env) =>
  app.request(
    path,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    e,
  );

describe('GET /sante', () => {
  it("répond et n'envoie jamais de Referer", async () => {
    const res = await app.request('/sante', {}, env());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, environnement: 'local' });
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});

describe('CORS', () => {
  it("n'autorise que les origines configurées", async () => {
    const ok = await app.request('/sante', { headers: { Origin: 'http://localhost:5173' } }, env());
    const ko = await app.request(
      '/sante',
      { headers: { Origin: 'https://pirate.example' } },
      env(),
    );
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(ko.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('page de preuve', () => {
  it('est désactivée sans PROOF_CODE', async () => {
    const res = await post('/preuve/url-envoi', { code: 'x', id: ID }, env({ PROOF_CODE: '' }));
    expect(res.status).toBe(404);
  });

  it('refuse un mauvais code', async () => {
    const res = await post('/preuve/url-envoi', { code: 'faux', id: ID }, env());
    expect(res.status).toBe(403);
  });

  it('refuse un identifiant qui n’est pas un UUID', async () => {
    const res = await post('/preuve/url-envoi', { code: 'zarma2027', id: '../../secret' }, env());
    expect(res.status).toBe(400);
  });

  it('renvoie une URL d’envoi signée vers R2', async () => {
    const res = await post('/preuve/url-envoi', { code: 'zarma2027', id: ID }, env());
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.host).toBe('compte.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe(`/murya-audio-staging/preuve/${ID}.wav`);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('confirme un WAV reçu et en lit le format', async () => {
    const wav = encodeWav(new Float32Array(16_000 * 2), 16_000); // 2 secondes
    const res = await post(
      '/preuve/confirmer',
      { code: 'zarma2027', id: ID },
      env({}, { [`preuve/${ID}.wav`]: wav }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taille: 64_044,
      frequence: 16_000,
      canaux: 1,
      bits: 16,
      duree_ms: 2000,
    });
  });

  it('signale un fichier absent', async () => {
    const res = await post('/preuve/confirmer', { code: 'zarma2027', id: ID }, env());
    expect(res.status).toBe(404);
  });

  it('supprime un fichier trop gros', async () => {
    const files = { [`preuve/${ID}.wav`]: new Uint8Array(3_000_000) };
    const res = await post('/preuve/confirmer', { code: 'zarma2027', id: ID }, env({}, files));
    expect(res.status).toBe(413);
    expect(files).toEqual({});
  });
});

describe('safeEqual', () => {
  it('compare correctement', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
