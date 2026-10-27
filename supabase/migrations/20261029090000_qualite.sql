-- =============================================================================
-- J4 — Qualité : file des tâches du worker, vérifications serveur, double écoute,
-- expiration des phrases attribuées, alertes, quotas et tableau de bord.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Réglages (modifiables sans redéployer)
-- -----------------------------------------------------------------------------

insert into public.settings (scope, key, value, description) values
  ('*', 'server_checks', '{
      "min_duration_ms": 1000,
      "max_duration_ms": 20000,
      "min_speech_rms_dbfs": -55,
      "min_snr_db": 15,
      "max_clipped_ratio": 0.001,
      "min_edge_silence_ms": 100,
      "min_words_per_second": 1,
      "max_words_per_second": 4,
      "varie_sample_rate": 16000,
      "principale_min_sample_rate": 44100
    }', 'Seuils des vérifications serveur (spec §6.2)'),
  ('*', 'quotas', '{
      "femmes_min": 0.5,
      "plus_40_ans_min": 0.2,
      "hors_niamey_min": 0.3,
      "langue_maternelle_min": 0.7
    }', 'Quotas de diversité des voix (spec §5.6)'),
  ('*', 'double_review_ratio', '0.1', 'Part des audios validés de la semaine réécoutés par le responsable qualité'),
  ('*', 'alert_rejections', '{"max_rejets": 2, "sur": 10}', 'Alerte si une voix dépasse N rejets sur ses M derniers audios notés'),
  ('*', 'alert_waiting_days', '3', 'Alerte si un audio attend une vérification depuis plus de N jours');

-- Rattache une langue à une valeur de réglage pour la « langue maternelle » des quotas.
-- (Le formulaire de la voix enregistre des codes comme « zarma », « haoussa ».)
alter table public.languages add column mother_tongue_code text;
update public.languages set mother_tongue_code = 'zarma' where code = 'dje';

-- -----------------------------------------------------------------------------
-- File des tâches : fonctions du worker (rôle service uniquement)
-- -----------------------------------------------------------------------------

-- Prend jusqu'à N tâches prêtes. Une tâche « en cours » dont le worker a disparu
-- (réservation expirée) redevient prenable : rien ne reste bloqué.
create function public.worker_claim_jobs(
  p_worker text,
  p_kinds text[],
  p_limit integer default 20,
  p_lock_minutes integer default 10
) returns jsonb
language sql volatile security definer set search_path = '' as $$
  with ready as (
    select id from public.jobs
    where kind = any(p_kinds)
      and ((status = 'en_attente' and run_after <= now())
           or (status = 'en_cours' and locked_until < now()))
    order by run_after, id
    limit p_limit
    for update skip locked
  ),
  taken as (
    update public.jobs j set
      status = 'en_cours', locked_by = p_worker,
      locked_until = now() + make_interval(mins => p_lock_minutes),
      attempts = j.attempts + 1
    from ready where j.id = ready.id
    returning j.id, j.kind, j.payload, j.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'payload', payload,
                                               'attempts', attempts) order by id), '[]')
  from taken;
$$;

create function public.worker_job_done(p_job_id bigint) returns void
language sql volatile security definer set search_path = '' as $$
  update public.jobs set status = 'termine', finished_at = now(), locked_by = null,
    locked_until = null, last_error = null
  where id = p_job_id;
$$;

