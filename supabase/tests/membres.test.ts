// Gestion de l'équipe par les admins (page « Membres ») : annuaire, ajout, garde-fous.

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createMember, createTestDb } from './helpers/db';

let db: PGlite;
let admin: string;
let recruiter: string;

async function as<T>(user: string, query: string, params: unknown[] = []): Promise<T> {
  return asUser(db, user, async () => (await db.query<{ r: T }>(query, params)).rows[0]!.r);
}

beforeAll(async () => {
  db = await createTestDb();
  admin = await createMember(db, 'admin', ['admin']);
  recruiter = await createMember(db, 'recruteur', ['recruteur']);
});

describe("gestion de l'équipe", () => {
  it("donne aux admins la liste de l'équipe, avec les e-mails ; refusée aux autres", async () => {
    const list = await as<{ nom: string; email: string; roles: string[] }[]>(
      admin,
      `select public.team_directory() as r`,
    );
    expect(list.map((m) => m.email).sort()).toEqual(['admin@test.murya', 'recruteur@test.murya']);
    await expect(as(recruiter, `select public.team_directory() as r`)).rejects.toThrow(
      'acces_refuse',
    );
  });

  it('ajoute un compte existant à l’équipe, avec ses rôles (admins seulement)', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('nouveau@test.murya') returning id`,
    );
    const id = rows[0]!.id;
    await expect(
      as(recruiter, `select public.add_team_member($1, 'Awa', '{verificateur}') as r`, [id]),
    ).rejects.toThrow('acces_refuse');
    await expect(
      as(admin, `select public.add_team_member($1, '  ', '{verificateur}') as r`, [id]),
    ).rejects.toThrow('nom_obligatoire');
    await as(admin, `select public.add_team_member($1, 'Awa', '{verificateur}') as r`, [id]);
    const roles = (
      await db.query<{ roles: string[] }>(
        `select roles from public.team_members where user_id = $1`,
        [id],
      )
    ).rows[0]!.roles;
    expect(roles).toEqual(['verificateur']);
  });

  it('note au journal un mot de passe donné par un admin ; refusé aux autres', async () => {
    await as(admin, `select public.log_password_reset($1) as r`, [recruiter]);
    const { rows } = await db.query<{ action: string; target_id: string }>(
      `select action, target_id from public.audit_log where action = 'mot_de_passe_change'`,
    );
    expect(rows).toEqual([{ action: 'mot_de_passe_change', target_id: recruiter }]);
    await expect(
      as(recruiter, `select public.log_password_reset($1) as r`, [admin]),
    ).rejects.toThrow('acces_refuse');
    await expect(
      as(admin, `select public.log_password_reset(gen_random_uuid()) as r`),
    ).rejects.toThrow('membre_inconnu');
  });

  it('garde toujours au moins un admin actif', async () => {
    await expect(
      asUser(db, admin, () =>
        db.query(`update public.team_members set roles = '{recruteur}' where user_id = $1`, [
          admin,
        ]),
      ),
    ).rejects.toThrow('dernier_admin');
    await expect(
      asUser(db, admin, () =>
        db.query(`update public.team_members set active = false where user_id = $1`, [admin]),
      ),
    ).rejects.toThrow('dernier_admin');
    // Avec un deuxième admin, le premier peut quitter ce rôle.
    await asUser(db, admin, () =>
      db.query(`update public.team_members set roles = '{recruteur,admin}' where user_id = $1`, [
        recruiter,
      ]),
    );
    await asUser(db, admin, () =>
      db.query(`update public.team_members set roles = '{verificateur}' where user_id = $1`, [
        admin,
      ]),
    );
  });
});
