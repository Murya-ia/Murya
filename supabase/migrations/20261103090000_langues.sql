-- =============================================================================
-- Toutes les langues parlées au Niger (Charte de la refondation, 2025, art. 12) :
-- arabe, buduma, fulfuldé, gurmancema, hausa, kanuri, tagdalt, tamajaq, tassawaq, tubu,
-- zarma-sonraï.
--
--   1. Les 11 langues sont enregistrées. Zarma, kanouri (manga) et tamasheq (tawellemmet)
--      sont actives ; les autres attendent une équipe (un admin les active d'un clic).
--   2. Chaque membre a ses langues : il ne travaille (écoute, import, liens…) que dans
--      celles-là. Les admins ont toutes les langues.
--   3. Accord des voix : le texte reste le texte français ; l'équipe enregistre l'explication
--      orale dans chaque langue (audios de l'accord, rangés par langue).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Les langues
-- -----------------------------------------------------------------------------

-- Variété enregistrée (ex. « manga » pour le kanouri) : une langue a souvent plusieurs
-- variétés, on en choisit une avant de l'activer.
alter table public.languages add column variety text;

-- `mother_tongue_code` sert aussi de nom de colonne pour l'import des phrases (« kanouri »…) :
-- il doit être unique.
alter table public.languages
  add constraint languages_mother_tongue_code_key unique (mother_tongue_code);

-- Codes ISO 639-3. Pour les langues inactives, la variété (et donc parfois le code) est à
-- confirmer avant l'activation ; tant qu'aucune donnée n'y est liée, on peut la changer.
insert into public.languages (code, name_fr, name_native, variety, active, mother_tongue_code)
values
  ('kby', 'Kanouri', 'Kanuri', 'manga', true, 'kanouri'),
  ('ttq', 'Tamasheq', 'Tamajaq', 'tawellemmet', true, 'tamasheq'),
  ('hau', 'Haoussa', 'Hausa', null, false, 'haoussa'),
  ('fuh', 'Peul', 'Fulfulde', null, false, 'peul'),
  ('gux', 'Gourmantché', 'Gulmancema', null, false, 'gourmantche'),
  ('tda', 'Tagdal', 'Tagdal', null, false, 'tagdal'),
  ('twq', 'Tasawaq', 'Tasawaq', null, false, 'tasawaq'),
  ('bdm', 'Boudouma', 'Yedina', null, false, 'boudouma'),
  ('tuq', 'Toubou', 'Tedaga', null, false, 'toubou'),
  ('ara', 'Arabe', null, null, false, 'arabe')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Les langues de chaque membre
-- -----------------------------------------------------------------------------

alter table public.team_members add column languages text[] not null default '{}';
-- Jusqu'ici toute l'équipe travaillait en zarma.
update public.team_members set languages = '{dje}';

create function public.check_member_languages() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from unnest(new.languages) l
    where l not in (select code from public.languages)
  ) then
    raise exception 'langue_inconnue';
  end if;
  return new;
end $$;
create trigger team_members_languages before insert or update of languages
  on public.team_members for each row execute function public.check_member_languages();
revoke execute on function public.check_member_languages() from public, anon, authenticated;

-- Le journal note aussi les changements de langues.
create or replace function public.journal_membre() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), case when auth.uid() is null then 'systeme' else 'equipe' end,
          case when tg_op = 'INSERT' then 'membre_ajoute' else 'membre_modifie' end,
          'membre', new.user_id::text,
          jsonb_build_object('roles', new.roles, 'actif', new.active, 'langues', new.languages));
  return new;
end $$;
drop trigger team_members_journal on public.team_members;
create trigger team_members_journal after insert or update of roles, active, languages
  on public.team_members for each row execute function public.journal_membre();

-- La personne connectée peut-elle travailler dans cette langue ? Admin : toutes les langues ;
-- autre membre : ses langues, si elles sont actives.
create function acces.has_language(p_language text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_members m
    where m.user_id = auth.uid() and m.active
      and ('admin' = any(m.roles) or (
        p_language = any(m.languages)
        and exists (select 1 from public.languages l where l.code = p_language and l.active)))
  );
$$;

create function acces.require_language(p_language text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not acces.is_team_member() then
    perform acces.fail('acces_refuse');
  elsif not acces.has_language(p_language) then
    perform acces.fail('langue_non_attribuee');
  end if;
end $$;

-- Annuaire de l'équipe (admins) : avec les langues.
create or replace function acces.team_directory() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id, 'nom', m.display_name, 'roles', to_jsonb(m.roles),
      'langues', to_jsonb(m.languages), 'actif', m.active, 'email', u.email,
      'derniere_connexion', u.last_sign_in_at, 'cree_le', m.created_at)
      order by m.active desc, m.display_name)
    from public.team_members m join auth.users u on u.id = m.user_id
  ), '[]');
end $$;

-- Nouveau membre : avec ses langues.
drop function public.add_team_member(uuid, text, text[]);
drop function acces.add_team_member(uuid, text, text[]);

