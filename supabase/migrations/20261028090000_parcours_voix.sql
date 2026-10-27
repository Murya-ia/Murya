-- =============================================================================
-- J2 — Parcours des voix : invitations, consentement, fiche, test, lots, envois.
--
-- Les voix n'ont pas de compte : l'API (Cloudflare Worker) reçoit leur jeton, en calcule
-- l'empreinte SHA-256 et appelle les fonctions `voice_*` ci-dessous avec cette empreinte.
-- Ces fonctions ne sont exécutables QUE par le rôle `service_role` (l'API), jamais depuis
-- un navigateur. Elles retrouvent elles-mêmes la voix à partir de l'empreinte : l'API ne
-- peut pas agir pour une autre voix par erreur.
--
-- Les erreurs « métier » sont levées avec un message court (ex. `lien_expire`) que l'API
-- renvoie tel quel à l'app, qui l'affiche avec une phrase simple.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Compléments de schéma
-- -----------------------------------------------------------------------------

-- Dernière version du consentement acceptée et dernière activité (pour l'écran de rappel).
alter table public.speakers
  add column consent_version_id bigint references public.consent_versions(id),
  add column last_seen_at timestamptz;

-- Écran de rappel du consentement, confirmé à chaque retour de la voix.
create table public.consent_reminders (
  id bigint generated always as identity primary key,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  consent_version_id bigint not null references public.consent_versions(id),
  ui_language text not null,
  created_at timestamptz not null default now()
);
create index consent_reminders_speaker_idx on public.consent_reminders (speaker_id);
alter table public.consent_reminders enable row level security;
create policy recruiter_or_admin_read on public.consent_reminders for select to authenticated
  using (
    (select acces.has_role('admin'))
    or speaker_id in (select id from public.speakers where recruiter_id = (select auth.uid()))
  );
grant select on public.consent_reminders to authenticated;
grant all on public.consent_reminders to service_role;

insert into public.settings (scope, key, value, description) values
  ('*', 'consent_reminder_hours', '1',
   'Heures sans activité après lesquelles la voix revoit l''écran de rappel du consentement');

-- Seuils recalibrés après le test sur iPhone 13 Pro (micro brut, voix à -41 dBFS) :
-- « on vous entend » se juge d'abord sur l'écart entre la voix et le bruit de fond.
update public.settings set value = '{
    "min_duration_ms": 1000,
    "min_speech_rms_dbfs": -55,
    "min_snr_db": 15,
    "max_clipped_ratio": 0.001,
    "min_edge_silence_ms": 200
  }'
where scope = '*' and key = 'client_checks';

-- -----------------------------------------------------------------------------
-- Invitations (espace équipe, rôle recruteur)
-- -----------------------------------------------------------------------------

create policy recruiter_insert on public.invites for insert to authenticated
  with check (
    recruiter_id = (select auth.uid())
    and ((select acces.has_role('recruteur')) or (select acces.has_role('admin')))
  );
create policy own_or_admin_update on public.invites for update to authenticated
  using (recruiter_id = (select auth.uid()) or (select acces.has_role('admin')))
  with check (recruiter_id = (select auth.uid()) or (select acces.has_role('admin')));
grant insert (token_hash, language_code, recruiter_id, label, expires_at) on public.invites to authenticated;
grant update (revoked_at) on public.invites to authenticated;

-- Crée un lien d'invitation et renvoie le jeton EN CLAIR, une seule fois : seule son
-- empreinte est stockée. Exécutée avec les droits de l'appelant (la RLS s'applique).
create function public.create_invite(p_label text, p_language text default 'dje')
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_token text;
  v_days integer := coalesce((public.get_setting(p_language, 'invite_validity_days'))::integer, 90);
