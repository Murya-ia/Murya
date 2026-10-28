-- =============================================================================
-- Gestion de l'équipe par les admins, depuis l'espace équipe (page « Membres ») :
-- voir les comptes (avec leur e-mail), créer un membre (le compte est créé par l'API),
-- changer ses rôles, le désactiver. Plus besoin d'aller dans Supabase.
-- =============================================================================

-- Liste de l'équipe pour les admins : rôles, état, e-mail et dernière connexion.
create function acces.team_directory() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id, 'nom', m.display_name, 'roles', to_jsonb(m.roles),
      'actif', m.active, 'email', u.email, 'derniere_connexion', u.last_sign_in_at,
      'cree_le', m.created_at) order by m.active desc, m.display_name)
    from public.team_members m join auth.users u on u.id = m.user_id
  ), '[]');
end $$;

create function public.team_directory() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select acces.team_directory();
$$;

-- Ajoute à l'équipe un compte que l'API vient de créer (admins seulement).
create function acces.add_team_member(p_user_id uuid, p_name text, p_roles text[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    perform acces.fail('nom_obligatoire');
  end if;
  insert into public.team_members (user_id, display_name, roles)
  values (p_user_id, btrim(p_name), coalesce(p_roles, '{}'));
end $$;

create function public.add_team_member(p_user_id uuid, p_name text, p_roles text[]) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.add_team_member(p_user_id, p_name, p_roles);
$$;

-- Deux admins au maximum (spec §2) : même règle, avec un code d'erreur que l'espace équipe
-- sait traduire en message clair.
create or replace function public.check_admin_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.active and 'admin' = any(new.roles) and (
    select count(*) from public.team_members
    where active and 'admin' = any(roles) and user_id <> new.user_id
  ) >= 2 then
    raise exception 'deux_admins_max';
  end if;
  return new;
end $$;

-- Il reste toujours au moins un admin actif : sinon plus personne ne pourrait gérer l'équipe.
create function public.check_last_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.active and 'admin' = any(old.roles)
     and (tg_op = 'DELETE' or not new.active or not ('admin' = any(new.roles)))
     and not exists (
       select 1 from public.team_members
       where active and 'admin' = any(roles) and user_id <> old.user_id
     ) then
    raise exception 'dernier_admin';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger team_members_last_admin before update or delete on public.team_members
  for each row execute function public.check_last_admin();

revoke execute on function public.check_last_admin() from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'acces.team_directory()', 'public.team_directory()',
    'acces.add_team_member(uuid, text, text[])', 'public.add_team_member(uuid, text, text[])'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
