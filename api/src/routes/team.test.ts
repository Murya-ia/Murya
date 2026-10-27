import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import app from '../index';
import { fakeBucket, testEnv } from '../test-env';

const RECORDING = '3f0c1d2e-4b5a-4c6d-8e7f-001122334455';
const INVITE = '9a8b7c6d-5e4f-4a3b-8c2d-112233445566';

let calls: { fn: string; headers: Headers; args: Record<string, unknown> }[];
let reply: { status?: number; body: unknown };

beforeEach(() => {
  calls = [];
  reply = { body: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        fn: String(input).split('/rpc/')[1]!,
        headers: new Headers(init?.headers),
        args: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const get = (path: string, e: Env = testEnv(), jwt = 'jeton-de-session') =>
  app.request(path, { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} }, e);

describe('écoute des audios', () => {
  it('demande à la base, avec la session du membre, s’il peut écouter cet audio', async () => {
    reply = { body: 'dje/varie/V001/dje_V001_S0001_1.wav' };
    const res = await get(`/equipe/audio/${RECORDING}`);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).pathname).toBe('/murya-audio-staging/dje/varie/V001/dje_V001_S0001_1.wav');
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('900');
    expect(calls[0]!.fn).toBe('team_audio_key');
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer jeton-de-session');
    // Clé publique, jamais la clé secrète : ce sont les droits du membre qui s'appliquent.
    expect(calls[0]!.headers.get('apikey')).toBe('sb_publishable_test');
  });

  it('répond « introuvable » quand la base ne donne rien (audio absent ou interdit)', async () => {
    reply = { body: null };
    expect((await get(`/equipe/audio/${RECORDING}`)).status).toBe(404);
  });

  it('refuse sans session, et signale une session expirée', async () => {
    expect((await get(`/equipe/audio/${RECORDING}`, testEnv(), '')).status).toBe(401);
    reply = { status: 401, body: { message: 'JWT expired' } };
    const res = await get(`/equipe/audio/${RECORDING}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erreur: 'session_expiree' });
  });
});

describe('consentement oral', () => {
  const send = (file: File, e: Env) => {
    const form = new FormData();
    form.set('invite_id', INVITE);
    form.set('nom', 'Mariama');
    form.set('fichier', file);
    return app.request(
      '/equipe/consentement-oral',
      { method: 'POST', body: form, headers: { Authorization: 'Bearer jeton' } },
      e,
    );
  };
  const audio = () => new File([new Uint8Array(100)], 'accord.m4a', { type: 'audio/mp4' });

  it('range le fichier dans le bucket des identités, puis enregistre le consentement', async () => {
    const identites = fakeBucket();
    reply = { body: { numero: 'V007' } };
    const res = await send(audio(), testEnv({ IDENTITES: identites as unknown as R2Bucket }));
    expect(await res.json()).toEqual({ numero: 'V007' });
    const [key] = Object.keys(identites.files);
    expect(key).toMatch(new RegExp(`^consentements-oraux/${INVITE}/[0-9a-f-]+\\.m4a$`));
    expect(calls[0]).toMatchObject({ fn: 'record_oral_consent', args: { p_audio_key: key } });
  });

  it('supprime le fichier si la base refuse', async () => {
    const identites = fakeBucket();
    reply = { status: 400, body: { code: 'P0001', message: 'acces_refuse' } };
    const res = await send(audio(), testEnv({ IDENTITES: identites as unknown as R2Bucket }));
    expect(res.status).toBe(403);
    expect(identites.files).toEqual({});
  });

  it("refuse un fichier qui n'est pas un audio", async () => {
    const res = await send(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }), testEnv());
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
