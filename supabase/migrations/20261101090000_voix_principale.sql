-- =============================================================================
-- J5 — Voix principale (spec §5.7).
--
--   - Un admin désigne la voix principale d'une langue (une seule). Elle passe le test comme
--     les autres ; ensuite elle lit TOUTES les phrases actives, dans un ordre mélangé, en
--     séances d'environ 150 phrases (réglage `principal_session_size`).
--   - Une séance doit être entièrement vérifiée (plus aucun audio « à vérifier » ni « doute »)
--     avant que la suivante s'ouvre ; elle s'ouvre alors toute seule, quand la voix revient.
--   - Un admin choisit un audio validé de la voix comme audio de référence : la voix le
--     réécoute au début de chaque séance pour garder le même ton.
--   - Les phrases d'une séance n'expirent jamais (contrairement aux lots des voix variées).
--   - Une lecture validée de la voix principale compte comme une lecture de la phrase, comme
--     pour toute voix (elle lit chaque phrase une fois : l'équilibre entre phrases ne change pas).
-- =============================================================================

create table public.principal_sessions (
  id bigint generated always as identity primary key,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  number integer not null check (number > 0),
  status text not null default 'en_cours' check (status in ('en_cours', 'a_verifier', 'verifiee')),
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  verified_at timestamptz,
  unique (speaker_id, number)
);

alter table public.principal_sessions enable row level security;
create policy principal_sessions_equipe on public.principal_sessions for select to authenticated
  using (acces.has_role('admin') or acces.has_role('qualite'));
grant select on public.principal_sessions to authenticated;
grant all on public.principal_sessions to service_role;

alter table public.assignments
  add column session_id bigint references public.principal_sessions(id) on delete cascade;
create index assignments_session_idx on public.assignments (session_id) where session_id is not null;

alter table public.speakers
  add column reference_recording_id uuid references public.recordings(id) on delete set null;

-- Une seule voix principale par langue.
create unique index speakers_one_principal_idx on public.speakers (language_code) where is_principal;

insert into public.settings (scope, key, value, description) values
  ('*', 'principal_session_size', '150', 'Nombre de phrases par séance de la voix principale (spec §5.7)');

-- -----------------------------------------------------------------------------
-- Séances
-- -----------------------------------------------------------------------------

-- Ouvre la séance suivante : les prochaines phrases actives pas encore lues par la voix, dans
-- un ordre mélangé propre à la voix (stable). Renvoie null quand tout le corpus est attribué.
create function acces.open_principal_session(p_speaker_id uuid) returns public.principal_sessions
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers;
  v_size integer;
  v_session public.principal_sessions;
begin
  select * into v_speaker from public.speakers where id = p_speaker_id for update;
  v_size := coalesce((public.get_setting(v_speaker.language_code, 'principal_session_size'))::integer, 150);
  if not exists (
    select 1 from public.sentences s
    where s.language_code = v_speaker.language_code and s.active and not s.is_test
      and not exists (select 1 from public.assignments a
                      where a.speaker_id = p_speaker_id and a.sentence_id = s.id)
  ) then
    return null;
  end if;

  insert into public.principal_sessions (speaker_id, number)
  values (p_speaker_id, coalesce((
    select max(number) from public.principal_sessions where speaker_id = p_speaker_id), 0) + 1)
  returning * into v_session;

  with chosen as (
    select s.id, row_number() over (order by md5(p_speaker_id::text || s.id::text)) as position
    from public.sentences s
    where s.language_code = v_speaker.language_code and s.active and not s.is_test
      and not exists (select 1 from public.assignments a
                      where a.speaker_id = p_speaker_id and a.sentence_id = s.id)
    order by md5(p_speaker_id::text || s.id::text)
    limit v_size
  ), inserted as (
    insert into public.assignments (speaker_id, sentence_id, position, session_id)
    select p_speaker_id, id, position, v_session.id from chosen
    returning sentence_id
  )
  update public.sentences t set pending_reads = t.pending_reads + 1
  from inserted where t.id = inserted.sentence_id;
  return v_session;
end $$;

-- Une séance est vérifiée quand aucun de ses audios reçus n'attend une décision.
create function acces.principal_session_verified(p_session public.principal_sessions) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.assignments a
    join public.recordings r on r.speaker_id = a.speaker_id and r.sentence_id = a.sentence_id
    where a.session_id = p_session.id and r.upload_status = 'recu'
      and r.qc_status in ('a_verifier', 'doute'));
$$;

