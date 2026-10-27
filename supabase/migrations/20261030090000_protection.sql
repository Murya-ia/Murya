-- =============================================================================
-- J6a — Protection : journal d'activité inaltérable et lisible, accès journalisé aux
-- identités, demandes de retrait, retrait d'une voix (droit à l'effacement).
-- Spec §5.8 et §5.10.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Journal d'activité : personne ne peut le modifier ni l'effacer, pas même un admin.
-- -----------------------------------------------------------------------------

create function public.audit_log_inalterable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'journal_inalterable';
end $$;

create trigger audit_log_inalterable before update or delete on public.audit_log
  for each row execute function public.audit_log_inalterable();
create trigger audit_log_inalterable_vidage before truncate on public.audit_log
  for each statement execute function public.audit_log_inalterable();

-- Actions sensibles faites directement dans les tables (sans passer par une fonction) :
-- désactiver ou réactiver une phrase, ajouter un membre ou changer ses rôles.
create function public.journal_phrase_active() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), case when auth.uid() is null then 'systeme' else 'equipe' end,
          case when new.active then 'phrase_reactivee' else 'phrase_desactivee' end,
          'sentence', new.id::text);
  return new;
end $$;

create trigger sentences_journal_active after update of active on public.sentences
  for each row when (old.active is distinct from new.active)
  execute function public.journal_phrase_active();

create function public.journal_membre() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), case when auth.uid() is null then 'systeme' else 'equipe' end,
          case when tg_op = 'INSERT' then 'membre_ajoute' else 'membre_modifie' end,
          'membre', new.user_id::text,
          jsonb_build_object('roles', new.roles, 'actif', new.active));
  return new;
end $$;

create trigger team_members_journal after insert or update of roles, active on public.team_members
  for each row execute function public.journal_membre();

