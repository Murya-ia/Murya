-- =============================================================================
-- Accompagnement des personnes qui lisent peu ou pas (spec §3.2).
--
--   1. Audios de l'accord : enregistrés par l'équipe (en zarma et en français), téléversés par
--      un admin. Ils sont rangés à part du texte publié (qui, lui, ne change jamais) : on peut
--      donc ajouter ou remplacer un audio sans créer une nouvelle version de l'accord.
--   2. Mode « écouter puis répéter » : pour une voix en lecture assistée, l'appli fait entendre
--      chaque phrase (un audio modèle validé, de préférence celui de la voix principale) avant
--      que la personne la dise. Activé par le recruteur de la voix (ou un admin), et
--      automatiquement avec un accord oral. Les exports le signalent (colonne `mode`).
-- =============================================================================

create table public.consent_audios (
  consent_version_id bigint not null references public.consent_versions(id) on delete cascade,
  ui_language text not null check (ui_language in ('dje', 'fr')),
  kind text not null check (kind in ('complet', 'rappel')),
  storage_key text not null,
  uploaded_by uuid not null references public.team_members(user_id),
  uploaded_at timestamptz not null default now(),
  primary key (consent_version_id, ui_language, kind)
);
alter table public.consent_audios enable row level security;
create policy consent_audios_equipe on public.consent_audios for select to authenticated
  using (acces.has_role('admin') or acces.has_role('recruteur'));
grant select on public.consent_audios to authenticated;
grant all on public.consent_audios to service_role;

-- Enregistre (ou remplace) un audio de l'accord. Le fichier est déjà dans le stockage (API).
create function acces.set_consent_audio(
  p_consent_version_id bigint,
  p_ui_language text,
  p_kind text,
  p_storage_key text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if not exists (select 1 from public.consent_versions where id = p_consent_version_id) then
    perform acces.fail('requete_invalide');
  end if;
  insert into public.consent_audios (consent_version_id, ui_language, kind, storage_key, uploaded_by)
  values (p_consent_version_id, p_ui_language, p_kind, p_storage_key, auth.uid())
  on conflict (consent_version_id, ui_language, kind) do update set
    storage_key = excluded.storage_key, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'audio_accord', 'consentement', p_consent_version_id::text,
          jsonb_build_object('langue', p_ui_language, 'audio', p_kind));
end $$;

create function public.set_consent_audio(
  p_consent_version_id bigint, p_ui_language text, p_kind text, p_storage_key text
) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.set_consent_audio(p_consent_version_id, p_ui_language, p_kind, p_storage_key);
$$;

-- Clé d'un audio de l'accord, pour l'écouter depuis l'espace équipe (admins et recruteurs).
create function public.consent_audio_key(
  p_consent_version_id bigint, p_ui_language text, p_kind text
) returns text
language sql stable security invoker set search_path = '' as $$
  select storage_key from public.consent_audios
  where consent_version_id = p_consent_version_id and ui_language = p_ui_language and kind = p_kind;
$$;

-- -----------------------------------------------------------------------------
-- Mode « écouter puis répéter »
-- -----------------------------------------------------------------------------

