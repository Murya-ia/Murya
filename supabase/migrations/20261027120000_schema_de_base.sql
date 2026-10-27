-- =============================================================================
-- Murya Collecte — schéma de base (J1)
-- Tables du modèle de données (spec §9) et sécurité au niveau des lignes (RLS).
--
-- Principes :
--   * RLS activée sur TOUTES les tables. Sans politique, personne ne lit ni n'écrit
--     via l'API (seules les fonctions SECURITY DEFINER et le rôle service peuvent).
--   * Les écritures métier (invitations, envois, vérifications…) passeront par des
--     fonctions SQL ajoutées en J2/J3, pas par des écritures directes.
--   * Les identités (noms, contacts) sont dans le schéma `prive`, jamais exposé par l'API.
--   * Toutes les fonctions fixent `search_path = ''` et qualifient les noms (bonne
--     pratique de sécurité Postgres, vérifiée par le linter de Supabase).
-- =============================================================================

create schema if not exists prive;
revoke all on schema prive from public, anon, authenticated;

-- Rien n'est accessible au rôle `anon` (visiteur non connecté) : les voix passent par l'API.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Langues et réglages
-- -----------------------------------------------------------------------------

create table public.languages (
  code text primary key check (code ~ '^[a-z]{2,3}$'),
  name_fr text not null,
  name_native text,
  active boolean not null default false,
  -- Dernier numéro de voix attribué dans cette langue (V001, V002…).
  speaker_seq integer not null default 0,
  created_at timestamptz not null default now()
);

-- Réglages modifiables sans redéployer (seuils, taille des lots, quotas…).
-- scope = '*' pour toutes les langues, ou un code de langue pour une valeur propre à cette langue.
create table public.settings (
  scope text not null default '*' check (scope = '*' or scope ~ '^[a-z]{2,3}$'),
  key text not null,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (scope, key)
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- Valeur d'un réglage pour une langue : la valeur propre à la langue si elle existe, sinon la valeur globale.
create function public.get_setting(p_language text, p_key text) returns jsonb
language sql stable set search_path = '' as $$
  select value from public.settings
  where key = p_key and scope in (p_language, '*')
  order by scope = '*'
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Équipe et rôles
-- -----------------------------------------------------------------------------

create table public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  roles text[] not null default '{}'
    check (roles <@ array['recruteur', 'verificateur', 'qualite', 'admin']::text[]),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger team_members_updated_at before update on public.team_members
  for each row execute function public.set_updated_at();

-- Spec §2 : deux admins au maximum.
create function public.check_admin_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.active and 'admin' = any(new.roles) and (
    select count(*) from public.team_members
    where active and 'admin' = any(roles) and user_id <> new.user_id
  ) >= 2 then
    raise exception 'Deux admins au maximum (spec §2)';
  end if;
  return new;
end $$;
create trigger team_members_admin_limit before insert or update on public.team_members
  for each row execute function public.check_admin_limit();

-- Fonctions utilisées par les règles RLS. SECURITY DEFINER : elles lisent team_members
-- sans repasser par sa propre règle RLS (sinon la règle s'appellerait elle-même).
create function public.is_team_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members where user_id = auth.uid() and active
  );
$$;

create function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members
    where user_id = auth.uid() and active and p_role = any(roles)
  );
$$;

-- -----------------------------------------------------------------------------
-- Consentement
-- -----------------------------------------------------------------------------

create table public.consent_versions (
  id bigint generated always as identity primary key,
  language_code text not null references public.languages(code),
  version integer not null check (version > 0),
  -- Points à cocher, dans l'ordre d'affichage.
  points text[] not null default array[
    'enregistrement', 'entrainement_ia', 'usage_commercial', 'metadonnees', 'majeur'
  ],
  -- Textes par langue d'interface :
  -- {"dje": {"intro": "…", "points": {"enregistrement": "…", …}}, "fr": {…}}
  texts jsonb not null,
  -- Fichiers audio pré-enregistrés par langue d'interface : {"dje": "<clé>", "fr": "<clé>"}
  audio_keys jsonb not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (language_code, version)
);