begin
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'libelle_obligatoire';
  end if;
  -- 32 octets aléatoires (deux UUID v4 tirés par le générateur sûr de Postgres), en base64 « URL ».
  v_token := rtrim(translate(encode(
    uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '=');
  return query
    insert into public.invites (token_hash, language_code, recruiter_id, label, expires_at)
    values (sha256(convert_to(v_token, 'UTF8')), p_language, auth.uid(), btrim(p_label),
            now() + make_interval(days => v_days))
    returning invites.id, v_token, invites.expires_at;
end $$;
grant execute on function public.create_invite(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Fonctions internes
-- -----------------------------------------------------------------------------

-- Invitation correspondant à une empreinte de jeton (hexadécimal), ou erreur claire.
create function public.voice_invite(p_token_hash text) returns public.invites
language plpgsql stable security definer set search_path = '' as $$
declare
  v_invite public.invites;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'lien_inconnu';
  end if;
  select * into v_invite from public.invites where token_hash = decode(p_token_hash, 'hex');
  if not found then
    raise exception 'lien_inconnu';
  elsif v_invite.revoked_at is not null then
    raise exception 'lien_revoque';
  elsif v_invite.expires_at < now() then
    raise exception 'lien_expire';
  end if;
  return v_invite;
end $$;

-- Version publiée la plus récente du consentement pour une langue (null si aucune).
create function public.current_consent(p_language text) returns public.consent_versions
language sql stable security definer set search_path = '' as $$
  select * from public.consent_versions
  where language_code = p_language and published_at is not null and published_at <= now()
  order by version desc
  limit 1;
$$;

-- Voix rattachée à une invitation, prête à enregistrer : consentement à jour et fiche remplie.
-- `p_lock` verrouille la ligne (évite deux envois simultanés avec le même numéro de prise).
create function public.voice_ready_speaker(p_token_hash text, p_lock boolean default false)
returns public.speakers
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.invites := public.voice_invite(p_token_hash);
  v_speaker public.speakers;
begin
  if p_lock then
    select * into v_speaker from public.speakers where invite_id = v_invite.id for update;
  else
    select * into v_speaker from public.speakers where invite_id = v_invite.id;
  end if;
  if not found then
    raise exception 'consentement_requis';
  elsif v_speaker.consent_version_id is distinct from (public.current_consent(v_invite.language_code)).id then
    raise exception 'consentement_requis';
  elsif v_speaker.profile_completed_at is null then
    raise exception 'fiche_requise';
  end if;
  return v_speaker;
end $$;

-- Attribue un lot de phrases à une voix (spec §7). Les phrases les moins lues d'abord ;
-- `skip locked` : si 200 voix demandent un lot en même temps, chacune prend des phrases
-- différentes au lieu d'attendre que les autres aient fini.
create function public.assign_batch(p_speaker_id uuid) returns integer
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

-- -----------------------------------------------------------------------------
-- Fonctions appelées par l'API pour les voix
-- -----------------------------------------------------------------------------

-- État complet de la voix : ce que l'app doit afficher.
create function public.voice_session(p_token_hash text) returns jsonb
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
      'textes', v_consent.texts, 'audios', v_consent.audio_keys) end,
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
      'principale', v_speaker.is_principal) end
  );
end $$;