create function acces.add_team_member(
  p_user_id uuid, p_name text, p_roles text[], p_languages text[] default '{}'
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    perform acces.fail('nom_obligatoire');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_languages, '{}')) l
    where l not in (select code from public.languages)
  ) then
    perform acces.fail('langue_inconnue');
  end if;
  insert into public.team_members (user_id, display_name, roles, languages)
  values (p_user_id, btrim(p_name), coalesce(p_roles, '{}'), coalesce(p_languages, '{}'));
end $$;

create function public.add_team_member(
  p_user_id uuid, p_name text, p_roles text[], p_languages text[] default '{}'
) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.add_team_member(p_user_id, p_name, p_roles, p_languages);
$$;

-- -----------------------------------------------------------------------------
-- 3. Contrôle de la langue dans les actions de l'équipe
-- -----------------------------------------------------------------------------
-- Les fonctions appelées par l'espace équipe vérifient d'abord la langue. Les tâches
-- périodiques appellent directement les fonctions du schéma `acces`, sans ce contrôle.

create or replace function public.review_claim(
  p_language text,
  p_mode text default 'premiere',
  p_skip uuid[] default '{}'
) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.review_claim(p_language, p_mode, p_skip);
end $$;

create or replace function public.double_review_claim(p_language text, p_skip uuid[] default '{}')
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.double_review_claim(p_language, p_skip);
end $$;