-- Spec §3.2 : on ne modifie jamais une version publiée, on en crée une nouvelle.
create function public.protect_published_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.published_at is not null then
    raise exception 'La version % du consentement est publiée : créez une nouvelle version', old.version;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger consent_versions_immutable before update or delete on public.consent_versions
  for each row execute function public.protect_published_consent();

-- -----------------------------------------------------------------------------
-- Invitations et voix
-- -----------------------------------------------------------------------------

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 du jeton : le jeton lui-même n'est jamais stocké.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  language_code text not null references public.languages(code),
  recruiter_id uuid not null references public.team_members(user_id),
  -- Nom ou surnom interne, visible seulement par le recruteur et les admins.
  label text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_recruiter_idx on public.invites (recruiter_id);

create table public.speakers (
  id uuid primary key default gen_random_uuid(),
  language_code text not null references public.languages(code),
  number text not null check (number ~ '^V[0-9]{3,}$'),
  invite_id uuid unique references public.invites(id) on delete set null,
  recruiter_id uuid not null references public.team_members(user_id),
  status text not null default 'inscrite' check (status in (
    'inscrite', 'test_en_attente', 'test_a_refaire', 'active', 'terminee'
  )),
  gender text check (gender in ('homme', 'femme', 'non_precise')),
  age_range text check (age_range in ('18-25', '26-40', '41-60', '60+')),
  region text,
  mother_tongue text,
  phone_model text,
  ui_language text,
  assisted_reading boolean not null default false,
  is_exam boolean not null default false,
  is_principal boolean not null default false,
  -- Message court du recruteur après écoute du test.
  test_feedback text,
  profile_completed_at timestamptz,
  tutorial_done_at timestamptz,
  test_submitted_at timestamptz,
  test_reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (language_code, number)
);
create index speakers_recruiter_idx on public.speakers (recruiter_id);
create index speakers_language_status_idx on public.speakers (language_code, status);
create trigger speakers_updated_at before update on public.speakers
  for each row execute function public.set_updated_at();

-- Prochain numéro de voix anonyme pour une langue (V001, V002…).
-- Le verrou de ligne sur la langue évite que deux voix reçoivent le même numéro.
create function public.next_speaker_number(p_language text) returns text
language sql volatile set search_path = '' as $$
  update public.languages set speaker_seq = speaker_seq + 1 where code = p_language
  returning 'V' || lpad(speaker_seq::text, 3, '0');
$$;