-- Audio modèle d'une phrase : d'abord la voix principale, puis un audio validé, puis un audio
-- reçu non rejeté d'une voix dont le test est validé (pour les phrases du test, au début).
-- Jamais un audio corrigé (le texte dit ne correspond pas à la phrase) ni celui de la voix
-- elle-même.
create function acces.model_recording(p_sentence_id bigint, p_speaker_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.recordings r join public.speakers s on s.id = r.speaker_id
  where r.sentence_id = p_sentence_id and r.speaker_id <> p_speaker_id
    and r.upload_status = 'recu' and r.qc_status in ('valide', 'a_verifier')
    and s.status in ('active', 'terminee') and not s.assisted_reading
  order by s.is_principal desc, r.qc_status = 'valide' desc, r.reviewed_at desc nulls last
  limit 1;
$$;

-- Clé de l'audio modèle d'une phrase que la voix doit dire (test, lot, ou phrase à refaire).
create function public.voice_model_key(p_token_hash text, p_sentence_id bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_speaker public.speakers := public.voice_ready_speaker(p_token_hash);
begin
  if not v_speaker.assisted_reading then
    return null;
  end if;
  if not exists (
    select 1 from public.sentences s
    where s.id = p_sentence_id and s.language_code = v_speaker.language_code
      and (s.is_test
           or exists (select 1 from public.assignments a
                      where a.speaker_id = v_speaker.id and a.sentence_id = s.id)
           or exists (select 1 from public.recordings r
                      where r.speaker_id = v_speaker.id and r.sentence_id = s.id))
  ) then
    raise exception 'phrase_non_attribuee';
  end if;
  return (select storage_key from public.recordings
          where id = acces.model_recording(p_sentence_id, v_speaker.id));
end $$;

-- Le recruteur de la voix (ou un admin) active ou coupe le mode répétition. Les phrases déjà
-- attribuées sans modèle restent (la voix peut les sauter) ; le prochain lot en tiendra compte.
create function acces.set_assisted_reading(p_speaker_id uuid, p_value boolean) returns void
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
  update public.speakers set assisted_reading = p_value where id = p_speaker_id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'lecture_assistee', 'speaker', p_speaker_id::text,
          jsonb_build_object('active', p_value));
end $$;

create function public.set_assisted_reading(p_speaker_id uuid, p_value boolean) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.set_assisted_reading(p_speaker_id, p_value);
$$;

-- État de la voix (même fonction qu'avant) : audios de l'accord et mode répétition.
create or replace function public.voice_session(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_invite public.invites := public.voice_invite(p_token_hash);
  v_consent public.consent_versions := public.current_consent(v_invite.language_code);
  v_speaker public.speakers;
  v_reminder_hours numeric :=
    coalesce((public.get_setting(v_invite.language_code, 'consent_reminder_hours'))::numeric, 1);
begin
  select * into v_speaker from public.speakers where invite_id = v_invite.id;
  return jsonb_build_object(
    'langue', v_invite.language_code,
    'consentement', case when v_consent.id is null then null else jsonb_build_object(
      'id', v_consent.id, 'version', v_consent.version, 'points', to_jsonb(v_consent.points),
      'textes', v_consent.texts, 'audios', coalesce((
        select jsonb_object_agg(ui_language, audios) from (
          select ui_language, jsonb_object_agg(kind, storage_key) as audios
          from public.consent_audios where consent_version_id = v_consent.id
          group by ui_language) a), '{}'::jsonb)) end,
    'reglages', jsonb_build_object(
      'verifications', public.get_setting(v_invite.language_code, 'client_checks'),
      'duree_max_s', public.get_setting(v_invite.language_code, 'max_recording_seconds'),
      'pause_toutes', public.get_setting(v_invite.language_code, 'pause_every')),
    'voix', case when v_speaker.id is null then null else jsonb_build_object(
      'numero', v_speaker.number,
      'statut', v_speaker.status,
      'consentement_a_jour', v_speaker.consent_version_id is not distinct from v_consent.id,
      'rappel_requis', v_speaker.last_seen_at is null
        or v_speaker.last_seen_at < now() - make_interval(secs => v_reminder_hours * 3600),
      'fiche_remplie', v_speaker.profile_completed_at is not null,
      'tutoriel_vu', v_speaker.tutorial_done_at is not null,
      'message_test', v_speaker.test_feedback,
      'principale', v_speaker.is_principal,
      'repetition', v_speaker.assisted_reading) end
  );
end $$;

-- Lot de phrases (même fonction qu'avant) : en mode répétition, seulement des phrases avec modèle.
create or replace function public.assign_batch(p_speaker_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers;
  v_size integer;
  v_count integer;
begin
  select * into v_speaker from public.speakers where id = p_speaker_id;
  v_size := coalesce((public.get_setting(v_speaker.language_code, 'batch_size'))::integer, 150);

  with chosen as (
    select s.id
    from public.sentences s
    where s.language_code = v_speaker.language_code
      and s.active
      and not s.is_test
      and not exists (
        select 1 from public.assignments a where a.speaker_id = p_speaker_id and a.sentence_id = s.id
      )
      and (not v_speaker.assisted_reading or acces.model_recording(s.id, p_speaker_id) is not null)
    order by s.validated_reads + s.pending_reads, random()
    limit v_size
    for update of s skip locked
  ),
  counted as (
    update public.sentences s set pending_reads = s.pending_reads + 1
    from chosen where s.id = chosen.id
    returning s.id
  )
  insert into public.assignments (speaker_id, sentence_id, position)
  select p_speaker_id, id, row_number() over (order by random()) from counted;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Phrases à enregistrer (même fonction qu'avant) : cas du mode répétition sans modèle.
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
  -- Mode répétition : aucune phrase n'a encore d'audio modèle à faire écouter.
  if v_speaker.assisted_reading and not exists (
    select 1 from public.assignments where speaker_id = v_speaker.id and status <> 'expiree'
  ) then
    return jsonb_build_object('etape', 'sans_modele', 'phrases', '[]'::jsonb, 'a_refaire', v_redo);
  end if;
  return jsonb_build_object('etape', 'lot', 'a_refaire', v_redo, 'phrases', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'texte', s.text, 'version', s.version,
        'enregistree', a.status = 'enregistree', 'sautee', a.status = 'sautee'
      ) order by a.position), '[]')
    from public.assignments a join public.sentences s on s.id = a.sentence_id
    where a.speaker_id = v_speaker.id and a.status <> 'expiree'));
end $$;

-- Export (même fonction qu'avant) : colonne « mode » (lecture ou répétition).
create or replace function public.worker_export_start(p_export_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_export public.exports;
begin
  update public.exports set status = 'en_cours'
  where id = p_export_id and status in ('en_attente', 'en_cours')
  returning * into v_export;
  if v_export is null then
    return null; -- déjà terminé ou inconnu : rien à faire
  end if;

  return jsonb_build_object(
    'id', v_export.id,
    'langue', v_export.language_code,
    'type', v_export.kind,
    'version', v_export.version,
    'date', now(),
    'precedent', (
      select jsonb_build_object('version', e.version, 'date', e.finished_at, 'stats', e.stats)
      from public.exports e
      where e.language_code = v_export.language_code and e.kind = v_export.kind
        and e.status = 'pret' and e.version < v_export.version
      order by e.version desc limit 1
    ),
    'retraits_depuis', coalesce((
      select jsonb_agg(w.speaker_number order by w.speaker_number)
      from public.withdrawals w
      where w.language_code = v_export.language_code
        and w.withdrawn_at > coalesce((
          select max(e.finished_at) from public.exports e
          where e.language_code = v_export.language_code and e.kind = v_export.kind
            and e.status = 'pret'
        ), '-infinity')
    ), '[]'),
    'audios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cle', r.storage_key,
        'texte', coalesce(r.corrected_text, v.text),
        'phrase', t.code,
        'prise', r.take,
        'voix', s.number,
        'sexe', s.gender,
        'age', s.age_range,
        'region', s.region,
        'langue_maternelle', s.mother_tongue,
        'duree_ms', r.duration_ms,
        'partition', case when s.is_exam then 'test' else 'train' end,
        -- « repetition » : la personne a écouté la phrase avant de la dire (ne lit pas).
        'mode', case when s.assisted_reading then 'repetition' else 'lecture' end
      ) order by s.number, t.code, r.take)
      from public.recordings r
      join public.speakers s on s.id = r.speaker_id
      join public.sentences t on t.id = r.sentence_id
      join public.sentence_versions v
        on v.sentence_id = r.sentence_id and v.version = r.sentence_version
      where s.language_code = v_export.language_code
        and acces.exportable_speaker(s.status)
        and r.kind = v_export.kind
        and r.upload_status = 'recu'
        and r.qc_status in ('valide', 'corrige')
    ), '[]')
  );
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

revoke execute on function acces.model_recording(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.voice_model_key(text, bigint) from public, anon, authenticated;
grant execute on function public.voice_model_key(text, bigint) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'acces.set_consent_audio(bigint, text, text, text)',
    'public.set_consent_audio(bigint, text, text, text)',
    'public.consent_audio_key(bigint, text, text)',
    'acces.set_assisted_reading(uuid, boolean)', 'public.set_assisted_reading(uuid, boolean)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
