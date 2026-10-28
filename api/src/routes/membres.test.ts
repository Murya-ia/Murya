import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
import { testEnv } from '../test-env';

const USER = '5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
let calls: { url: string; method: string; headers: Headers; body: unknown }[];
let isAdmin: boolean;
let authStatus: number;
let addMember: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  isAdmin = true;
  authStatus = 200;
  addMember = { status: 200, body: null };
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
      if (url.endsWith('/rpc/has_role')) return new Response(JSON.stringify(isAdmin));
      if (url.endsWith('/rpc/add_team_member')) {
        return new Response(JSON.stringify(addMember.body), { status: addMember.status });
      }
      if (url.endsWith('/auth/v1/admin/users')) {
        return new Response(JSON.stringify({ id: USER }), { status: authStatus });
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
    expect(added.body).toEqual({ p_user_id: USER, p_name: 'Awa', p_roles: ['verificateur'] });
  });

  it("refuse si la personne connectée n'est pas admin, sans créer de compte", async () => {
    isAdmin = false;
    expect((await create(member)).status).toBe(403);
    expect(calls.some((c) => c.url.includes('/auth/v1/'))).toBe(false);
  });

  it('signale un e-mail déjà utilisé', async () => {
    authStatus = 422;
    const res = await create(member);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erreur: 'email_existe' });
  });

  it('supprime le compte si la base refuse de l’ajouter (déjà deux admins)', async () => {
    addMember = { status: 400, body: { code: 'P0001', message: 'deux_admins_max' } };
    const res = await create({ ...member, roles: ['admin'] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erreur: 'deux_admins_max' });
    const removed = calls.find((c) => c.method === 'DELETE')!;
    expect(removed.url).toMatch(new RegExp(`/auth/v1/admin/users/${USER}$`));
  });

  it('refuse un mot de passe trop court ou un rôle inconnu', async () => {
    expect((await create({ ...member, mot_de_passe: 'court' })).status).toBe(400);
    expect((await create({ ...member, roles: ['patron'] })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