-- Identités : schéma `prive`, accessible uniquement par des fonctions réservées aux admins.
create table prive.identities (
  speaker_id uuid primary key references public.speakers(id) on delete cascade,
  full_name text not null,
  contact text,
  -- Clé du fichier de consentement oral, dans le bucket `identites` (jamais avec les audios).
  oral_consent_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger identities_updated_at before update on prive.identities
  for each row execute function public.set_updated_at();

create table public.consents (
  id bigint generated always as identity primary key,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  consent_version_id bigint not null references public.consent_versions(id),
  checked_points text[] not null,
  mode text not null check (mode in ('ecrit', 'oral')),
  ui_language text not null,
  -- Pour un consentement oral : le recruteur qui l'a enregistré.
  recorded_by uuid references public.team_members(user_id),
  created_at timestamptz not null default now(),
  check (mode = 'ecrit' or recorded_by is not null)
);
create index consents_speaker_idx on public.consents (speaker_id);

-- -----------------------------------------------------------------------------
-- Phrases
-- -----------------------------------------------------------------------------

create table public.sentences (
  id bigint generated always as identity primary key,
  language_code text not null references public.languages(code),
  -- Identifiant venant du tableur (ex. S0457). Sert dans les noms de fichiers : caractères sûrs seulement.
  code text not null check (code ~ '^[A-Za-z0-9_-]+$'),
  version integer not null default 1,
  text text not null check (text is nfc normalized and btrim(text) <> ''),
  translation_fr text check (translation_fr is nfc normalized),
  theme text,
  author text,
  reviewed_by text,
  active boolean not null default true,
  -- Une des 5 phrases fixes du test (spec §3.5) : jamais distribuée dans les lots.
  is_test boolean not null default false,
  word_count integer generated always as (
    array_length(regexp_split_to_array(btrim(text), '\s+'), 1)
  ) stored,
  validated_reads integer not null default 0,
  pending_reads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (language_code, code)
);

-- Historique : chaque version du texte reste consultable, et chaque enregistrement
-- pointe vers la version exacte qui a été lue.
create table public.sentence_versions (
  sentence_id bigint not null references public.sentences(id) on delete cascade,
  version integer not null,
  text text not null,
  translation_fr text,
  created_at timestamptz not null default now(),
  primary key (sentence_id, version)
);

-- Normalise le texte (Unicode NFC, espaces en trop) et crée automatiquement une nouvelle
-- version quand le texte ou la traduction change (spec §5.2 : jamais de modification silencieuse).
create function public.sentences_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.text := normalize(btrim(new.text), nfc);
  new.translation_fr := normalize(btrim(new.translation_fr), nfc);
  if tg_op = 'UPDATE' then
    if new.text is distinct from old.text or new.translation_fr is distinct from old.translation_fr then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger sentences_before_write before insert or update on public.sentences
  for each row execute function public.sentences_before_write();

create function public.sentences_after_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.sentence_versions (sentence_id, version, text, translation_fr)
    values (new.id, new.version, new.text, new.translation_fr);
  end if;
  return null;
end $$;
create trigger sentences_after_write after insert or update on public.sentences
  for each row execute function public.sentences_after_write();

create table public.assignments (
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  sentence_id bigint not null references public.sentences(id),
  -- Ordre (mélangé) de la phrase dans le lot de la voix.
  position integer not null,
  status text not null default 'attribuee' check (status in (
    'attribuee', 'enregistree', 'sautee', 'expiree'
  )),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La clé primaire garantit qu'une voix ne reçoit jamais deux fois la même phrase.
  primary key (speaker_id, sentence_id)
);
create index assignments_sentence_idx on public.assignments (sentence_id);
create index assignments_pending_idx on public.assignments (assigned_at) where status = 'attribuee';
create trigger assignments_updated_at before update on public.assignments
  for each row execute function public.set_updated_at();

create table public.sentence_flags (
  id bigint generated always as identity primary key,
  sentence_id bigint not null references public.sentences(id),
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (sentence_id, speaker_id)
);

create table public.orthography_decisions (
  id bigint generated always as identity primary key,
  language_code text not null references public.languages(code),
  word text not null check (word is nfc normalized),
  chosen_spelling text not null check (chosen_spelling is nfc normalized),
  rejected_variants text[] not null default '{}',
  note text,
  decided_by uuid not null references public.team_members(user_id),
  decided_at timestamptz not null default now(),
  unique (language_code, word)
);

-- -----------------------------------------------------------------------------
-- Enregistrements et vérifications
-- -----------------------------------------------------------------------------

create table public.recordings (
  -- UUID généré dans le navigateur : un envoi répété ne crée jamais de doublon.
  id uuid primary key,
  speaker_id uuid not null references public.speakers(id) on delete cascade,
  sentence_id bigint not null,
  sentence_version integer not null,
  take integer not null check (take > 0),
  kind text not null check (kind in ('varie', 'principale')),
  storage_key text not null unique,
  upload_status text not null default 'en_envoi' check (upload_status in ('en_envoi', 'recu')),
  duration_ms integer,
  sample_rate integer,
  size_bytes integer,
  sha256 bytea,
  -- Mesures calculées par le navigateur (spec §6.1) et réglages micro réellement appliqués.
  client_metrics jsonb,
  mic_settings jsonb,
  -- Résultats des vérifications du serveur (spec §6.2).
  server_checks jsonb,
  suspect boolean,
  checked_at timestamptz,
  qc_status text not null default 'a_verifier' check (qc_status in (
    'a_verifier', 'valide', 'corrige', 'rejete', 'doute'
  )),
  -- Texte corrigé pour correspondre exactement à l'audio ; la phrase d'origine reste intacte.
  corrected_text text check (corrected_text is nfc normalized),
  reject_reason text check (reject_reason in (
    'inaudible', 'bruit_fort', 'autre_voix', 'coupe', 'mauvaise_phrase', 'rire_toux', 'autre'
  )),
  review_comment text,
  reviewer_id uuid references public.team_members(user_id),
  reviewed_at timestamptz,
  -- Réservation temporaire pendant l'écoute (deux vérificateurs ne notent pas le même audio).
  locked_by uuid references public.team_members(user_id),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  received_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (sentence_id, sentence_version) references public.sentence_versions (sentence_id, version),
  unique (speaker_id, sentence_id, take),
  check (qc_status <> 'rejete' or reject_reason is not null),
  check (qc_status <> 'corrige' or corrected_text is not null)
);
create index recordings_speaker_idx on public.recordings (speaker_id);
create index recordings_sentence_idx on public.recordings (sentence_id);
create index recordings_sha256_idx on public.recordings (sha256);
-- File d'écoute : suspects d'abord, puis par ancienneté.
create index recordings_review_queue_idx on public.recordings (suspect desc nulls last, received_at)
  where upload_status = 'recu' and qc_status = 'a_verifier';
create trigger recordings_updated_at before update on public.recordings
  for each row execute function public.set_updated_at();

-- Historique de chaque décision (première écoute, double écoute, arbitrage, test).
create table public.reviews (
  id bigint generated always as identity primary key,
  recording_id uuid not null references public.recordings(id) on delete cascade,
  reviewer_id uuid not null references public.team_members(user_id),
  kind text not null default 'premiere' check (kind in ('premiere', 'double', 'arbitrage', 'test')),
  decision text not null check (decision in ('valide', 'corrige', 'rejete', 'doute')),
  corrected_text text,
  reject_reason text,
  comment text,
  created_at timestamptz not null default now()
);
create index reviews_recording_idx on public.reviews (recording_id);
create index reviews_reviewer_idx on public.reviews (reviewer_id, created_at);

-- -----------------------------------------------------------------------------
-- Tâches de fond, journal, retraits
-- -----------------------------------------------------------------------------

-- File des tâches traitées par le worker Python (vérifications audio, exports, sauvegardes…).
-- La charge utile ne contient jamais de donnée personnelle.
create table public.jobs (
  id bigint generated always as identity primary key,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'en_attente' check (status in (
    'en_attente', 'en_cours', 'termine', 'echec'
  )),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on public.jobs (run_after) where status = 'en_attente';

-- Journal des actions sensibles (spec §5.10). Jamais de donnée personnelle dans `details`.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('equipe', 'voix', 'systeme')),
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at);

