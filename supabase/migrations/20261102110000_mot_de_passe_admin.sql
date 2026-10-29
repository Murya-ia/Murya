-- Les mots de passe de l'équipe sont donnés par les admins (page « Membres ») : un membre ne
-- change plus le sien lui-même. L'API change le mot de passe (clé secrète) ; cette fonction
-- vérifie d'abord, avec la session de l'admin, qu'il en a le droit, et le note au journal.
create function acces.log_password_reset(p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if not exists (select 1 from public.team_members where user_id = p_user_id) then
    perform acces.fail('membre_inconnu');
  end if;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), 'equipe', 'mot_de_passe_change', 'membre', p_user_id::text);
end $$;

create function public.log_password_reset(p_user_id uuid) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.log_password_reset(p_user_id);
$$;

revoke execute on function acces.log_password_reset(uuid) from public, anon;
grant execute on function acces.log_password_reset(uuid) to authenticated, service_role;
revoke execute on function public.log_password_reset(uuid) from public, anon;
grant execute on function public.log_password_reset(uuid) to authenticated, service_role;