create or replace function public.review_counts(p_language text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.review_counts(p_language);
end $$;

create or replace function public.import_sentences(p_language text, p_rows jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.import_sentences(p_language, p_rows);
end $$;

create or replace function public.refresh_dashboard_now(p_language text) returns void
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  perform acces.refresh_dashboard_now(p_language);
end $$;

create or replace function public.find_speakers(p_language text, p_query text) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.find_speakers(p_language, p_query);
end $$;

create or replace function public.exam_overview(p_language text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.exam_overview(p_language);
end $$;

create or replace function public.set_exam_speakers(p_language text, p_add uuid[], p_remove uuid[])
returns void
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  perform acces.set_exam_speakers(p_language, p_add, p_remove);
end $$;

create or replace function public.request_export(p_language text, p_kind text) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.request_export(p_language, p_kind);
end $$;

create or replace function public.principal_overview(p_language text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.principal_overview(p_language);
end $$;

create or replace function public.team_activity(p_language text, p_days integer) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform acces.require_language(p_language);
  return acces.team_activity(p_language, p_days);
end $$;

-- Import des phrases : le texte est dans la colonne qui porte le nom de la langue (« zarma »,
-- « kanouri », « tamasheq »…, c'est-à-dire `mother_tongue_code`). Sinon, même import qu'avant.
create or replace function acces.import_sentences(p_language text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_column text;
  v_row jsonb;
  v_line integer := 1;
  v_code text;
  v_text text;
  v_translation text;
  v_existing public.sentences;
  v_added integer := 0;
  v_updated integer := 0;
  v_new_versions integer := 0;
  v_unchanged integer := 0;
  v_ignored integer := 0;
  v_errors jsonb := '[]';
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  select mother_tongue_code into v_column from public.languages where code = p_language;
  if v_column is null then
    perform acces.fail('langue_inconnue');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1; -- ligne 1 = en-têtes du CSV
    v_code := btrim(coalesce(v_row->>'id', ''));
    v_text := normalize(btrim(coalesce(v_row->>v_column, '')), nfc);
    v_translation := nullif(normalize(btrim(coalesce(v_row->>'francais', '')), nfc), '');

    if translate(lower(btrim(coalesce(v_row->>'statut', ''))), 'éè', 'ee') not in ('validee', 'valide') then
      v_ignored := v_ignored + 1;
      continue;
    end if;
    if v_code !~ '^[A-Za-z0-9_-]+$' then
      v_errors := v_errors || jsonb_build_object('ligne', v_line, 'id', v_code, 'erreur', 'id_invalide');
      continue;
    end if;
    if v_text = '' then
      v_errors := v_errors || jsonb_build_object('ligne', v_line, 'id', v_code, 'erreur', 'texte_vide');
      continue;
    end if;

    select * into v_existing from public.sentences where language_code = p_language and code = v_code;
    if not found then
      insert into public.sentences (language_code, code, text, translation_fr, theme, author, reviewed_by,
                                    is_test)
      values (p_language, v_code, v_text, v_translation, nullif(btrim(v_row->>'theme'), ''),
              nullif(btrim(v_row->>'auteur'), ''), nullif(btrim(v_row->>'relu_par'), ''),
              lower(btrim(coalesce(v_row->>'test', ''))) in ('oui', 'yes', '1', 'vrai'));
      v_added := v_added + 1;
    elsif (v_existing.text, v_existing.translation_fr, v_existing.theme, v_existing.author, v_existing.reviewed_by)
          is not distinct from (v_text, v_translation, nullif(btrim(v_row->>'theme'), ''),
                                nullif(btrim(v_row->>'auteur'), ''), nullif(btrim(v_row->>'relu_par'), '')) then
      v_unchanged := v_unchanged + 1;
    else
      if (v_existing.text, v_existing.translation_fr) is distinct from (v_text, v_translation) then
        v_new_versions := v_new_versions + 1;
      end if;
      update public.sentences set
        text = v_text, translation_fr = v_translation, theme = nullif(btrim(v_row->>'theme'), ''),
        author = nullif(btrim(v_row->>'auteur'), ''), reviewed_by = nullif(btrim(v_row->>'relu_par'), '')
      where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  insert into public.audit_log (actor_id, actor_kind, action, target_type, details)
  values (auth.uid(), 'equipe', 'import_phrases', 'language', jsonb_build_object(
    'langue', p_language, 'ajoutees', v_added, 'modifiees', v_updated, 'erreurs', jsonb_array_length(v_errors)));

  return jsonb_build_object('ajoutees', v_added, 'modifiees', v_updated,
    'nouvelles_versions', v_new_versions, 'inchangees', v_unchanged, 'ignorees', v_ignored,
    'erreurs', v_errors);
end $$;

-- Lien d'invitation : seulement dans une langue du recruteur.
create or replace function public.create_invite(p_label text, p_language text default 'dje')
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_token text;
  v_days integer := coalesce((public.get_setting(p_language, 'invite_validity_days'))::integer, 90);
begin
  perform acces.require_language(p_language);
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

-- Même règle pour un lien ajouté directement dans la table.
drop policy recruiter_insert on public.invites;
create policy recruiter_insert on public.invites for insert to authenticated
  with check (
    recruiter_id = (select auth.uid())
    and ((select acces.has_role('recruteur')) or (select acces.has_role('admin')))
    and acces.has_language(language_code)
  );

-- Accord oral : rangé dans la langue de la voix (et non plus toujours en zarma).
create or replace function acces.record_oral_consent(
  p_invite_id uuid,
  p_full_name text,
  p_contact text,
  p_audio_key text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_invite public.invites;
  v_consent public.consent_versions;
  v_speaker public.speakers;
begin
  select * into v_invite from public.invites where id = p_invite_id;
  if not found then
    perform acces.fail('lien_inconnu');
  elsif not (acces.has_role('admin')
             or (v_invite.recruiter_id = auth.uid() and acces.has_role('recruteur'))) then
    perform acces.fail('acces_refuse');
  elsif v_invite.revoked_at is not null or v_invite.expires_at < now() then
    perform acces.fail('lien_expire');
  elsif btrim(coalesce(p_full_name, '')) = '' then
    perform acces.fail('nom_obligatoire');
  end if;
  v_consent := public.current_consent(v_invite.language_code);
  if v_consent.id is null then
    perform acces.fail('consentement_indisponible');
  end if;

  select * into v_speaker from public.speakers where invite_id = p_invite_id for update;
  if not found then
    insert into public.speakers (language_code, number, invite_id, recruiter_id, ui_language,
                                 assisted_reading)
    values (v_invite.language_code, public.next_speaker_number(v_invite.language_code),
            p_invite_id, v_invite.recruiter_id, v_invite.language_code, true)
    returning * into v_speaker;
    insert into prive.identities (speaker_id, full_name, contact, oral_consent_key)
    values (v_speaker.id, btrim(p_full_name), nullif(btrim(coalesce(p_contact, '')), ''), p_audio_key);
  else
    update prive.identities set oral_consent_key = p_audio_key where speaker_id = v_speaker.id;
  end if;

  insert into public.consents (speaker_id, consent_version_id, checked_points, mode, ui_language, recorded_by)
  values (v_speaker.id, v_consent.id, v_consent.points, 'oral', v_invite.language_code, auth.uid());
  update public.speakers
  set consent_version_id = v_consent.id, assisted_reading = true, last_seen_at = now()
  where id = v_speaker.id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), 'equipe', 'consentement_oral', 'speaker', v_speaker.id::text);

  return jsonb_build_object('numero', v_speaker.number);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Accord des voix dans les nouvelles langues
-- -----------------------------------------------------------------------------

-- Audios de l'accord : en français ou dans une des langues enregistrées.
alter table public.consent_audios drop constraint consent_audios_ui_language_check;
alter table public.consent_audios
  add constraint consent_audios_ui_language_check check (ui_language ~ '^[a-z]{2,3}$');

create or replace function acces.set_consent_audio(
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
  if not exists (select 1 from public.consent_versions where id = p_consent_version_id)
     or (p_ui_language <> 'fr'
         and not exists (select 1 from public.languages where code = p_ui_language)) then
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

-- Texte de l'accord du kanouri et du tamasheq : le texte français de l'accord zarma publié
-- (le même engagement, mot pour mot). Sans accord zarma publié, rien n'est créé.
insert into public.consent_versions (language_code, version, points, texts, published_at)
select l.code, 1, c.points, jsonb_build_object('fr', c.texts -> 'fr'), now()
from (
  select points, texts from public.consent_versions
  where language_code = 'dje' and published_at is not null and texts ? 'fr'
  order by version desc limit 1
) c
cross join (values ('kby'), ('ttq')) l(code)
on conflict (language_code, version) do nothing;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'acces.has_language(text)', 'acces.require_language(text)',
    'acces.add_team_member(uuid, text, text[], text[])',
    'public.add_team_member(uuid, text, text[], text[])'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