-- Seule trace conservée après un retrait (spec §5.8).
create table public.withdrawals (
  id bigint generated always as identity primary key,
  language_code text not null references public.languages(code),
  speaker_number text not null,
  withdrawn_by uuid not null references public.team_members(user_id),
  withdrawn_at timestamptz not null default now(),
  unique (language_code, speaker_number)
);

-- =============================================================================
-- Sécurité au niveau des lignes
-- =============================================================================

alter table public.languages enable row level security;
alter table public.settings enable row level security;
alter table public.team_members enable row level security;
alter table public.consent_versions enable row level security;
alter table public.invites enable row level security;
alter table public.speakers enable row level security;
alter table prive.identities enable row level security;
alter table public.consents enable row level security;
alter table public.sentences enable row level security;
alter table public.sentence_versions enable row level security;
alter table public.assignments enable row level security;
alter table public.sentence_flags enable row level security;
alter table public.orthography_decisions enable row level security;
alter table public.recordings enable row level security;
alter table public.reviews enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_log enable row level security;
alter table public.withdrawals enable row level security;

-- Note : `(select public.has_role(…))` plutôt que `public.has_role(…)` fait calculer la
-- fonction une seule fois par requête au lieu d'une fois par ligne.

-- Référentiels lisibles par toute l'équipe, modifiables par les admins.
create policy team_read on public.languages for select to authenticated
  using ((select public.is_team_member()));
create policy admin_write on public.languages for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy team_read on public.settings for select to authenticated
  using ((select public.is_team_member()));
