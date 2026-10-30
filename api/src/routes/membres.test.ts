import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
import { testEnv } from '../test-env';

const USER = '5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
let calls: { url: string; method: string; headers: Headers; body: unknown }[];
let isAdmin: boolean;
let authStatus: number;
let authError: string;
let addMember: { status: number; body: unknown };
let logReset: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  isAdmin = true;
  authStatus = 200;
  authError = '';
  addMember = { status: 200, body: null };
  logReset = { status: 200, body: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.endsWith('/rpc/is_admin')) return new Response(JSON.stringify(isAdmin));
      if (url.endsWith('/rpc/add_team_member')) {
        return new Response(JSON.stringify(addMember.body), { status: addMember.status });
      }
      if (url.endsWith('/rpc/log_password_reset')) {
        return new Response(JSON.stringify(logReset.body), { status: logReset.status });
      }
      if (url.endsWith('/auth/v1/admin/users')) {
        const body = authStatus === 200 ? { id: USER } : { error_code: authError };
        return new Response(JSON.stringify(body), { status: authStatus });
      }
      return new Response(null, { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const create = (body: unknown) =>
  app.request(
    '/equipe/membres',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer jeton-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    testEnv(),
  );

const member = {
  email: 'Awa@Exemple.org',
  mot_de_passe: 'provisoire-123',
  nom: 'Awa',
  roles: ['verificateur'],
  langues: ['ttq'],
};

describe("création d'un membre (page « Membres »)", () => {
  it('crée le compte (confirmé), puis le place dans l’équipe avec la session de l’admin', async () => {
    const res = await create(member);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: 'awa@exemple.org' });
    const account = calls.find((c) => c.url.endsWith('/auth/v1/admin/users'))!;
    expect(account.body).toEqual({
      email: 'awa@exemple.org',
      password: 'provisoire-123',
      email_confirm: true,
    });
    // La création du compte demande la clé secrète ; le reste, la session de l'admin.
    expect(account.headers.get('apikey')).toBe('sb_secret_test');
    const added = calls.find((c) => c.url.endsWith('/rpc/add_team_member'))!;
    expect(added.headers.get('Authorization')).toBe('Bearer jeton-admin');
    expect(added.body).toEqual({
      p_user_id: USER,
      p_name: 'Awa',
      p_roles: ['verificateur'],
      p_languages: ['ttq'],
    });
  });

  it("refuse si la personne connectée n'est pas admin, sans créer de compte", async () => {
    isAdmin = false;
    expect((await create(member)).status).toBe(403);
    expect(calls.some((c) => c.url.includes('/auth/v1/'))).toBe(false);
  });

  it('signale un e-mail déjà utilisé', async () => {
    authStatus = 422;
    authError = 'email_exists';
    const res = await create(member);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erreur: 'email_existe' });
  });

  it('signale un mot de passe refusé par Supabase (sans le confondre avec un e-mail pris)', async () => {
    authStatus = 422;
    authError = 'weak_password';
    const res = await create(member);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erreur: 'weak_password' });
  });

  it('supprime le compte si la base refuse de l’ajouter (déjà deux admins)', async () => {
    addMember = { status: 400, body: { code: 'P0001', message: 'deux_admins_max' } };
    const res = await create({ ...member, roles: ['admin'] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erreur: 'deux_admins_max' });
    const removed = calls.find((c) => c.method === 'DELETE')!;
    expect(removed.url).toMatch(new RegExp(`/auth/v1/admin/users/${USER}$`));
  });

  it('refuse un mot de passe trop court, un rôle ou un code de langue invalide', async () => {
    expect((await create({ ...member, mot_de_passe: 'court' })).status).toBe(400);
    expect((await create({ ...member, roles: ['patron'] })).status).toBe(400);
    expect((await create({ ...member, langues: ['Kanouri'] })).status).toBe(400);
    expect((await create({ ...member, langues: 'kby' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

const reset = (id: string, body: unknown) =>
  app.request(
    `/equipe/membres/${id}/mot-de-passe`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer jeton-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    testEnv(),
  );

describe('nouveau mot de passe donné par un admin', () => {
  it('fait vérifier le droit par la base (session de l’admin), puis change le mot de passe', async () => {
    const res = await reset(USER, { mot_de_passe: 'nouveau-mdp-482' });
    expect(res.status).toBe(200);
    const logged = calls.findIndex((c) => c.url.endsWith('/rpc/log_password_reset'));
    const changed = calls.findIndex((c) => c.url.endsWith(`/auth/v1/admin/users/${USER}`));
    expect(logged).toBeGreaterThanOrEqual(0);
    expect(changed).toBeGreaterThan(logged);
    expect(calls[logged]!.headers.get('Authorization')).toBe('Bearer jeton-admin');
    expect(calls[changed]!.method).toBe('PUT');
    expect(calls[changed]!.headers.get('apikey')).toBe('sb_secret_test');
    expect(calls[changed]!.body).toEqual({ password: 'nouveau-mdp-482' });
  });

  it('ne change rien si la base refuse (pas admin)', async () => {
    logReset = { status: 400, body: { code: 'P0001', message: 'acces_refuse' } };
    expect((await reset(USER, { mot_de_passe: 'nouveau-mdp-482' })).status).toBe(403);
    expect(calls.some((c) => c.url.includes('/auth/v1/'))).toBe(false);
  });

  it('refuse un mot de passe trop court', async () => {
    expect((await reset(USER, { mot_de_passe: 'court' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