-- Phrases de la voix principale (appelée par voice_sentences pour une voix active).
create function acces.principal_sentences(v_speaker public.speakers, v_redo jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session public.principal_sessions;
begin
  loop
    select * into v_session from public.principal_sessions
    where speaker_id = v_speaker.id order by number desc limit 1 for update;

    if v_session is null or v_session.status = 'verifiee' then
      v_session := acces.open_principal_session(v_speaker.id);
      if v_session is null then
        -- Tout le corpus est lu et vérifié : la voix principale a terminé.
        update public.speakers set status = 'terminee', completed_at = coalesce(completed_at, now())
        where id = v_speaker.id;
        return jsonb_build_object('etape', 'fin', 'phrases', '[]'::jsonb, 'a_refaire', v_redo,
          'total', (select count(*) from public.recordings
                    where speaker_id = v_speaker.id and upload_status = 'recu'));
      end if;
    end if;

    if v_session.status = 'en_cours' and not exists (
      select 1 from public.assignments where session_id = v_session.id and status = 'attribuee'
    ) then
      update public.principal_sessions set status = 'a_verifier', completed_at = now()
      where id = v_session.id returning * into v_session;
    end if;

    if v_session.status = 'a_verifier' then
      if acces.principal_session_verified(v_session) then
        update public.principal_sessions set status = 'verifiee', verified_at = now()
        where id = v_session.id;
        continue; -- on ouvre la séance suivante
      end if;
      return jsonb_build_object('etape', 'verification', 'phrases', '[]'::jsonb,
        'a_refaire', v_redo, 'seance', jsonb_build_object('numero', v_session.number));
    end if;

    -- Séance en cours.
    return jsonb_build_object(
      'etape', 'lot',
      'a_refaire', v_redo,
      'seance', jsonb_build_object(
        'numero', v_session.number,
        'reference_cle', (select storage_key from public.recordings
                          where id = v_speaker.reference_recording_id)),
      'phrases', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'code', s.code, 'texte', s.text, 'version', s.version,
            'enregistree', a.status = 'enregistree', 'sautee', a.status = 'sautee'
          ) order by a.position), '[]')
        from public.assignments a join public.sentences s on s.id = a.sentence_id
        where a.session_id = v_session.id));
  end loop;
end $$;

-- Phrases à enregistrer (même fonction qu'avant, avec le cas de la voix principale).
create or replace function public.voice_sentences(p_token_hash text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers := public.voice_ready_speaker(p_token_hash);
  v_redo jsonb;
begin
  -- Phrases rejetées dont aucune prise plus récente n'est reçue ou en attente (spec §3.7).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'code', s.code, 'texte', s.text, 'version', s.version) order by s.code), '[]')
  into v_redo
  from public.sentences s
  where exists (
      select 1 from public.recordings r
      where r.speaker_id = v_speaker.id and r.sentence_id = s.id and r.qc_status = 'rejete')
    and not exists (
      select 1 from public.recordings r
      where r.speaker_id = v_speaker.id and r.sentence_id = s.id and r.qc_status <> 'rejete');

  if v_speaker.status in ('inscrite', 'test_a_refaire') then
    return jsonb_build_object('etape', 'test', 'phrases', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'code', s.code, 'texte', s.text, 'version', s.version,
          'enregistree', exists (
            select 1 from public.recordings r
            where r.speaker_id = v_speaker.id and r.sentence_id = s.id and r.upload_status = 'recu'
              and r.created_at > coalesce(v_speaker.test_reviewed_at, '-infinity'))
        ) order by s.code), '[]')
      from public.sentences s
      where s.language_code = v_speaker.language_code and s.is_test and s.active));
  elsif v_speaker.status = 'test_en_attente' then
    return jsonb_build_object('etape', 'attente', 'phrases', '[]'::jsonb);
  elsif v_speaker.status = 'terminee' then
    return jsonb_build_object('etape', 'fin', 'phrases', '[]'::jsonb, 'a_refaire', v_redo,
      'total', (select count(*) from public.recordings where speaker_id = v_speaker.id and upload_status = 'recu'));
  end if;

  if v_speaker.is_principal then
    return acces.principal_sentences(v_speaker, v_redo);
  end if;

  if not exists (select 1 from public.assignments where speaker_id = v_speaker.id) then
    perform public.assign_batch(v_speaker.id);
  end if;
  return jsonb_build_object('etape', 'lot', 'a_refaire', v_redo, 'phrases', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'texte', s.text, 'version', s.version,
        'enregistree', a.status = 'enregistree', 'sautee', a.status = 'sautee'
      ) order by a.position), '[]')
    from public.assignments a join public.sentences s on s.id = a.sentence_id
    where a.speaker_id = v_speaker.id and a.status <> 'expiree'));
end $$;

