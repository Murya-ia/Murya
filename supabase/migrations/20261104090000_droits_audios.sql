-- =============================================================================
-- Corrections du test d'intrusion (novembre 2026) :
--
--   1. Audios et fiches des voix : plus « toute l'équipe ». Un vérificateur (ou le responsable
--      qualité) voit ceux de ses langues, jamais ceux de ses propres recrues ; un recruteur voit
--      ses recrues et l'audio de leur test ; un membre sans rôle ne voit rien. Admins : tout.
--   2. Valider, doubler ou corriger l'orthographe : seulement dans ses langues. Jusqu'ici, ces
--      actions passaient si on les appelait directement avec l'identifiant d'un audio.
--   3. Consentement oral : l'API vérifie les droits AVANT d'écrire le fichier.
-- =============================================================================

-- Langues actives de la personne connectée (vide pour un membre désactivé).
create function acces.my_languages() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(l.code), '{}')
  from public.team_members m
  join public.languages l on l.code = any(m.languages) and l.active
  where m.user_id = auth.uid() and m.active;
$$;

-- Langue d'un audio (null s'il n'existe pas).
create function acces.recording_language(p_recording_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.language_code
  from public.recordings r join public.speakers s on s.id = r.speaker_id
  where r.id = p_recording_id;
$$;

-- -----------------------------------------------------------------------------
-- 1. Qui voit les voix et leurs audios
-- -----------------------------------------------------------------------------

drop policy team_read on public.speakers;
create policy team_read on public.speakers for select to authenticated
  using (
    (select acces.has_role('admin'))
    or (recruiter_id = (select auth.uid()) and (select acces.is_team_member()))
    or ((select acces.is_reviewer()) and language_code = any((select acces.my_languages())::text[]))
  );

-- Spec §5.4 : un membre n'écoute jamais les voix qu'il a recrutées, sauf leurs phrases de test
-- (qu'il doit écouter pour valider le test).
drop policy team_read_not_own_recruits on public.recordings;
create policy team_read_not_own_recruits on public.recordings for select to authenticated
  using (
    (select acces.has_role('admin'))
    or (
      (select acces.is_reviewer())
      and speaker_id in (
        select s.id from public.speakers s
        where s.language_code = any((select acces.my_languages())::text[])
          and s.recruiter_id <> (select auth.uid())
      )
    )
    or (
      (select acces.has_role('recruteur'))
      and speaker_id in (select id from public.speakers where recruiter_id = (select auth.uid()))
      and sentence_id in (select id from public.sentences where is_test)
    )
  );

-- -----------------------------------------------------------------------------
-- 2. Actions sur un audio : dans ses langues seulement
-- -----------------------------------------------------------------------------

create or replace function public.review_submit(
  p_recording_id uuid,
  p_decision text,
  p_corrected_text text default null,
  p_reject_reason text default null,
  p_comment text default null
) returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_language text := acces.recording_language(p_recording_id);
begin
  -- Audio inconnu : c'est `acces.review_submit` qui répond, avec son message habituel.
  if v_language is not null then
    perform acces.require_language(v_language);
  end if;
  perform acces.review_submit(p_recording_id, p_decision, p_corrected_text, p_reject_reason,
                              p_comment);
end $$;

create or replace function public.double_review_submit(
  p_recording_id uuid,
  p_decision text,
  p_corrected_text text default null,
  p_reject_reason text default null,
  p_comment text default null
) returns boolean
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_language text := acces.recording_language(p_recording_id);
begin
  if v_language is not null then
    perform acces.require_language(v_language);
  end if;
  return acces.double_review_submit(p_recording_id, p_decision, p_corrected_text,
                                    p_reject_reason, p_comment);
end $$;

-- Mots décidés : dans ses langues.
drop policy quality_insert on public.orthography_decisions;
drop policy quality_update on public.orthography_decisions;
drop policy quality_delete on public.orthography_decisions;
create policy quality_insert on public.orthography_decisions for insert to authenticated
  with check (
    ((select acces.has_role('qualite')) or (select acces.has_role('admin')))
    and acces.has_language(language_code)
  );
create policy quality_update on public.orthography_decisions for update to authenticated
  using (
    ((select acces.has_role('qualite')) or (select acces.has_role('admin')))
    and acces.has_language(language_code)
  )
  with check (
    ((select acces.has_role('qualite')) or (select acces.has_role('admin')))
    and acces.has_language(language_code)
  );
create policy quality_delete on public.orthography_decisions for delete to authenticated
  using (
    ((select acces.has_role('qualite')) or (select acces.has_role('admin')))
    and acces.has_language(language_code)
  );

-- -----------------------------------------------------------------------------
-- 3. Contrôles pour l'API, avant d'écrire un fichier
-- -----------------------------------------------------------------------------

-- La session est-elle celle d'un membre actif ?
create function public.is_member() returns boolean
language sql stable security invoker set search_path = '' as $$
  select acces.is_team_member();
$$;

-- La personne connectée peut-elle enregistrer l'accord oral pour ce lien ? Mêmes règles que
-- `record_oral_consent`, sans rien écrire. Refuse avec le même message.
create function acces.check_oral_consent(p_invite_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_invite public.invites;
begin
  select * into v_invite from public.invites where id = p_invite_id;
  if not found then
    perform acces.fail('lien_inconnu');
  elsif not (acces.has_role('admin')
             or (v_invite.recruiter_id = auth.uid() and acces.has_role('recruteur'))) then
    perform acces.fail('acces_refuse');
  elsif v_invite.revoked_at is not null or v_invite.expires_at < now() then
    perform acces.fail('lien_expire');
  end if;
end $$;

create function public.check_oral_consent(p_invite_id uuid) returns void
language sql stable security invoker set search_path = '' as $$
  select acces.check_oral_consent(p_invite_id);
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

-- `create_invite` restait appelable sans compte (refusée ensuite, mais inutilement exposée).
revoke execute on function public.create_invite(text, text) from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'acces.my_languages()', 'acces.recording_language(uuid)',
    'acces.check_oral_consent(uuid)', 'public.check_oral_consent(uuid)',
    'public.is_member()'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
