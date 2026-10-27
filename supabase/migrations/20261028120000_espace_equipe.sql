-- =============================================================================
-- J3 — Espace équipe : validation des tests, écoute et vérification, import des
-- phrases, consentement oral.
--
-- Modèle utilisé pour les actions de l'équipe :
--   * l'implémentation est une fonction SECURITY DEFINER dans le schéma `acces`
--     (non exposé par l'API) : elle vérifie elle-même les rôles avant d'agir ;
--   * une petite fonction `public.*` (SECURITY INVOKER) l'appelle : c'est elle que
--     l'espace équipe appelle via l'API Supabase.
-- Ainsi aucune fonction à droits élevés n'est directement publiée (contrôle 0029 de Supabase).
-- =============================================================================

-- Écrire `perform acces.fail('code')` lève une erreur métier lisible par l'app.
create function acces.fail(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code;
end $$;

create function acces.is_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select acces.has_role('verificateur') or acces.has_role('qualite') or acces.has_role('admin');
$$;

-- -----------------------------------------------------------------------------
-- Suivi des voix
-- -----------------------------------------------------------------------------

-- Avancement de chaque voix (vue « security_invoker » : la RLS de l'appelant s'applique).
create view public.speaker_progress with (security_invoker = true) as
select
  s.id as speaker_id,
  count(a.sentence_id) filter (where a.status <> 'expiree')::integer as total,
  count(a.sentence_id) filter (where a.status = 'enregistree')::integer as enregistrees,
  count(a.sentence_id) filter (where a.status = 'sautee')::integer as sautees
from public.speakers s
left join public.assignments a on a.speaker_id = s.id
group by s.id;
grant select on public.speaker_progress to authenticated;

-- Le recruteur (ou un admin) valide le test d'une voix, ou demande de le refaire (spec §3.5).
create function acces.review_speaker_test(p_speaker_id uuid, p_accepted boolean, p_message text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_speaker public.speakers;
  v_status text := case when p_accepted then 'active' else 'test_a_refaire' end;
begin
  select * into v_speaker from public.speakers where id = p_speaker_id for update;
  if not found then
    perform acces.fail('voix_inconnue');
  elsif not (acces.has_role('admin')
             or (v_speaker.recruiter_id = auth.uid() and acces.has_role('recruteur'))) then
    perform acces.fail('acces_refuse');
  elsif v_speaker.status <> 'test_en_attente' then
    perform acces.fail('test_pas_en_attente');
  elsif not p_accepted and btrim(coalesce(p_message, '')) = '' then
    perform acces.fail('message_obligatoire');
  end if;

  update public.speakers set
    status = v_status,
    test_feedback = nullif(btrim(coalesce(p_message, '')), ''),
    test_reviewed_at = now()
  where id = p_speaker_id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), 'equipe', case when p_accepted then 'test_valide' else 'test_a_refaire' end,
          'speaker', p_speaker_id::text);
  return v_status;
end $$;

create function public.review_speaker_test(p_speaker_id uuid, p_accepted boolean, p_message text)
returns text language sql volatile security invoker set search_path = '' as $$
  select acces.review_speaker_test(p_speaker_id, p_accepted, p_message);
$$;

-- -----------------------------------------------------------------------------
-- Écoute des audios
-- -----------------------------------------------------------------------------

-- Clé de stockage d'un audio que la personne connectée a le droit d'écouter (sinon rien) :
-- c'est la règle RLS des enregistrements qui décide. L'API s'en sert pour signer l'URL.
create function public.team_audio_key(p_recording_id uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select storage_key from public.recordings where id = p_recording_id and upload_status = 'recu';
$$;

-- Description d'un audio pour l'écran de vérification.
create function acces.review_item(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id,
    'statut', r.qc_status,
    'type', r.kind,
    'prise', r.take,
    'duree_ms', r.duration_ms,
    'frequence', r.sample_rate,
    'suspect', r.suspect,
    'verifications_serveur', r.server_checks,
    'mesures_navigateur', r.client_metrics,
    'recu_le', r.received_at,
    'reserve_jusqua', r.locked_until,
    'phrase', jsonb_build_object('id', t.id, 'code', t.code, 'texte', v.text,
                                 'traduction', v.translation_fr, 'mots', t.word_count),
    'voix', s.number,
    'avis', coalesce((
      select jsonb_agg(jsonb_build_object('decision', w.decision, 'motif', w.reject_reason,
                                          'commentaire', w.comment, 'le', w.created_at)
                       order by w.created_at)
      from public.reviews w where w.recording_id = r.id), '[]'::jsonb)
  )
  from public.recordings r
  join public.speakers s on s.id = r.speaker_id
  join public.sentences t on t.id = r.sentence_id
  join public.sentence_versions v on v.sentence_id = r.sentence_id and v.version = r.sentence_version
  where r.id = p_recording_id;
$$;

-- Prend l'audio suivant à écouter et le réserve quelques minutes (spec §5.4) :
-- suspects d'abord, puis par ancienneté ; jamais les voix recrutées par la personne.
-- `p_mode = 'doute'` : file du responsable qualité (audios marqués « Doute »).
create function acces.review_claim(p_language text, p_mode text default 'premiere') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_status text := case when p_mode = 'doute' then 'doute' else 'a_verifier' end;
  v_minutes integer := coalesce((public.get_setting(p_language, 'review_lock_minutes'))::integer, 5);
  v_id uuid;
begin
  if not acces.is_reviewer() then
    perform acces.fail('acces_refuse');
  elsif p_mode = 'doute' and not (acces.has_role('qualite') or acces.has_role('admin')) then
    perform acces.fail('acces_refuse');
  end if;

  -- Audio déjà réservé par cette personne (page rechargée) : on le lui redonne.
  select r.id into v_id
  from public.recordings r join public.speakers s on s.id = r.speaker_id
  where r.locked_by = auth.uid() and r.locked_until > now() and r.qc_status = v_status
    and s.language_code = p_language
  limit 1;

  if v_id is null then
    select r.id into v_id
    from public.recordings r join public.speakers s on s.id = r.speaker_id
    where s.language_code = p_language
      and r.upload_status = 'recu'
      and r.qc_status = v_status
      and s.recruiter_id <> auth.uid()
      and (r.locked_until is null or r.locked_until < now())
    order by r.suspect desc nulls last, r.received_at
    limit 1
    for update of r skip locked;
    if v_id is null then
      return null;
    end if;
    update public.recordings
    set locked_by = auth.uid(), locked_until = now() + make_interval(mins => v_minutes)
    where id = v_id;
  end if;
  return acces.review_item(v_id);
end $$;

create function public.review_claim(p_language text, p_mode text default 'premiere') returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.review_claim(p_language, p_mode);
$$;

-- Libère un audio réservé sans le noter (bouton « Passer »).
create function acces.review_release(p_recording_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.recordings set locked_by = null, locked_until = null
  where id = p_recording_id and locked_by = auth.uid();
$$;

create function public.review_release(p_recording_id uuid) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.review_release(p_recording_id);
$$;

-- Décision sur un audio (spec §5.4) : validé, à corriger (texte corrigé gardé SUR
-- l'enregistrement, la phrase d'origine reste intacte), rejeté (avec motif) ou doute.
create function acces.review_submit(
  p_recording_id uuid,
  p_decision text,
  p_corrected_text text default null,
  p_reject_reason text default null,
  p_comment text default null
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec public.recordings;
  v_speaker public.speakers;
  v_corrected text := nullif(normalize(btrim(coalesce(p_corrected_text, '')), nfc), '');
begin
  select * into v_rec from public.recordings where id = p_recording_id for update;
  if not found or v_rec.upload_status <> 'recu' then
    perform acces.fail('enregistrement_inconnu');
  end if;
  select * into v_speaker from public.speakers where id = v_rec.speaker_id;

  if not acces.is_reviewer() or v_speaker.recruiter_id = auth.uid() then
    perform acces.fail('acces_refuse');
  elsif v_rec.qc_status not in ('a_verifier', 'doute') then
    perform acces.fail('deja_verifie');
  elsif v_rec.qc_status = 'doute' and not (acces.has_role('qualite') or acces.has_role('admin')) then
    perform acces.fail('acces_refuse');
  elsif v_rec.locked_by is distinct from auth.uid() and v_rec.locked_until > now() then
    perform acces.fail('reserve_par_autre');
  elsif p_decision not in ('valide', 'corrige', 'rejete', 'doute') then
    perform acces.fail('decision_inconnue');
  elsif p_decision = 'doute' and v_rec.qc_status = 'doute' then
    perform acces.fail('decision_inconnue');
  elsif p_decision = 'corrige' and v_corrected is null then
    perform acces.fail('texte_corrige_obligatoire');
  elsif p_decision = 'rejete' and p_reject_reason is null then
    perform acces.fail('motif_obligatoire');
  end if;

  update public.recordings set
    qc_status = p_decision,
    corrected_text = case when p_decision = 'corrige' then v_corrected end,
    reject_reason = case when p_decision = 'rejete' then p_reject_reason end,
    review_comment = nullif(btrim(coalesce(p_comment, '')), ''),
    reviewer_id = auth.uid(),
    reviewed_at = now(),
    locked_by = null,
    locked_until = null
  where id = p_recording_id;

  insert into public.reviews (recording_id, reviewer_id, kind, decision, corrected_text, reject_reason, comment)
  values (p_recording_id, auth.uid(),
          case when v_rec.qc_status = 'doute' then 'arbitrage' else 'premiere' end,
          p_decision, v_corrected, p_reject_reason, nullif(btrim(coalesce(p_comment, '')), ''));

  -- Compteurs de lectures (distribution des phrases, spec §7).
  if p_decision in ('valide', 'corrige') then
    update public.sentences set
      validated_reads = validated_reads + 1,
      pending_reads = case
        when exists (select 1 from public.assignments
                     where speaker_id = v_rec.speaker_id and sentence_id = v_rec.sentence_id)
        then greatest(pending_reads - 1, 0) else pending_reads end
    where id = v_rec.sentence_id;
  end if;

  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'audio_' || p_decision, 'recording', p_recording_id::text,
          jsonb_build_object('texte_corrige', p_decision = 'corrige'));
end $$;

create function public.review_submit(
  p_recording_id uuid,
  p_decision text,
  p_corrected_text text default null,
  p_reject_reason text default null,
  p_comment text default null
) returns void language sql volatile security invoker set search_path = '' as $$
  select acces.review_submit(p_recording_id, p_decision, p_corrected_text, p_reject_reason, p_comment);
$$;

-- -----------------------------------------------------------------------------
-- Import des phrases (spec §5.2)
-- -----------------------------------------------------------------------------

-- Import d'un CSV (déjà découpé par l'espace équipe) : seules les phrases « Validée » sont
-- prises. Une phrase existante est mise à jour par son `id` ; si son texte change, une
-- nouvelle version est créée automatiquement (historique gardé).
create function acces.import_sentences(p_language text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
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

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1; -- ligne 1 = en-têtes du CSV
    v_code := btrim(coalesce(v_row->>'id', ''));
    v_text := normalize(btrim(coalesce(v_row->>'zarma', '')), nfc);
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

create function public.import_sentences(p_language text, p_rows jsonb) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.import_sentences(p_language, p_rows);
$$;

-- -----------------------------------------------------------------------------
-- Consentement oral (spec §3.2) : pour les personnes qui lisent peu, le recruteur
-- enregistre leur accord oral. Le fichier est rangé avec les identités (bucket à part),
-- jamais avec les audios des voix.
-- -----------------------------------------------------------------------------

create function acces.record_oral_consent(
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
            p_invite_id, v_invite.recruiter_id, 'dje', true)
    returning * into v_speaker;
    insert into prive.identities (speaker_id, full_name, contact, oral_consent_key)
    values (v_speaker.id, btrim(p_full_name), nullif(btrim(coalesce(p_contact, '')), ''), p_audio_key);
  else
    update prive.identities set oral_consent_key = p_audio_key where speaker_id = v_speaker.id;
  end if;

  insert into public.consents (speaker_id, consent_version_id, checked_points, mode, ui_language, recorded_by)
  values (v_speaker.id, v_consent.id, v_consent.points, 'oral', 'dje', auth.uid());
  update public.speakers
  set consent_version_id = v_consent.id, assisted_reading = true, last_seen_at = now()
  where id = v_speaker.id;
  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id)
  values (auth.uid(), 'equipe', 'consentement_oral', 'speaker', v_speaker.id::text);

  return jsonb_build_object('numero', v_speaker.number);
end $$;

create function public.record_oral_consent(
  p_invite_id uuid,
  p_full_name text,
  p_contact text,
  p_audio_key text
) returns jsonb language sql volatile security invoker set search_path = '' as $$
  select acces.record_oral_consent(p_invite_id, p_full_name, p_contact, p_audio_key);
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'acces.fail(text)', 'acces.is_reviewer()',
    'acces.review_speaker_test(uuid, boolean, text)', 'public.review_speaker_test(uuid, boolean, text)',
    'public.team_audio_key(uuid)', 'acces.review_item(uuid)',
    'acces.review_claim(text, text)', 'public.review_claim(text, text)',
    'acces.review_release(uuid)', 'public.review_release(uuid)',
    'acces.review_submit(uuid, text, text, text, text)', 'public.review_submit(uuid, text, text, text, text)',
    'acces.import_sentences(text, jsonb)', 'public.import_sentences(text, jsonb)',
    'acces.record_oral_consent(uuid, text, text, text)', 'public.record_oral_consent(uuid, text, text, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
