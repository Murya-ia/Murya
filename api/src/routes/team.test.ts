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

describe("retrait d'une voix (spec §5.8)", () => {
  const SPEAKER = '7b6a5c4d-3e2f-4a1b-9c8d-aabbccddeeff';
  const withdrawal = {
    numero: 'V012',
    langue: 'dje',
    date: '2026-10-30T10:00:00Z',
    audios: 2,
    tache: 41,
    prefixes_audio: ['dje/varie/V012/', 'dje/principale/V012/'],
    cles_audio: ['dje/varie/V012/dje_V012_S0001_1.wav'],
    cles_identites: ['consentements-oraux/abc/accord.m4a'],
  };
  const files = () => ({
    'dje/varie/V012/dje_V012_S0001_1.wav': new Uint8Array(4),
    // Envoi resté à moitié : inconnu de la base, mais dans le dossier de la voix.
    'dje/varie/V012/dje_V012_S0002_1.wav': new Uint8Array(4),
    'dje/varie/V013/dje_V013_S0001_1.wav': new Uint8Array(4),
  });
  const withdraw = (e: Env, confirmation: unknown = 'V012') =>
    app.request(
      `/equipe/retrait/${SPEAKER}`,
      {
        method: 'POST',
        body: JSON.stringify({ confirmation }),
        headers: { Authorization: 'Bearer jeton', 'Content-Type': 'application/json' },
      },
      e,
    );

  it('demande le retrait à la base avec la session de l’admin, puis efface les fichiers', async () => {
    const audio = fakeBucket(files());
    const identites = fakeBucket({ 'consentements-oraux/abc/accord.m4a': new Uint8Array(4) });
    reply = { body: withdrawal };
    const res = await withdraw(
      testEnv({
        AUDIO: audio as unknown as R2Bucket,
        IDENTITES: identites as unknown as R2Bucket,
      }),
    );
    expect(await res.json()).toEqual({ numero: 'V012', audios: 2, fichiers_effaces: true });
    expect(calls[0]).toMatchObject({
      fn: 'withdraw_speaker',
      args: { p_speaker_id: SPEAKER, p_confirm_number: 'V012' },
    });
    expect(calls[0]!.headers.get('apikey')).toBe('sb_publishable_test');
    // Tout le dossier de la voix est effacé ; les autres voix ne sont pas touchées.
    expect(Object.keys(audio.files).sort()).toEqual([
      'dje/varie/V013/dje_V013_S0001_1.wav',
      'retraits/dje/V012.json',
    ]);
    expect(JSON.parse(new TextDecoder().decode(audio.files['retraits/dje/V012.json']))).toEqual({
      langue: 'dje',
      numero: 'V012',
      date: '2026-10-30T10:00:00Z',
    });
    expect(identites.files).toEqual({});
    // La tâche est marquée faite avec la clé secrète (service), pas avec la session.
    expect(calls[1]).toMatchObject({ fn: 'worker_job_done', args: { p_job_id: 41 } });
    expect(calls[1]!.headers.get('apikey')).toBe('sb_secret_test');
  });

  it('transmet le refus de la base (pas admin, mauvaise confirmation)', async () => {
    reply = { status: 400, body: { code: 'P0001', message: 'confirmation_incorrecte' } };
    const res = await withdraw(testEnv(), 'V999');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erreur: 'confirmation_incorrecte' });
    expect(calls).toHaveLength(1);
  });

  it('si le stockage échoue, la voix reste retirée et la tâche attend la reprise', async () => {
    const broken = fakeBucket(files());
    broken.delete = async () => {
      throw new Error('R2 indisponible');
    };
    reply = { body: withdrawal };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await withdraw(testEnv({ AUDIO: broken as unknown as R2Bucket }));
    expect(await res.json()).toMatchObject({ numero: 'V012', fichiers_effaces: false });
    expect(calls.map((c) => c.fn)).toEqual(['withdraw_speaker']);
  });

  it('refuse une requête mal formée', async () => {
    expect((await withdraw(testEnv(), 12)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('tâche planifiée : reprise des effacements', () => {
  it('prend les tâches en attente, efface, puis marque chaque tâche faite', async () => {
    const audio = fakeBucket({ 'dje/varie/V020/a.wav': new Uint8Array(1) });
    const replies: unknown[] = [
      [
        {
          id: 7,
          payload: {
            langue: 'dje',
            numero: 'V020',
            date: '2026-10-30T10:00:00Z',
            prefixes_audio: ['dje/varie/V020/'],
            cles_audio: [],
            cles_identites: [],
          },
        },
      ],
      null,
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          fn: String(input).split('/rpc/')[1]!,
          headers: new Headers(init?.headers),
          args: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify(replies.shift() ?? null));
      }),
    );
    const { processPendingErasures } = await import('../erasure');
    const stats = await processPendingErasures(testEnv({ AUDIO: audio as unknown as R2Bucket }));
    expect(stats).toEqual({ faites: 1, echecs: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['worker_claim_jobs', 'worker_job_done']);
    expect(calls[0]!.args).toMatchObject({ p_kinds: ['effacer_fichiers'] });
    expect(Object.keys(audio.files)).toEqual(['retraits/dje/V020.json']);
  });
});