-- Lecture du journal pour la page « Journal » (admins) : du plus récent au plus ancien,
-- avec le nom du membre et un libellé lisible de la cible (numéro de voix, phrase…).
create function acces.journal(
  p_before_id bigint default null,
  p_limit integer default 50,
  p_action text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  select coalesce(jsonb_agg(e order by (e->>'id')::bigint desc), '[]') into v_result
  from (
    select jsonb_build_object(
      'id', l.id,
      'date', l.created_at,
      'action', l.action,
      'par', case l.actor_kind
               when 'equipe' then coalesce(m.display_name, 'membre supprimé')
               when 'voix' then 'la voix'
               else 'système' end,
      'cible', case l.target_type
                 when 'speaker' then coalesce(s.number, case when l.target_id ~ '^V[0-9]+$'
                                                          then l.target_id else 'voix retirée' end)
                 when 'recording' then coalesce(rs.number || ' · ' || rt.code, 'audio supprimé')
                 when 'language' then l.details->>'langue'
                 when 'sentence' then coalesce(t.code, 'phrase supprimée')
                 when 'membre' then coalesce(tm.display_name, 'membre supprimé')
                 else l.target_id end,
      'details', l.details
    ) as e
    from public.audit_log l
    left join public.team_members m on m.user_id = l.actor_id
    -- `case` : la conversion en uuid n'est tentée que sur un identifiant valide.
    left join public.speakers s
      on l.target_type = 'speaker'
     and s.id = case when l.target_id ~ '^[0-9a-f-]{36}$' then l.target_id::uuid end
    left join public.recordings r
      on l.target_type = 'recording'
     and r.id = case when l.target_id ~ '^[0-9a-f-]{36}$' then l.target_id::uuid end
    left join public.speakers rs on rs.id = r.speaker_id
    left join public.sentences rt on rt.id = r.sentence_id
    left join public.sentences t
      on l.target_type = 'sentence'
     and t.id = case when l.target_id ~ '^[0-9]+$' then l.target_id::bigint end
    left join public.team_members tm
      on l.target_type = 'membre'
     and tm.user_id = case when l.target_id ~ '^[0-9a-f-]{36}$' then l.target_id::uuid end
    where (p_before_id is null or l.id < p_before_id)
      and (p_action is null or l.action = p_action)
      and (p_actor is null or l.actor_id = p_actor)
    order by l.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) entries;
  return v_result;
end $$;

create function public.journal(
  p_before_id bigint default null,
  p_limit integer default 50,
  p_action text default null,
  p_actor uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select acces.journal(p_before_id, p_limit, p_action, p_actor);
$$;

-- -----------------------------------------------------------------------------
-- Identités (admins seulement) : chaque consultation est journalisée, sans jamais écrire
-- le nom ni le texte cherché dans le journal.
-- -----------------------------------------------------------------------------

-- Recherche d'une voix par numéro (« V012 », « 12 ») ou par nom.
create function acces.find_speakers(p_language text, p_query text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_like text;
  v_number text;
  v_result jsonb;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if char_length(v_query) < 2 then
    return '[]';
  end if;
  v_like := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- « 12 » ou « v12 » → « V012 ».
  v_number := case when v_query ~* '^v?[0-9]+$'
                   then 'V' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 3, '0') end;
  select coalesce(jsonb_agg(x order by x->>'numero'), '[]') into v_result
  from (
    select jsonb_build_object(
      'id', s.id, 'numero', s.number, 'statut', s.status,
      'recruteur', m.display_name, 'nom', i.full_name, 'contact', i.contact,
      'consentement_oral', i.oral_consent_key is not null,
      'retrait_demande', exists (select 1 from public.withdrawal_requests w where w.speaker_id = s.id)
    ) as x
    from public.speakers s
    left join prive.identities i on i.speaker_id = s.id
    left join public.team_members m on m.user_id = s.recruiter_id
    where s.language_code = p_language
      and (s.number = v_number or i.full_name ilike v_like)
    order by s.number
    limit 20
  ) found;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, details)
  values (auth.uid(), 'equipe', 'recherche_identite', 'language',
          jsonb_build_object('langue', p_language, 'resultats', jsonb_array_length(v_result)));
  return v_result;
end $$;

create function public.find_speakers(p_language text, p_query text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.find_speakers(p_language, p_query);
$$;

-- Identité d'une voix (nom, contact) pour un admin.
create function acces.speaker_identity(p_speaker_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  select jsonb_build_object('nom', i.full_name, 'contact', i.contact,
                            'consentement_oral', i.oral_consent_key is not null)
  into v_result
  from prive.identities i where i.speaker_id = p_speaker_id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), 'equipe', 'acces_identite', 'speaker', p_speaker_id::text);
  return v_result;
end $$;

create function public.speaker_identity(p_speaker_id uuid) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.speaker_identity(p_speaker_id);
$$;

-- -----------------------------------------------------------------------------
-- Demandes de retrait : la voix prévient son recruteur, qui fait la demande ici ; un admin
-- la confirme (ou l'annule). La demande disparaît avec la voix.
-- -----------------------------------------------------------------------------

create table public.withdrawal_requests (
  speaker_id uuid primary key references public.speakers(id) on delete cascade,
  requested_by uuid not null references public.team_members(user_id),
  requested_at timestamptz not null default now(),
  -- Message court facultatif (effacé avec la voix, jamais copié dans le journal).
  note text check (char_length(note) <= 300)
);
alter table public.withdrawal_requests enable row level security;
create policy recruiter_or_admin_read on public.withdrawal_requests for select to authenticated
  using (
    (select acces.has_role('admin'))
    or speaker_id in (select id from public.speakers where recruiter_id = (select auth.uid()))
  );
grant select on public.withdrawal_requests to authenticated;
grant all on public.withdrawal_requests to service_role;

create function acces.request_withdrawal(p_speaker_id uuid, p_note text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_recruiter uuid;
begin
  select recruiter_id into v_recruiter from public.speakers where id = p_speaker_id;
  if v_recruiter is null then
    perform acces.fail('voix_inconnue');
  elsif not (acces.has_role('admin') or (acces.has_role('recruteur') and v_recruiter = auth.uid())) then
    perform acces.fail('acces_refuse');
  end if;
  insert into public.withdrawal_requests (speaker_id, requested_by, note)
  values (p_speaker_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (speaker_id) do nothing;
  if found then
    insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
    values (auth.uid(), 'equipe', 'demande_retrait', 'speaker', p_speaker_id::text);
  end if;
end $$;

create function public.request_withdrawal(p_speaker_id uuid, p_note text default null) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.request_withdrawal(p_speaker_id, p_note);
$$;

create function acces.cancel_withdrawal_request(p_speaker_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not (acces.has_role('admin') or exists (
    select 1 from public.withdrawal_requests
    where speaker_id = p_speaker_id and requested_by = auth.uid()
  )) then
    perform acces.fail('acces_refuse');
  end if;
  delete from public.withdrawal_requests where speaker_id = p_speaker_id;
  if found then
    insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
    values (auth.uid(), 'equipe', 'demande_retrait_annulee', 'speaker', p_speaker_id::text);
  end if;
end $$;

create function public.cancel_withdrawal_request(p_speaker_id uuid) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.cancel_withdrawal_request(p_speaker_id);
$$;

-- -----------------------------------------------------------------------------
-- Retrait d'une voix (spec §5.8). Tout se fait dans une seule transaction :
--   - la contribution de la voix aux compteurs de lectures des phrases est retirée ;
--   - une ligne `withdrawals` est gardée (numéro, date, admin) : c'est la seule trace ;
--   - une tâche « effacer_fichiers » liste les fichiers à supprimer du stockage (l'API les
--     supprime aussitôt ; la tâche reste en file tant qu'ils ne sont pas tous effacés) ;
--   - la voix est supprimée, et avec elle (cascade) son identité, ses consentements, ses
--     enregistrements, leurs vérifications, ses lots et ses signalements ; son invitation
--     (qui porte son nom ou surnom) aussi.
-- L'admin confirme en retapant le numéro de la voix.
-- -----------------------------------------------------------------------------

create function acces.withdraw_speaker(p_speaker_id uuid, p_confirm_number text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers;
  v_audio_keys text[];
  v_identity_keys text[];
  v_count integer;
  v_prefixes jsonb;
  v_job bigint;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  select * into v_speaker from public.speakers where id = p_speaker_id for update;
  if v_speaker.id is null then
    perform acces.fail('voix_inconnue');
  end if;
  if upper(btrim(coalesce(p_confirm_number, ''))) <> v_speaker.number then
    perform acces.fail('confirmation_incorrecte');
  end if;

  select coalesce(array_agg(storage_key), '{}'), count(*)
  into v_audio_keys, v_count
  from public.recordings where speaker_id = v_speaker.id;
  select coalesce(array_agg(oral_consent_key) filter (where oral_consent_key is not null), '{}')
  into v_identity_keys
  from prive.identities where speaker_id = v_speaker.id;
  v_prefixes := jsonb_build_array(
    format('%s/varie/%s/', v_speaker.language_code, v_speaker.number),
    format('%s/principale/%s/', v_speaker.language_code, v_speaker.number));

  -- Compteurs de lectures (spec §7) : on enlève ce que cette voix y avait ajouté.
  update public.sentences t set validated_reads = greatest(t.validated_reads - x.n, 0)
  from (select sentence_id, count(*)::integer as n from public.recordings
        where speaker_id = v_speaker.id and qc_status in ('valide', 'corrige')
        group by sentence_id) x
  where t.id = x.sentence_id;
  update public.sentences t set pending_reads = greatest(t.pending_reads - x.n, 0)
  from (select a.sentence_id, count(*)::integer as n from public.assignments a
        where a.speaker_id = v_speaker.id and a.status in ('attribuee', 'enregistree')
          and not exists (select 1 from public.recordings r
                          where r.speaker_id = a.speaker_id and r.sentence_id = a.sentence_id
                            and r.qc_status in ('valide', 'corrige'))
        group by a.sentence_id) x
  where t.id = x.sentence_id;

  insert into public.withdrawals (language_code, speaker_number, withdrawn_by)
  values (v_speaker.language_code, v_speaker.number, auth.uid());

  insert into public.jobs (kind, payload)
  values ('effacer_fichiers', jsonb_build_object(
    'langue', v_speaker.language_code, 'numero', v_speaker.number, 'date', now(),
    'prefixes_audio', v_prefixes, 'cles_audio', to_jsonb(v_audio_keys),
    'cles_identites', to_jsonb(v_identity_keys)))
  returning id into v_job;

  delete from public.speakers where id = v_speaker.id;
  delete from public.invites where id = v_speaker.invite_id;

  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'retrait_voix', 'speaker', v_speaker.number,
          jsonb_build_object('langue', v_speaker.language_code, 'audios', v_count));

  return jsonb_build_object(
    'numero', v_speaker.number, 'langue', v_speaker.language_code, 'audios', v_count,
    'date', now(), 'tache', v_job, 'prefixes_audio', v_prefixes,
    'cles_audio', to_jsonb(v_audio_keys), 'cles_identites', to_jsonb(v_identity_keys));
end $$;

create function public.withdraw_speaker(p_speaker_id uuid, p_confirm_number text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.withdraw_speaker(p_speaker_id, p_confirm_number);
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

revoke execute on function public.audit_log_inalterable() from public, anon, authenticated;
revoke execute on function public.journal_phrase_active() from public, anon, authenticated;
revoke execute on function public.journal_membre() from public, anon, authenticated;

do $$
declare
  f text;
begin
  -- Appelables par l'espace équipe (l'implémentation vérifie les rôles).
  foreach f in array array[
    'acces.journal(bigint, integer, text, uuid)', 'public.journal(bigint, integer, text, uuid)',
    'acces.find_speakers(text, text)', 'public.find_speakers(text, text)',
    'acces.speaker_identity(uuid)', 'public.speaker_identity(uuid)',
    'acces.request_withdrawal(uuid, text)', 'public.request_withdrawal(uuid, text)',
    'acces.cancel_withdrawal_request(uuid)', 'public.cancel_withdrawal_request(uuid)',
    'acces.withdraw_speaker(uuid, text)', 'public.withdraw_speaker(uuid, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
