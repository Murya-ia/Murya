import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signedDownloadUrl } from './exports';
import app from './index';
import { fakeBucket, testEnv } from './test-env';

const README = new TextEncoder().encode('# Murya — dje, voix variées, version 001\n');
let calls: { fn: string; headers: Headers; args: Record<string, unknown> }[];
let reply: unknown;

beforeEach(() => {
  calls = [];
  reply = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        fn: String(input).split('/rpc/')[1]!,
        headers: new Headers(init?.headers),
        args: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify(reply));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function env() {
  return testEnv({
    EXPORTS: fakeBucket({ 'dje/varie/v001/README.md': README }) as unknown as R2Bucket,
  });
}

const askLink = (e = env(), body: unknown = { fichier: 'README.md' }) =>
  app.request(
    '/equipe/exports/4/lien',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer jeton-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    e,
  );

describe('téléchargement des exports (spec §5.9)', () => {
  it('donne à un admin un lien signé, valable 15 minutes, qui sert le fichier', async () => {
    reply = 'dje/varie/v001';
    const e = env();
    const res = await askLink(e);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    // La base vérifie le rôle avec la session du membre (et note le téléchargement).
    expect(calls[0]).toMatchObject({
      fn: 'export_location',
      args: { p_export_id: 4, p_file: 'README.md' },
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer jeton-admin');
    const exp = Number(new URL(url).searchParams.get('exp'));
    expect(exp - Date.now() / 1000).toBeGreaterThan(890);

    const file = await app.request(new URL(url).pathname + new URL(url).search, {}, e);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Disposition')).toBe(
      'attachment; filename="murya-dje-varie-v001-README.md"',
    );
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(README);
  });

  it('refuse quand la base ne donne rien (pas admin, export pas prêt)', async () => {
    reply = null;
    expect((await askLink()).status).toBe(404);
  });

  it("refuse un fichier qui ne fait pas partie d'un export", async () => {
    expect((await askLink(env(), { fichier: '../identites/x' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuse un lien modifié ou expiré', async () => {
    const e = env();
    const url = new URL(
      await signedDownloadUrl(e, 'https://api.test', 'dje/varie/v001', 'README.md'),
    );
    url.searchParams.set('dossier', 'dje/principale/v001');
    expect((await app.request(url.pathname + url.search, {}, e)).status).toBe(403);

    const old = new URL(
      await signedDownloadUrl(
        e,
        'https://api.test',
        'dje/varie/v001',
        'README.md',
        Date.now() - 3_600_000,
      ),
    );
    expect((await app.request(old.pathname + old.search, {}, e)).status).toBe(410);
  });
});