-- Échec : nouvelle tentative plus tard (2, 4, 8… minutes), ou « echec » après le maximum.
-- Le message ne doit contenir aucune donnée personnelle (le worker n'en manipule pas).
create function public.worker_job_failed(p_job_id bigint, p_error text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.jobs set
    status = case when attempts >= max_attempts then 'echec' else 'en_attente' end,
    run_after = now() + make_interval(mins => power(2, least(attempts, 10))::integer),
    locked_by = null, locked_until = null,
    last_error = left(p_error, 500)
  where id = p_job_id;
$$;

-- Ce que le worker doit savoir d'un enregistrement pour le vérifier.
create function public.worker_recording(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'cle', r.storage_key, 'type', r.kind, 'statut_envoi', r.upload_status,
    'mots', t.word_count, 'langue', s.language_code,
    'seuils', public.get_setting(s.language_code, 'server_checks'))
  from public.recordings r
  join public.speakers s on s.id = r.speaker_id
  join public.sentences t on t.id = r.sentence_id
  where r.id = p_recording_id;
$$;

-- Résultats des vérifications serveur (spec §6.2). Le doublon se vérifie ici : même
-- empreinte qu'un autre audio déjà reçu.
create function public.worker_save_checks(
  p_recording_id uuid,
  p_checks jsonb,
  p_sha256 text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_hash bytea := decode(p_sha256, 'hex');
  v_checks jsonb := p_checks;
  v_alerts jsonb := coalesce(p_checks->'alertes', '[]');
begin
  if exists (select 1 from public.recordings where sha256 = v_hash and id <> p_recording_id) then
    v_alerts := v_alerts || '["doublon"]';
  end if;
  v_checks := jsonb_set(v_checks, '{alertes}', v_alerts);
  update public.recordings set
    server_checks = v_checks,
    suspect = jsonb_array_length(v_alerts) > 0,
    sha256 = v_hash,
    checked_at = now()
  where id = p_recording_id;
  return v_checks;
end $$;

-- -----------------------------------------------------------------------------
-- Expiration des phrases attribuées non enregistrées (spec §7)
-- -----------------------------------------------------------------------------

create function public.expire_assignments() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with expired as (
    update public.assignments a set status = 'expiree'
    from public.speakers s
    where s.id = a.speaker_id and a.status = 'attribuee'
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
-- Double écoute (spec §5.5) : chaque semaine, 10 % des audios validés de la semaine
-- sont réécoutés « à l'aveugle » par le responsable qualité. Le taux de désaccord
-- mesure la fiabilité des vérifications.
-- -----------------------------------------------------------------------------

create table public.double_reviews (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  week date not null,
  first_reviewer_id uuid references public.team_members(user_id),
  first_decision text not null,
  reviewer_id uuid references public.team_members(user_id),
  decision text check (decision in ('valide', 'corrige', 'rejete')),
  agrees boolean,
  selected_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index double_reviews_pending_idx on public.double_reviews (selected_at) where reviewer_id is null;
alter table public.double_reviews enable row level security;
create policy quality_admin_read on public.double_reviews for select to authenticated
  using ((select acces.has_role('qualite')) or (select acces.has_role('admin')));
grant select on public.double_reviews to authenticated;
grant all on public.double_reviews to service_role;

create function public.sample_double_reviews(p_language text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ratio numeric := coalesce((public.get_setting(p_language, 'double_review_ratio'))::numeric, 0.1);
  v_count integer;
begin
  with candidates as (
    select r.id, r.reviewer_id, r.qc_status
    from public.recordings r join public.speakers s on s.id = r.speaker_id
    where s.language_code = p_language
      and r.qc_status in ('valide', 'corrige')
      and r.reviewed_at >= now() - interval '7 days'
      and not exists (select 1 from public.double_reviews d where d.recording_id = r.id)
  ),
  chosen as (
    select * from candidates order by random()
    limit (select ceil(count(*) * v_ratio)::integer from candidates)
  )
  insert into public.double_reviews (recording_id, week, first_reviewer_id, first_decision)
  select id, date_trunc('week', now())::date, reviewer_id, qc_status from chosen;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- File de la double écoute pour le responsable qualité : jamais ses propres décisions,
-- ni (sauf admin) ses propres recrues. La décision précédente n'est PAS montrée.
create function acces.double_review_claim(p_language text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_minutes integer := coalesce((public.get_setting(p_language, 'review_lock_minutes'))::integer, 5);
  v_id uuid;
begin
  if not (acces.has_role('qualite') or acces.has_role('admin')) then
    perform acces.fail('acces_refuse');
  end if;
  select d.recording_id into v_id
  from public.double_reviews d
  join public.recordings r on r.id = d.recording_id
  join public.speakers s on s.id = r.speaker_id
  where s.language_code = p_language and d.reviewer_id is null
    and r.locked_by = auth.uid() and r.locked_until > now()
  limit 1;
  if v_id is null then
    select d.recording_id into v_id
    from public.double_reviews d
    join public.recordings r on r.id = d.recording_id
    join public.speakers s on s.id = r.speaker_id
    where s.language_code = p_language and d.reviewer_id is null
      and d.first_reviewer_id is distinct from auth.uid()
      and acces.can_review_speaker(s.recruiter_id)
      and (r.locked_until is null or r.locked_until < now())
    order by d.selected_at
    limit 1
    for update of r skip locked;
    if v_id is null then
      return null;
    end if;
    update public.recordings
    set locked_by = auth.uid(), locked_until = now() + make_interval(mins => v_minutes)
    where id = v_id;
  end if;
  -- À l'aveugle : on retire les avis précédents.
  return acces.review_item(v_id) || jsonb_build_object('avis', '[]'::jsonb, 'double_ecoute', true);
end $$;

create function public.double_review_claim(p_language text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.double_review_claim(p_language);
$$;

-- Décision de double écoute. En cas de désaccord, la décision du responsable qualité
-- s'applique à l'audio (et les compteurs de lectures suivent).
create function acces.double_review_submit(
  p_recording_id uuid,
  p_decision text,
  p_corrected_text text default null,
  p_reject_reason text default null,
  p_comment text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_double public.double_reviews;
  v_rec public.recordings;
  v_corrected text := nullif(normalize(btrim(coalesce(p_corrected_text, '')), nfc), '');
  v_agrees boolean;
  v_was_accepted boolean;
  v_now_accepted boolean := p_decision in ('valide', 'corrige');
begin
  select * into v_double from public.double_reviews where recording_id = p_recording_id for update;
  select * into v_rec from public.recordings where id = p_recording_id for update;
  if v_double.recording_id is null or v_double.reviewer_id is not null then
    perform acces.fail('enregistrement_inconnu');
  elsif not (acces.has_role('qualite') or acces.has_role('admin'))
        or v_double.first_reviewer_id = auth.uid() then
    perform acces.fail('acces_refuse');
  elsif p_decision not in ('valide', 'corrige', 'rejete') then
    perform acces.fail('decision_inconnue');
  elsif p_decision = 'corrige' and v_corrected is null then
    perform acces.fail('texte_corrige_obligatoire');
  elsif p_decision = 'rejete' and p_reject_reason is null then
    perform acces.fail('motif_obligatoire');
  end if;

  v_agrees := p_decision = v_double.first_decision
    and (p_decision <> 'corrige' or v_corrected is not distinct from v_rec.corrected_text);
  update public.double_reviews set
    reviewer_id = auth.uid(), decision = p_decision, agrees = v_agrees, reviewed_at = now()
  where recording_id = p_recording_id;
  insert into public.reviews (recording_id, reviewer_id, kind, decision, corrected_text, reject_reason, comment)
  values (p_recording_id, auth.uid(), 'double', p_decision, v_corrected, p_reject_reason,
          nullif(btrim(coalesce(p_comment, '')), ''));

  v_was_accepted := v_rec.qc_status in ('valide', 'corrige');
  update public.recordings set
    qc_status = case when v_agrees then qc_status else p_decision end,
    corrected_text = case when v_agrees then corrected_text
                          when p_decision = 'corrige' then v_corrected end,
    reject_reason = case when v_agrees then reject_reason
                         when p_decision = 'rejete' then p_reject_reason end,
    locked_by = null, locked_until = null
  where id = p_recording_id;
  if v_was_accepted and not v_now_accepted then
    update public.sentences set validated_reads = greatest(validated_reads - 1, 0)
    where id = v_rec.sentence_id;
  end if;

  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'double_ecoute', 'recording', p_recording_id::text,
          jsonb_build_object('accord', v_agrees));
  return v_agrees;
end $$;

create function public.double_review_submit(
  p_recording_id uuid,
  p_decision text,
  p_corrected_text text default null,
  p_reject_reason text default null,
  p_comment text default null
) returns boolean language sql volatile security invoker set search_path = '' as $$
  select acces.double_review_submit(p_recording_id, p_decision, p_corrected_text, p_reject_reason, p_comment);
$$;

-- -----------------------------------------------------------------------------
-- Tableau de bord (spec §5.1) : calculé périodiquement et gardé dans une table, pour
-- qu'afficher l'accueil ne lance jamais de requête lourde (spec §8.1, principe 5).
-- -----------------------------------------------------------------------------

create table public.dashboard_snapshots (
  language_code text primary key references public.languages(code),
  data jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.dashboard_snapshots enable row level security;
create policy team_read on public.dashboard_snapshots for select to authenticated
  using ((select acces.is_team_member()));
grant select on public.dashboard_snapshots to authenticated;
grant all on public.dashboard_snapshots to service_role;

create function public.compute_dashboard(p_language text) returns jsonb
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
  alert_cfg as (select public.get_setting(p_language, 'alert_rejections') as cfg)
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
      'enregistrees', round((select coalesce(sum(duration_ms), 0) from recs where kind = 'varie') / 3600000.0, 2),
      'validees', round((select coalesce(sum(duration_ms), 0) from recs
                         where kind = 'varie' and qc_status in ('valide', 'corrige')) / 3600000.0, 2)),
    'par_semaine', (
      select coalesce(jsonb_agg(w order by w->>'semaine'), '[]') from (
        select jsonb_build_object(
          'semaine', to_char(date_trunc('week', received_at), 'YYYY-MM-DD'),
          'enregistrees', round(sum(duration_ms) / 3600000.0, 3),
          'validees', round(coalesce(sum(duration_ms) filter (where qc_status in ('valide', 'corrige')), 0) / 3600000.0, 3)) as w
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
        select jsonb_build_object('nombre', count(*), 'plus_ancien', min(received_at))
        from recs where qc_status = 'a_verifier'
          and received_at < now() - make_interval(
            days => coalesce((public.get_setting(p_language, 'alert_waiting_days'))::integer, 3)))),
    'double_ecoute', (
      select jsonb_build_object(
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

create function public.refresh_dashboard(p_language text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.dashboard_snapshots (language_code, data, computed_at)
  values (p_language, public.compute_dashboard(p_language), now())
  on conflict (language_code) do update set data = excluded.data, computed_at = excluded.computed_at;
$$;

-- Bouton « Recalculer maintenant » de l'accueil (membres de l'équipe).
create function acces.refresh_dashboard_now(p_language text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not acces.is_team_member() then
    perform acces.fail('acces_refuse');
  end if;
  perform public.refresh_dashboard(p_language);
end $$;

create function public.refresh_dashboard_now(p_language text) returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.refresh_dashboard_now(p_language);
$$;

-- Tâches périodiques, pour toutes les langues actives.
create function public.run_periodic(p_task text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_language text;
begin
  for v_language in select code from public.languages where active loop
    if p_task = 'tableau_de_bord' then
      perform public.refresh_dashboard(v_language);
    elsif p_task = 'double_ecoute' then
      perform public.sample_double_reviews(v_language);
    end if;
  end loop;
  if p_task = 'expiration' then
    perform public.expire_assignments();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  -- Réservé au worker, aux tâches planifiées et à l'API (service_role).
  foreach f in array array[
    'public.worker_claim_jobs(text, text[], integer, integer)', 'public.worker_job_done(bigint)',
    'public.worker_job_failed(bigint, text)', 'public.worker_recording(uuid)',
    'public.worker_save_checks(uuid, jsonb, text)', 'public.expire_assignments()',
    'public.sample_double_reviews(text)', 'public.compute_dashboard(text)',
    'public.refresh_dashboard(text)', 'public.run_periodic(text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Appelables par l'espace équipe (l'implémentation vérifie les rôles).
  foreach f in array array[
    'acces.double_review_claim(text)', 'public.double_review_claim(text)',
    'acces.double_review_submit(uuid, text, text, text, text)',
    'public.double_review_submit(uuid, text, text, text, text)',
    'acces.refresh_dashboard_now(text)', 'public.refresh_dashboard_now(text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Planification avec pg_cron (disponible sur Supabase ; absent des tests locaux)
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Tableau de bord toutes les 10 minutes.
    perform cron.schedule('murya-tableau-de-bord', '*/10 * * * *',
                          $job$select public.run_periodic('tableau_de_bord')$job$);
    -- Phrases attribuées depuis trop longtemps : chaque nuit à 2 h (heure UTC).
    perform cron.schedule('murya-expiration', '0 2 * * *',
                          $job$select public.run_periodic('expiration')$job$);
    -- Double écoute : chaque lundi à 3 h.
    perform cron.schedule('murya-double-ecoute', '0 3 * * 1',
                          $job$select public.run_periodic('double_ecoute')$job$);
  end if;
end $$;
