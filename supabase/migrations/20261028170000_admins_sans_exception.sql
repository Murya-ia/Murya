-- =============================================================================
-- Décision du 27/10/2026 : les ADMINS peuvent vérifier et trancher aussi les audios des
-- voix qu'ils ont recrutées (petite équipe). La règle « jamais ses propres recrues » reste
-- valable pour tous les autres membres (vérificateurs, responsable qualité).
-- =============================================================================

-- Peut-on traiter les audios de cette voix ? Oui si on ne l'a pas recrutée, ou si on est admin.
create function acces.can_review_speaker(p_recruiter_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_recruiter_id is distinct from auth.uid() or acces.has_role('admin');
$$;
revoke execute on function acces.can_review_speaker(uuid) from public, anon;
grant execute on function acces.can_review_speaker(uuid) to authenticated, service_role;

create or replace function acces.review_claim(p_language text, p_mode text default 'premiere')
returns jsonb
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
      and acces.can_review_speaker(s.recruiter_id)
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

create or replace function acces.review_submit(
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

  if not acces.is_reviewer() or not acces.can_review_speaker(v_speaker.recruiter_id) then
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
          jsonb_build_object('texte_corrige', p_decision = 'corrige',
                             'propre_recrue', v_speaker.recruiter_id = auth.uid()));
end $$;

create or replace function acces.review_counts(p_language text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'a_verifier', count(*) filter (where r.qc_status = 'a_verifier' and acces.can_review_speaker(s.recruiter_id)),
    'a_verifier_vos_recrues', count(*) filter (where r.qc_status = 'a_verifier' and not acces.can_review_speaker(s.recruiter_id)),
    'doutes', count(*) filter (where r.qc_status = 'doute' and acces.can_review_speaker(s.recruiter_id)),
    'doutes_vos_recrues', count(*) filter (where r.qc_status = 'doute' and not acces.can_review_speaker(s.recruiter_id))
  )
  from public.recordings r
  join public.speakers s on s.id = r.speaker_id
  where acces.is_reviewer()
    and s.language_code = p_language
    and r.upload_status = 'recu'
    and r.qc_status in ('a_verifier', 'doute');
$$;