-- Confirmation d'un envoi (même fonction qu'avant) : pour la voix principale, la fin d'une
-- séance la passe « à vérifier » au lieu de terminer la voix.
create or replace function public.voice_confirm_upload(
  p_token_hash text,
  p_recording_id uuid,
  p_size_bytes integer,
  p_duration_ms integer,
  p_sample_rate integer,
  p_client_metrics jsonb default null,
  p_mic_settings jsonb default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers := public.voice_ready_speaker(p_token_hash, true);
  v_recording public.recordings;
  v_status text := v_speaker.status;
begin
  select * into v_recording from public.recordings where id = p_recording_id for update;
  if not found or v_recording.speaker_id <> v_speaker.id then
    raise exception 'enregistrement_inconnu';
  end if;
  if v_recording.upload_status = 'recu' then
    return jsonb_build_object('statut_voix', v_status, 'deja_recu', true);
  end if;

  update public.recordings set
    upload_status = 'recu', received_at = now(), size_bytes = p_size_bytes,
    duration_ms = p_duration_ms, sample_rate = p_sample_rate,
    client_metrics = p_client_metrics, mic_settings = p_mic_settings
  where id = p_recording_id;
  update public.assignments set status = 'enregistree'
  where speaker_id = v_speaker.id and sentence_id = v_recording.sentence_id and status <> 'enregistree';
  insert into public.jobs (kind, payload)
  values ('verifier_audio', jsonb_build_object('recording_id', p_recording_id));

  -- Test terminé : les 5 phrases de test ont une prise reçue depuis le dernier avis du recruteur.
  if v_status in ('inscrite', 'test_a_refaire') and not exists (
    select 1 from public.sentences s
    where s.language_code = v_speaker.language_code and s.is_test and s.active
      and not exists (
        select 1 from public.recordings r
        where r.speaker_id = v_speaker.id and r.sentence_id = s.id and r.upload_status = 'recu'
          and r.created_at > coalesce(v_speaker.test_reviewed_at, '-infinity'))
  ) then
    v_status := 'test_en_attente';
    update public.speakers set status = v_status, test_submitted_at = now() where id = v_speaker.id;
    insert into public.audit_log (actor_kind, action, target_type, target_id)
    values ('voix', 'test_envoye', 'speaker', v_speaker.id::text);
  elsif v_status = 'active' and v_speaker.is_principal then
    -- Séance terminée : elle attend la vérification de l'équipe.
    update public.principal_sessions p set status = 'a_verifier', completed_at = now()
    where p.speaker_id = v_speaker.id and p.status = 'en_cours'
      and not exists (select 1 from public.assignments a
                      where a.session_id = p.id and a.status = 'attribuee');
  -- Lot terminé : plus aucune phrase attribuée à enregistrer.
  elsif v_status = 'active' and not exists (
    select 1 from public.assignments where speaker_id = v_speaker.id and status = 'attribuee'
  ) then
    v_status := 'terminee';
    update public.speakers set status = v_status, completed_at = now() where id = v_speaker.id;
  end if;

  update public.speakers set last_seen_at = now() where id = v_speaker.id;
  return jsonb_build_object('statut_voix', v_status, 'deja_recu', false);
end $$;

-- Les phrases d'une séance de la voix principale n'expirent jamais.
create or replace function public.expire_assignments() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with expired as (
    update public.assignments a set status = 'expiree'
    from public.speakers s
    where s.id = a.speaker_id and a.status = 'attribuee' and a.session_id is null
      and a.assigned_at < now() - make_interval(
        days => coalesce((public.get_setting(s.language_code, 'assignment_expiry_days'))::integer, 7))
    returning a.sentence_id
  )
  update public.sentences t set pending_reads = greatest(t.pending_reads - e.n, 0)
  from (select sentence_id, count(*)::integer as n from expired group by sentence_id) e
  where t.id = e.sentence_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Espace équipe
-- -----------------------------------------------------------------------------

-- Désigne (ou retire) la voix principale d'une langue. Possible tant que la voix n'a pas
-- commencé un lot de voix variée ; on ne la retire plus une fois ses séances commencées.
create function acces.set_principal(p_speaker_id uuid, p_value boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  select * into v_speaker from public.speakers where id = p_speaker_id for update;
  if not found then
    perform acces.fail('voix_inconnue');
  end if;
  if p_value then
    if exists (select 1 from public.speakers
               where language_code = v_speaker.language_code and is_principal and id <> p_speaker_id) then
      perform acces.fail('principale_existe');
    end if;
    if exists (select 1 from public.assignments where speaker_id = p_speaker_id) then
      perform acces.fail('deja_en_lot');
    end if;
  elsif exists (select 1 from public.principal_sessions where speaker_id = p_speaker_id) then
    perform acces.fail('seances_commencees');
  end if;
  update public.speakers set is_principal = p_value where id = p_speaker_id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'voix_principale', 'speaker', p_speaker_id::text,
          jsonb_build_object('principale', p_value));
end $$;

create function public.set_principal(p_speaker_id uuid, p_value boolean) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.set_principal(p_speaker_id, p_value);
$$;

-- Choisit l'audio de référence : un audio validé de la voix principale.
create function acces.set_reference_audio(p_speaker_id uuid, p_recording_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if not exists (
    select 1 from public.recordings r join public.speakers s on s.id = r.speaker_id
    where r.id = p_recording_id and r.speaker_id = p_speaker_id and s.is_principal
      and r.kind = 'principale' and r.qc_status in ('valide', 'corrige')
  ) then
    perform acces.fail('reference_invalide');
  end if;
  update public.speakers set reference_recording_id = p_recording_id where id = p_speaker_id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), 'equipe', 'reference_choisie', 'recording', p_recording_id::text);