-- Consentement complet (première visite, ou nouvelle version publiée).
-- À la première visite, crée la voix (numéro anonyme) et son identité (schéma prive).
create function public.voice_consent(
  p_token_hash text,
  p_consent_id bigint,
  p_points text[],
  p_ui_language text,
  p_full_name text default null,
  p_contact text default null
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.invites := public.voice_invite(p_token_hash);
  v_consent public.consent_versions := public.current_consent(v_invite.language_code);
  v_speaker public.speakers;
begin
  if v_consent.id is null or v_consent.id <> p_consent_id then
    raise exception 'consentement_perime';
  end if;
  if not (v_consent.points <@ coalesce(p_points, '{}')) then
    raise exception 'consentement_incomplet';
  end if;

  select * into v_speaker from public.speakers where invite_id = v_invite.id for update;
  if not found then
    if btrim(coalesce(p_full_name, '')) = '' then
      raise exception 'nom_obligatoire';
    end if;
    insert into public.speakers (language_code, number, invite_id, recruiter_id, ui_language)
    values (v_invite.language_code, public.next_speaker_number(v_invite.language_code),
            v_invite.id, v_invite.recruiter_id, p_ui_language)
    on conflict (invite_id) do nothing
    returning * into v_speaker;
    if v_speaker.id is null then
      -- Double envoi simultané : l'autre requête a déjà créé la voix.
      select * into v_speaker from public.speakers where invite_id = v_invite.id;
    else
      insert into prive.identities (speaker_id, full_name, contact)
      values (v_speaker.id, btrim(p_full_name), nullif(btrim(coalesce(p_contact, '')), ''));
    end if;
  end if;

  if v_speaker.consent_version_id is distinct from v_consent.id then
    insert into public.consents (speaker_id, consent_version_id, checked_points, mode, ui_language)
    values (v_speaker.id, v_consent.id, p_points, 'ecrit', p_ui_language);
  end if;
  update public.speakers
  set consent_version_id = v_consent.id, last_seen_at = now(), ui_language = p_ui_language
  where id = v_speaker.id;

  return jsonb_build_object('numero', v_speaker.number);
end $$;

-- Écran de rappel du consentement confirmé (« Je continue »).
create function public.voice_reminder(p_token_hash text, p_ui_language text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.invites := public.voice_invite(p_token_hash);
  v_speaker public.speakers;
begin
  select * into v_speaker from public.speakers where invite_id = v_invite.id;
  if not found or v_speaker.consent_version_id is distinct from (public.current_consent(v_invite.language_code)).id then
    raise exception 'consentement_requis';
  end if;
  insert into public.consent_reminders (speaker_id, consent_version_id, ui_language)
  values (v_speaker.id, v_speaker.consent_version_id, p_ui_language);
  update public.speakers set last_seen_at = now() where id = v_speaker.id;
end $$;

-- Fiche de la voix (spec §3.3).
create function public.voice_profile(
  p_token_hash text,
  p_gender text,
  p_age_range text,
  p_region text,
  p_mother_tongue text,
  p_phone_model text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.invites := public.voice_invite(p_token_hash);
  v_speaker public.speakers;
begin
  select * into v_speaker from public.speakers where invite_id = v_invite.id;
  if not found then
    raise exception 'consentement_requis';
  end if;
  if btrim(coalesce(p_region, '')) = '' or btrim(coalesce(p_mother_tongue, '')) = '' then
    raise exception 'fiche_incomplete';
  end if;
  update public.speakers set
    gender = p_gender,
    age_range = p_age_range,
    region = btrim(p_region),
    mother_tongue = btrim(p_mother_tongue),
    phone_model = nullif(left(btrim(coalesce(p_phone_model, '')), 100), ''),
    profile_completed_at = coalesce(profile_completed_at, now()),
    last_seen_at = now()
  where id = v_speaker.id;
end $$;

create function public.voice_tutorial_done(p_token_hash text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers := public.voice_ready_speaker(p_token_hash);
begin
  update public.speakers set tutorial_done_at = coalesce(tutorial_done_at, now()) where id = v_speaker.id;
end $$;

-- Phrases à enregistrer, selon l'étape : test (5 phrases), attente, lot, fin.
-- Pour une voix active sans lot, le lot est attribué ici.
create function public.voice_sentences(p_token_hash text) returns jsonb
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

-- Prépare l'envoi d'un audio : crée la ligne `recordings` (« en_envoi ») et fixe le numéro
-- de prise et la clé de stockage. Idempotent : le même UUID renvoie toujours la même clé.
create function public.voice_prepare_upload(p_token_hash text, p_recording_id uuid, p_sentence_id bigint)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers := public.voice_ready_speaker(p_token_hash, true);
  v_existing public.recordings;
  v_sentence public.sentences;
  v_kind text := case when v_speaker.is_principal then 'principale' else 'varie' end;
  v_take integer;
  v_key text;
begin
  select * into v_existing from public.recordings where id = p_recording_id;
  if found then
    if v_existing.speaker_id <> v_speaker.id then
      raise exception 'enregistrement_inconnu';
    end if;
    return jsonb_build_object('cle', v_existing.storage_key, 'prise', v_existing.take,
                              'statut', v_existing.upload_status);
  end if;

  select * into v_sentence from public.sentences where id = p_sentence_id;
  if not found or v_sentence.language_code <> v_speaker.language_code then
    raise exception 'phrase_inconnue';
  end if;
  -- La phrase doit faire partie de ce que la voix a le droit d'enregistrer maintenant.
  if v_sentence.is_test then
    if v_speaker.status not in ('inscrite', 'test_a_refaire') then
      raise exception 'phrase_non_attribuee';
    end if;
  elsif not exists (select 1 from public.assignments
                    where speaker_id = v_speaker.id and sentence_id = p_sentence_id)
     and not exists (select 1 from public.recordings
                     where speaker_id = v_speaker.id and sentence_id = p_sentence_id and qc_status = 'rejete') then
    raise exception 'phrase_non_attribuee';
  end if;

  select coalesce(max(take), 0) + 1 into v_take
  from public.recordings where speaker_id = v_speaker.id and sentence_id = p_sentence_id;
  -- Spec §4.3 : {langue}/{type}/{numéro_voix}/{langue}_{numéro_voix}_{id_phrase}_{prise}.wav
  v_key := format('%s/%s/%s/%s_%s_%s_%s.wav', v_speaker.language_code, v_kind, v_speaker.number,
                  v_speaker.language_code, v_speaker.number, v_sentence.code, v_take);

  insert into public.recordings (id, speaker_id, sentence_id, sentence_version, take, kind, storage_key)
  values (p_recording_id, v_speaker.id, p_sentence_id, v_sentence.version, v_take, v_kind, v_key);
  return jsonb_build_object('cle', v_key, 'prise', v_take, 'statut', 'en_envoi');
end $$;

-- Confirme qu'un audio est bien arrivé dans le stockage (vérifié par l'API) : le passe à
-- « reçu », crée la tâche de vérification serveur et fait avancer le statut de la voix,
-- le tout dans la même transaction. Idempotent.
create function public.voice_confirm_upload(
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

-- « Je n'arrive pas à lire cette phrase » : la phrase est sautée et signalée à l'équipe.
create function public.voice_skip_sentence(p_token_hash text, p_sentence_id bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers := public.voice_ready_speaker(p_token_hash, true);
begin
  if v_speaker.status <> 'active' then
    raise exception 'phrase_non_attribuee';
  end if;
  update public.assignments set status = 'sautee'
  where speaker_id = v_speaker.id and sentence_id = p_sentence_id and status = 'attribuee';
  if found then
    update public.sentences set pending_reads = greatest(pending_reads - 1, 0) where id = p_sentence_id;
    insert into public.sentence_flags (sentence_id, speaker_id) values (p_sentence_id, v_speaker.id)
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.assignments where speaker_id = v_speaker.id and status = 'attribuee') then
    update public.speakers set status = 'terminee', completed_at = now() where id = v_speaker.id;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : les fonctions des voix ne sont exécutables que par l'API (service_role).
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'voice_invite(text)', 'current_consent(text)', 'voice_ready_speaker(text, boolean)',
    'assign_batch(uuid)', 'voice_session(text)',
    'voice_consent(text, bigint, text[], text, text, text)', 'voice_reminder(text, text)',
    'voice_profile(text, text, text, text, text, text)', 'voice_tutorial_done(text)',
    'voice_sentences(text)', 'voice_prepare_upload(text, uuid, bigint)',
    'voice_confirm_upload(text, uuid, integer, integer, integer, jsonb, jsonb)',
    'voice_skip_sentence(text, bigint)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
