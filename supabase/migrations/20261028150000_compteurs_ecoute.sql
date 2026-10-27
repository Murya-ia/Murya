-- =============================================================================
-- Compteurs de l'écoute alignés sur la file.
--
-- Bug constaté le 27/10/2026 : l'accueil comptait un audio « en doute » que la file ne
-- proposait pas (il venait d'une voix recrutée par la personne, exclue de sa file). Les
-- compteurs suivent maintenant exactement les règles de `review_claim`, et disent à part
-- combien d'audios concernent ses propres recrues (un autre membre doit s'en charger).
-- =============================================================================

create function acces.review_counts(p_language text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'a_verifier', count(*) filter (where r.qc_status = 'a_verifier' and s.recruiter_id <> auth.uid()),
    'a_verifier_vos_recrues', count(*) filter (where r.qc_status = 'a_verifier' and s.recruiter_id = auth.uid()),
    'doutes', count(*) filter (where r.qc_status = 'doute' and s.recruiter_id <> auth.uid()),
    'doutes_vos_recrues', count(*) filter (where r.qc_status = 'doute' and s.recruiter_id = auth.uid())
  )
  from public.recordings r
  join public.speakers s on s.id = r.speaker_id
  where acces.is_reviewer()
    and s.language_code = p_language
    and r.upload_status = 'recu'
    and r.qc_status in ('a_verifier', 'doute');
$$;

create function public.review_counts(p_language text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select acces.review_counts(p_language);
$$;

revoke execute on function acces.review_counts(text) from public, anon;
revoke execute on function public.review_counts(text) from public, anon;
grant execute on function acces.review_counts(text) to authenticated, service_role;
grant execute on function public.review_counts(text) to authenticated, service_role;
