import { encodeWav } from '@murya/commun';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import app from './index';
import { testEnv as env } from './test-env';
import { safeEqual } from './util';

const ID = '3f0c1d2e-4b5a-4c6d-8e7f-001122334455';

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

  describe('?verifier=r2', () => {
    afterEach(() => vi.unstubAllGlobals());

    const checkWith = async (status: number, e = env()) => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status }));
      vi.stubGlobal('fetch', fetchMock);
      const res = await app.request('/sante?verifier=r2', {}, e);
      return { res, body: (await res.json()) as Record<string, unknown>, fetchMock };
    };

    it('signale des clés acceptées quand R2 répond « introuvable » (404)', async () => {
      const { res, body, fetchMock } = await checkWith(404);
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, r2: 'ok' });
      // Une seule lecture, signée, d'un fichier qui n'existe pas : rien n'est créé.
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe('/murya-audio-staging/sante/fichier-absent.txt');
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    });

    it('signale des clés refusées (403)', async () => {
      const { res, body } = await checkWith(403);
      expect(res.status).toBe(503);
      expect(body).toMatchObject({ ok: false, r2: 'cles_refusees' });
    });

    it('signale des clés absentes sans appeler R2', async () => {
      const { body, fetchMock } = await checkWith(404, env({ R2_SECRET_ACCESS_KEY: '' }));
      expect(body).toMatchObject({ ok: false, r2: 'non_configure' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
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