create policy admin_write on public.settings for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy team_read on public.team_members for select to authenticated
  using ((select public.is_team_member()));
create policy admin_write on public.team_members for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy team_read on public.consent_versions for select to authenticated
  using ((select public.is_team_member()));
create policy admin_write on public.consent_versions for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy team_read on public.sentences for select to authenticated
  using ((select public.is_team_member()));
create policy admin_write on public.sentences for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy team_read on public.sentence_versions for select to authenticated
  using ((select public.is_team_member()));

create policy team_read on public.orthography_decisions for select to authenticated
  using ((select public.is_team_member()));
create policy quality_write on public.orthography_decisions for all to authenticated
  using ((select public.has_role('qualite')) or (select public.has_role('admin')))
  with check ((select public.has_role('qualite')) or (select public.has_role('admin')));

-- Invitations : le recruteur voit les siennes, les admins voient tout.
create policy own_or_admin_read on public.invites for select to authenticated
  using (recruiter_id = (select auth.uid()) or (select public.has_role('admin')));

-- Voix : fiches anonymes (numéro, sexe, âge, région…), lisibles par l'équipe.
create policy team_read on public.speakers for select to authenticated
  using ((select public.is_team_member()));

create policy recruiter_or_admin_read on public.consents for select to authenticated
  using (
    (select public.has_role('admin'))
    or speaker_id in (select id from public.speakers where recruiter_id = (select auth.uid()))
  );

create policy team_read on public.assignments for select to authenticated
  using ((select public.is_team_member()));

create policy team_read on public.sentence_flags for select to authenticated
  using ((select public.is_team_member()));

-- Enregistrements (spec §5.4) : un membre ne voit jamais les audios des voix qu'il a
-- recrutées, sauf leurs phrases de test (qu'il doit écouter pour valider le test).
-- Les admins voient tout.
create policy team_read_not_own_recruits on public.recordings for select to authenticated
  using (
    (select public.has_role('admin'))
    or (
      (select public.is_team_member())
      and (
        speaker_id not in (select id from public.speakers where recruiter_id = (select auth.uid()))
        or sentence_id in (select id from public.sentences where is_test)
      )
    )
  );

create policy reviewer_quality_admin_read on public.reviews for select to authenticated
  using (
    reviewer_id = (select auth.uid())
    or (select public.has_role('qualite'))
    or (select public.has_role('admin'))
  );

create policy admin_read on public.jobs for select to authenticated
  using ((select public.has_role('admin')));
create policy admin_read on public.audit_log for select to authenticated
  using ((select public.has_role('admin')));
create policy admin_read on public.withdrawals for select to authenticated
  using ((select public.has_role('admin')));

-- prive.identities : aucune politique. Accès uniquement par des fonctions admin (J3/J6a).

-- =============================================================================
-- Droits
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.get_setting(text, text) to authenticated;

-- =============================================================================
-- Données de référence
-- =============================================================================

insert into public.languages (code, name_fr, name_native, active)
values ('dje', 'Zarma', 'Zarma ciine', true);

insert into public.settings (scope, key, value, description) values
  ('*', 'batch_size', '150', 'Nombre de phrases par lot (spec §7)'),
  ('*', 'target_reads', '3', 'Nombre de lectures validées visé par phrase'),
  ('*', 'assignment_expiry_days', '7', 'Jours avant qu''une phrase attribuée non enregistrée redevienne disponible'),
  ('*', 'invite_validity_days', '90', 'Durée de validité par défaut d''un lien d''invitation'),
  ('*', 'review_lock_minutes', '5', 'Durée de réservation d''un audio pendant l''écoute'),
  ('*', 'pause_every', '50', 'Écran de pause toutes les N phrases'),
  ('*', 'max_recording_seconds', '20', 'Arrêt automatique de l''enregistrement'),
  ('*', 'client_checks', '{
      "min_duration_ms": 1000,
      "min_speech_rms_dbfs": -45,
      "max_clipped_ratio": 0.001,
      "min_edge_silence_ms": 200
    }', 'Seuils des vérifications instantanées du navigateur (spec §6.1)');
