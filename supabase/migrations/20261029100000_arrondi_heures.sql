-- Tableau de bord : heures gardées à 4 décimales (0,36 s) au lieu de 2 (36 s). Avec peu
-- d'audios, « validées » affichait 0 min alors que le graphique en montrait.

create or replace function public.compute_dashboard(p_language text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with
  speakers as (select * from public.speakers where language_code = p_language),
  recs as (
    select r.*, s.recruiter_id
    from public.recordings r join speakers s on s.id = r.speaker_id
    where r.upload_status = 'recu'
  ),
  reviewed as (
    select speaker_id, qc_status,
           row_number() over (partition by speaker_id order by reviewed_at desc) as rang
    from recs where qc_status in ('valide', 'corrige', 'rejete')
  ),
  alert_cfg as (select public.get_setting(p_language, 'alert_rejections') as cfg),
  waiting_cfg as (
    select coalesce((public.get_setting(p_language, 'alert_waiting_days'))::integer, 3) as days)
  select jsonb_build_object(
    'voix_par_statut', jsonb_build_object(
      'invitee', (select count(*) from public.invites i
                  where i.language_code = p_language and i.revoked_at is null and i.expires_at > now()
                    and not exists (select 1 from speakers s where s.invite_id = i.id)),
      'inscrite', (select count(*) from speakers where status = 'inscrite'),
      'test_en_attente', (select count(*) from speakers where status = 'test_en_attente'),
      'test_a_refaire', (select count(*) from speakers where status = 'test_a_refaire'),
      'active', (select count(*) from speakers where status = 'active'),
      'terminee', (select count(*) from speakers where status = 'terminee'),
      'retiree', (select count(*) from public.withdrawals where language_code = p_language)),
    'heures', jsonb_build_object(
      'enregistrees', round((select coalesce(sum(duration_ms), 0) from recs where kind = 'varie') / 3600000.0, 4),
      'validees', round((select coalesce(sum(duration_ms), 0) from recs
                         where kind = 'varie' and qc_status in ('valide', 'corrige')) / 3600000.0, 4)),
    'par_semaine', (
      select coalesce(jsonb_agg(w order by w->>'semaine'), '[]') from (
        select jsonb_build_object(
          'semaine', to_char(date_trunc('week', received_at), 'YYYY-MM-DD'),
          'enregistrees', round(sum(duration_ms) / 3600000.0, 4),
          'validees', round(coalesce(sum(duration_ms) filter (where qc_status in ('valide', 'corrige')), 0) / 3600000.0, 4)) as w
        from recs where kind = 'varie' and received_at >= now() - interval '12 weeks'
        group by date_trunc('week', received_at)) weeks),
    'audios', jsonb_build_object(
      'recus', (select count(*) from recs),
      'a_verifier', (select count(*) from recs where qc_status = 'a_verifier'),
      'doutes', (select count(*) from recs where qc_status = 'doute'),
      'valides', (select count(*) from recs where qc_status in ('valide', 'corrige')),
      'rejetes', (select count(*) from recs where qc_status = 'rejete'),
      'suspects', (select count(*) from recs where suspect)),
    'taux_rejet', (select case when count(*) = 0 then null else
                     round(count(*) filter (where qc_status = 'rejete')::numeric / count(*), 3) end
                   from recs where qc_status in ('valide', 'corrige', 'rejete')),
    'repartition', jsonb_build_object(
      'total', (select count(*) from speakers where profile_completed_at is not null),
      'sexe', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                 select coalesce(gender, 'inconnu') as k, count(*) as n from speakers
                 where profile_completed_at is not null group by 1) x),
      'age', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                select coalesce(age_range, 'inconnu') as k, count(*) as n from speakers
                where profile_completed_at is not null group by 1) x),
      'region', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                   select coalesce(region, 'inconnue') as k, count(*) as n from speakers
                   where profile_completed_at is not null group by 1) x),
      'langue_maternelle', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                   select coalesce(mother_tongue, 'inconnue') as k, count(*) as n from speakers
                   where profile_completed_at is not null group by 1) x)),
    'quotas', public.get_setting(p_language, 'quotas'),
    'langue_maternelle_code', (select mother_tongue_code from public.languages where code = p_language),
    'par_recruteur', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recruteur', m.display_name, 'voix', x.voix, 'actives', x.actives, 'terminees', x.terminees,
        'audios', x.audios) order by m.display_name), '[]')
      from (select s.recruiter_id, count(distinct s.id) as voix,
                   count(distinct s.id) filter (where s.status = 'active') as actives,
                   count(distinct s.id) filter (where s.status = 'terminee') as terminees,
                   count(r.id) as audios
            from speakers s left join recs r on r.speaker_id = s.id
            group by s.recruiter_id) x
      join public.team_members m on m.user_id = x.recruiter_id),
    'phrases_lectures', (
      select jsonb_build_object(
        'zero', count(*) filter (where validated_reads = 0),
        'une', count(*) filter (where validated_reads = 1),
        'deux', count(*) filter (where validated_reads = 2),
        'trois_ou_plus', count(*) filter (where validated_reads >= 3),
        'total', count(*))
      from public.sentences where language_code = p_language and active and not is_test),
    'voix_principale', (
      select jsonb_build_object(
        'numero', min(s.number),
        'validees', (select count(distinct r.sentence_id) from recs r
                     where r.kind = 'principale' and r.qc_status in ('valide', 'corrige')),
        'total', (select count(*) from public.sentences
                  where language_code = p_language and active and not is_test))
      from speakers s where s.is_principal),
    'alertes', jsonb_build_object(
      'voix_trop_de_rejets', (
        select coalesce(jsonb_agg(jsonb_build_object('numero', s.number, 'rejets', x.rejets, 'sur', x.notes)
                                  order by x.rejets desc), '[]')
        from (select speaker_id,
                     count(*) filter (where qc_status = 'rejete') as rejets, count(*) as notes
              from reviewed where rang <= (select (cfg->>'sur')::integer from alert_cfg)
              group by speaker_id) x
        join speakers s on s.id = x.speaker_id
        where x.rejets > (select (cfg->>'max_rejets')::integer from alert_cfg)),
      'audios_en_attente', (
        select jsonb_build_object('nombre', count(*), 'plus_ancien', min(received_at),
                                  'jours', (select days from waiting_cfg))
        from recs where qc_status = 'a_verifier'
          and received_at < now() - make_interval(days => (select days from waiting_cfg)))),
    'double_ecoute', (
      select jsonb_build_object(
        'part', coalesce((public.get_setting(p_language, 'double_review_ratio'))::numeric, 0.1),
        'a_faire', count(*) filter (where d.reviewer_id is null),
        'faites', count(*) filter (where d.reviewer_id is not null),
        'desaccords', count(*) filter (where d.agrees = false),
        'par_verificateur', coalesce((
          select jsonb_agg(jsonb_build_object('verificateur', m.display_name, 'faites', y.faites,
                                              'desaccords', y.desaccords) order by m.display_name)
          from (select dd.first_reviewer_id, count(*) filter (where dd.reviewer_id is not null) as faites,
                       count(*) filter (where dd.agrees = false) as desaccords
                from public.double_reviews dd
                join public.recordings rr on rr.id = dd.recording_id
                join speakers ss on ss.id = rr.speaker_id
                group by dd.first_reviewer_id) y
          join public.team_members m on m.user_id = y.first_reviewer_id), '[]'))
      from public.double_reviews d
      join public.recordings r on r.id = d.recording_id
      join speakers s on s.id = r.speaker_id),
    'taches', (
      select jsonb_build_object(
        'en_attente', count(*) filter (where status in ('en_attente', 'en_cours')),
        'en_echec', count(*) filter (where status = 'echec'),
        'derniere_terminee', max(finished_at))
      from public.jobs)
  );
$$;