end $$;

create function public.set_reference_audio(p_speaker_id uuid, p_recording_id uuid) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.set_reference_audio(p_speaker_id, p_recording_id);
$$;

-- Vue d'ensemble pour l'espace équipe (admins et responsable qualité).
create function acces.principal_overview(p_language text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean := acces.has_role('admin');
begin
  if not (v_admin or acces.has_role('qualite')) then
    perform acces.fail('acces_refuse');
  end if;
  return jsonb_build_object(
    'phrases_total', (select count(*) from public.sentences
                      where language_code = p_language and active and not is_test),
    'voix', (
      select jsonb_build_object(
        'id', s.id, 'numero', s.number, 'statut', s.status,
        'libelle', case when v_admin then i.label end,
        'reference', (
          select jsonb_build_object('id', r.id, 'code', t.code, 'texte', t.text)
          from public.recordings r join public.sentences t on t.id = r.sentence_id
          where r.id = s.reference_recording_id),
        'phrases_validees', (
          select count(distinct r.sentence_id) from public.recordings r
          where r.speaker_id = s.id and r.kind = 'principale' and r.qc_status in ('valide', 'corrige')),
        'seances', coalesce((
          select jsonb_agg(jsonb_build_object(
            'numero', p.number, 'statut', p.status, 'ouverte_le', p.opened_at,
            'terminee_le', p.completed_at, 'verifiee_le', p.verified_at,
            'phrases', (select count(*) from public.assignments a where a.session_id = p.id),
            'enregistrees', (select count(*) from public.assignments a
                             where a.session_id = p.id and a.status = 'enregistree'),
            'a_verifier', (
              select count(*) from public.assignments a
              join public.recordings r on r.speaker_id = a.speaker_id and r.sentence_id = a.sentence_id
              where a.session_id = p.id and r.upload_status = 'recu'
                and r.qc_status in ('a_verifier', 'doute')),
            'rejetees', (
              select count(*) from public.assignments a
              join public.recordings r on r.speaker_id = a.speaker_id and r.sentence_id = a.sentence_id
              where a.session_id = p.id and r.qc_status = 'rejete')
          ) order by p.number)
          from public.principal_sessions p where p.speaker_id = s.id), '[]'),
        'candidats_reference', coalesce((
          select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'texte', c.text)
                           order by c.code)
          from (
            select r.id, t.code, t.text from public.recordings r
            join public.sentences t on t.id = r.sentence_id
            where r.speaker_id = s.id and r.kind = 'principale' and r.qc_status in ('valide', 'corrige')
            order by r.received_at limit 30
          ) c), '[]'))
      from public.speakers s left join public.invites i on i.id = s.invite_id
      where s.language_code = p_language and s.is_principal),
    'candidats', case when v_admin then coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.number, 'statut', s.status,
                                          'libelle', i.label) order by s.number)
      from public.speakers s left join public.invites i on i.id = s.invite_id
      where s.language_code = p_language and not s.is_principal and s.status <> 'terminee'
        and not exists (select 1 from public.assignments a where a.speaker_id = s.id)
    ), '[]') else '[]'::jsonb end
  );
end $$;

create function public.principal_overview(p_language text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select acces.principal_overview(p_language);
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

revoke execute on function acces.open_principal_session(uuid) from public, anon, authenticated;
revoke execute on function acces.principal_session_verified(public.principal_sessions)
  from public, anon, authenticated;
revoke execute on function acces.principal_sentences(public.speakers, jsonb)
  from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'acces.set_principal(uuid, boolean)', 'public.set_principal(uuid, boolean)',
    'acces.set_reference_audio(uuid, uuid)', 'public.set_reference_audio(uuid, uuid)',
    'acces.principal_overview(text)', 'public.principal_overview(text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
