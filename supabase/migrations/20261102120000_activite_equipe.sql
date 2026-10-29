-- Vue d'ensemble de l'activité de l'équipe (page « Activité », admins) : pour chaque membre,
-- sur la période choisie (aujourd'hui, 7 ou 30 jours, heure de Niamey) :
--   - écoute : audios décidés (validé, corrigé, rejeté, doute), arbitrages, doubles écoutes,
--     audios par jour, rythme (temps médian entre deux décisions qui se suivent) ;
--   - qualité : ses décisions réécoutées en double écoute, et combien le responsable qualité
--     a confirmées ;
--   - recrutement : invitations créées, tests de voix validés ou à refaire ;
--   - dernière connexion et dernière action.
-- La répartition de l'écoute ne change pas : une seule file commune pour tout le monde.

create function acces.team_activity(p_language text, p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_today date := (now() at time zone 'Africa/Niamey')::date;
  v_from date := v_today - (v_days - 1);
  v_since timestamptz := (v_from::timestamp) at time zone 'Africa/Niamey';
  v_result jsonb;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;

  with decisions as (
    -- Décisions d'écoute de la période, dans cette langue (les tests de voix sont à part).
    select rv.reviewer_id, rv.kind, rv.decision, rv.created_at,
           (rv.created_at at time zone 'Africa/Niamey')::date as jour
    from public.reviews rv
    join public.recordings r on r.id = rv.recording_id
    join public.speakers s on s.id = r.speaker_id
    where s.language_code = p_language
      and rv.kind in ('premiere', 'arbitrage', 'double')
      and rv.created_at >= v_since
  ),
  gaps as (
    -- Temps entre deux décisions qui se suivent ; une pause de plus de 10 minutes n'est pas
    -- du travail, et moins de 2 secondes est un double clic.
    select reviewer_id,
           extract(epoch from created_at - lag(created_at) over (
             partition by reviewer_id order by created_at)) as secondes
    from decisions
  ),
  rythme as (
    select reviewer_id, round(percentile_cont(0.5) within group (order by secondes))::integer as s
    from gaps
    where secondes between 2 and 600
    group by reviewer_id
  ),
  par_jour as (
    select d.reviewer_id, jsonb_agg(jsonb_build_object('jour', j.jour, 'n', coalesce(c.n, 0))
                                    order by j.jour) as serie
    from (select distinct reviewer_id from decisions) d
    cross join generate_series(v_from, v_today, interval '1 day') as j(jour)
    left join (
      select reviewer_id, jour, count(*) as n from decisions group by reviewer_id, jour
    ) c on c.reviewer_id = d.reviewer_id and c.jour = j.jour::date
    group by d.reviewer_id
  ),
  ecoute as (
    select reviewer_id,
           count(*) filter (where kind = 'premiere') as premieres,
           count(*) filter (where kind = 'premiere' and decision = 'valide') as valide,
           count(*) filter (where kind = 'premiere' and decision = 'corrige') as corrige,
           count(*) filter (where kind = 'premiere' and decision = 'rejete') as rejete,
           count(*) filter (where kind = 'premiere' and decision = 'doute') as doute,
           count(*) filter (where kind = 'arbitrage') as arbitrages,
           count(*) filter (where kind = 'double') as doubles,
           max(created_at) as derniere
    from decisions
    group by reviewer_id
  ),
  controle as (
    -- Ses décisions réécoutées à l'aveugle par le responsable qualité pendant la période.
    select dr.first_reviewer_id as user_id,
           count(*) as controles,
           count(*) filter (where dr.agrees) as accords
    from public.double_reviews dr
    join public.recordings r on r.id = dr.recording_id
    join public.speakers s on s.id = r.speaker_id
    where s.language_code = p_language
      and dr.reviewed_at >= v_since
      and dr.first_reviewer_id is not null
    group by dr.first_reviewer_id
  ),
  recrutement as (
    select tm.user_id,
           (select count(*) from public.invites i
             where i.recruiter_id = tm.user_id and i.language_code = p_language
               and i.created_at >= v_since) as invitations,
           (select count(*) from public.audit_log l
             where l.actor_id = tm.user_id and l.action = 'test_valide'
               and l.created_at >= v_since) as tests_valides,
           (select count(*) from public.audit_log l
             where l.actor_id = tm.user_id and l.action = 'test_a_refaire'
               and l.created_at >= v_since) as tests_a_refaire,
           (select max(l.created_at) from public.audit_log l
             where l.actor_id = tm.user_id) as derniere_action
    from public.team_members tm
  )
  select jsonb_build_object(
    'jours', v_days,
    'depuis', v_from,
    'equipe', jsonb_build_object(
      'decisions', (select count(*) from decisions where kind in ('premiere', 'arbitrage')),
      'a_verifier', (select count(*) from public.recordings r
                       join public.speakers s on s.id = r.speaker_id
                      where s.language_code = p_language and r.upload_status = 'recu'
                        and r.qc_status = 'a_verifier'),
      'doutes', (select count(*) from public.recordings r
                   join public.speakers s on s.id = r.speaker_id
                  where s.language_code = p_language and r.qc_status = 'doute')
    ),
    'membres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', tm.user_id,
               'nom', tm.display_name,
               'roles', tm.roles,
               'actif', tm.active,
               'derniere_connexion', u.last_sign_in_at,
               'derniere_action', greatest(e.derniere, rc.derniere_action),
               'ecoute', jsonb_build_object(
                 'premieres', coalesce(e.premieres, 0),
                 'valide', coalesce(e.valide, 0),
                 'corrige', coalesce(e.corrige, 0),
                 'rejete', coalesce(e.rejete, 0),
                 'doute', coalesce(e.doute, 0),
                 'arbitrages', coalesce(e.arbitrages, 0),
                 'doubles', coalesce(e.doubles, 0),
                 'rythme_s', ry.s,
                 'par_jour', pj.serie
               ),
               'controle', jsonb_build_object(
                 'controles', coalesce(c.controles, 0),
                 'accords', coalesce(c.accords, 0)
               ),
               'recrutement', jsonb_build_object(
                 'invitations', rc.invitations,
                 'tests_valides', rc.tests_valides,
                 'tests_a_refaire', rc.tests_a_refaire
               )
             ) order by coalesce(e.premieres, 0) + coalesce(e.arbitrages, 0)
                        + coalesce(e.doubles, 0) desc, tm.display_name)
      from public.team_members tm
      left join auth.users u on u.id = tm.user_id
      left join ecoute e on e.reviewer_id = tm.user_id
      left join rythme ry on ry.reviewer_id = tm.user_id
      left join par_jour pj on pj.reviewer_id = tm.user_id
      left join controle c on c.user_id = tm.user_id
      left join recrutement rc on rc.user_id = tm.user_id
      -- Les membres désactivés n'apparaissent que s'ils ont travaillé pendant la période.
      where tm.active or e.reviewer_id is not null
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create function public.team_activity(p_language text, p_days integer) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select acces.team_activity(p_language, p_days);
$$;

revoke execute on function acces.team_activity(text, integer) from public, anon;
grant execute on function acces.team_activity(text, integer) to authenticated, service_role;
revoke execute on function public.team_activity(text, integer) from public, anon;
grant execute on function public.team_activity(text, integer) to authenticated, service_role;
