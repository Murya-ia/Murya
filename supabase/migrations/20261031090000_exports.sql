-- =============================================================================
-- J6b — Exports (spec §5.9) : partition d'examen et versions d'export.
--
--   - Un admin désigne des voix « examen » (Murya en propose 10 %, réparties par sexe, âge et
--     région). Tous leurs audios vont dans la partie `test`, jamais dans `train`.
--   - Dès qu'une voix est passée dans un export terminé, sa partie est figée : une voix
--     d'entraînement ne devient jamais examen (le modèle l'a déjà entendue), et inversement.
--   - Un admin lance un export (langue + type) ; le worker Python le construit (fichiers dans
--     R2 et dépôt privé Hugging Face) et rend compte. Les identités n'y figurent jamais.
-- =============================================================================

alter table public.speakers add column partition_fixed_at timestamptz;

create table public.exports (
  id bigint generated always as identity primary key,
  language_code text not null references public.languages(code),
  kind text not null check (kind in ('varie', 'principale')),
  version integer not null check (version > 0),
  status text not null default 'en_attente' check (status in (
    'en_attente', 'en_cours', 'pret', 'echec'
  )),
  requested_by uuid not null references public.team_members(user_id),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Chiffres de la version (heures, audios, voix, répartition) : aucune donnée personnelle.
  stats jsonb,
  -- Dossier de l'export dans le bucket des exports (ex. dje/varie/v003).
  location text,
  -- Dépôt Hugging Face et étiquette de la version (ex. murya-ai/murya-dje-varie@v003).
  hf_repo text,
  error text,
  unique (language_code, kind, version)
);

alter table public.exports enable row level security;
create policy exports_admin on public.exports for select to authenticated
  using (acces.has_role('admin'));
grant select on public.exports to authenticated;
grant all on public.exports to service_role;

-- Voix qui peuvent entrer dans un export : leur parcours est terminé ou en cours (test réussi).
create function acces.exportable_speaker(p_status text) returns boolean
language sql immutable set search_path = '' as $$
  select p_status in ('active', 'terminee');
$$;

-- -----------------------------------------------------------------------------
-- Partition d'examen
-- -----------------------------------------------------------------------------

-- Vue d'ensemble pour l'admin : voix examen actuelles et proposition pour atteindre 10 %.
-- La proposition est un tirage stratifié (sexe × âge × région) : dans chaque groupe, les voix
-- sont classées par un ordre pseudo-aléatoire STABLE (empreinte de l'identifiant), puis on
-- prend les voix dont le rang relatif dans leur groupe est le plus petit. Chaque groupe est
-- ainsi représenté en proportion de sa taille, et la proposition ne change pas d'un
-- affichage à l'autre.
create function acces.exam_overview(p_language text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_eligible integer;
  v_exam integer;
  v_target integer;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  select count(*), count(*) filter (where is_exam) into v_eligible, v_exam
  from public.speakers
  where language_code = p_language and acces.exportable_speaker(status);
  v_target := ceil(v_eligible * 0.10);

  return jsonb_build_object(
    'voix_eligibles', v_eligible,
    'cible', v_target,
    'examen', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'numero', s.number, 'sexe', s.gender, 'age', s.age_range,
        'region', s.region, 'figee', s.partition_fixed_at is not null) order by s.number)
      from public.speakers s
      where s.language_code = p_language and s.is_exam
    ), '[]'),
    'proposition', coalesce((
      with candidates as (
        select s.*,
          (row_number() over w - 0.5) / count(*) over (partition by s.gender, s.age_range, s.region)
            as rang
        from public.speakers s
        where s.language_code = p_language and acces.exportable_speaker(s.status)
          and not s.is_exam and s.partition_fixed_at is null
        window w as (partition by s.gender, s.age_range, s.region order by md5(s.id::text))
      ), chosen as (
        select * from candidates order by rang, md5(id::text)
        limit greatest(v_target - v_exam, 0)
      )
      select jsonb_agg(jsonb_build_object(
        'id', id, 'numero', number, 'sexe', gender, 'age', age_range, 'region', region)
        order by number)
      from chosen
    ), '[]')
  );
end $$;

create function public.exam_overview(p_language text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select acces.exam_overview(p_language);
$$;

-- Ajoute ou retire des voix examen. Une voix déjà passée dans un export garde sa partie.
create function acces.set_exam_speakers(
  p_language text,
  p_add uuid[],
  p_remove uuid[]
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_added text[];
  v_removed text[];
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if exists (
    select 1 from public.speakers
    where language_code = p_language and partition_fixed_at is not null
      and (id = any(coalesce(p_add, '{}')) or id = any(coalesce(p_remove, '{}')))
  ) then
    perform acces.fail('partition_figee');
  end if;

  with changed as (
    update public.speakers set is_exam = true
    where language_code = p_language and id = any(coalesce(p_add, '{}')) and not is_exam
      and acces.exportable_speaker(status)
    returning number
  )
  select array_agg(number order by number) into v_added from changed;

  with changed as (
    update public.speakers set is_exam = false
    where language_code = p_language and id = any(coalesce(p_remove, '{}')) and is_exam
    returning number
  )
  select array_agg(number order by number) into v_removed from changed;

  if v_added is not null or v_removed is not null then
    insert into public.audit_log (actor_id, actor_kind, action, details)
    values (auth.uid(), 'equipe', 'voix_examen', jsonb_build_object(
      'langue', p_language,
      'ajoutees', coalesce(to_jsonb(v_added), '[]'),
      'retirees', coalesce(to_jsonb(v_removed), '[]')));
  end if;
end $$;

create function public.set_exam_speakers(p_language text, p_add uuid[], p_remove uuid[])
returns void
language sql volatile security invoker set search_path = '' as $$
  select acces.set_exam_speakers(p_language, p_add, p_remove);
$$;

-- -----------------------------------------------------------------------------
-- Demande d'export
-- -----------------------------------------------------------------------------

-- Un seul export à la fois par langue et par type (le worker en construit un à la fois).
create function acces.request_export(p_language text, p_kind text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_export public.exports;
begin
  if not acces.has_role('admin') then
    perform acces.fail('acces_refuse');
  end if;
  if p_kind not in ('varie', 'principale') then
    perform acces.fail('requete_invalide');
  end if;
  -- Verrou : deux admins qui cliquent en même temps n'obtiennent pas deux versions.
  perform 1 from public.languages where code = p_language for update;
  if exists (
    select 1 from public.exports
    where language_code = p_language and kind = p_kind and status in ('en_attente', 'en_cours')
  ) then
    perform acces.fail('export_en_cours');
  end if;

  insert into public.exports (language_code, kind, version, requested_by)
  values (p_language, p_kind, coalesce((
    select max(version) from public.exports where language_code = p_language and kind = p_kind
  ), 0) + 1, auth.uid())
  returning * into v_export;

  -- Une seule tentative : en cas d'échec, l'admin relance (nouvelle version).
  insert into public.jobs (kind, payload, max_attempts)
  values ('exporter', jsonb_build_object('export_id', v_export.id), 1);

  insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
  values (auth.uid(), 'equipe', 'export_demande', 'export', v_export.id::text,
          jsonb_build_object('langue', p_language, 'type', p_kind, 'version', v_export.version));
  return to_jsonb(v_export);
end $$;

create function public.request_export(p_language text, p_kind text) returns jsonb
language sql volatile security invoker set search_path = '' as $$
  select acces.request_export(p_language, p_kind);
$$;

-- Dossier d'un export prêt, pour que l'API serve ses fichiers (admins seulement).
-- Chaque téléchargement est noté au journal.
create function acces.export_location(p_export_id bigint, p_file text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_location text;
begin
  if not acces.has_role('admin') then
    return null;
  end if;
  select location into v_location from public.exports
  where id = p_export_id and status = 'pret';
  if v_location is not null then
    insert into public.audit_log (actor_id, actor_kind, action, target_type, target_id, details)
    values (auth.uid(), 'equipe', 'export_telecharge', 'export', p_export_id::text,
            jsonb_build_object('fichier', p_file));
  end if;
  return v_location;
end $$;

create function public.export_location(p_export_id bigint, p_file text) returns text
language sql volatile security invoker set search_path = '' as $$
  select acces.export_location(p_export_id, p_file);
$$;

-- -----------------------------------------------------------------------------
-- Construction par le worker (rôle service uniquement)
-- -----------------------------------------------------------------------------

-- Démarre un export : renvoie tout ce qu'il faut pour le construire. Les audios retenus sont
-- les audios reçus et validés (ou corrigés : on donne alors le texte corrigé) des voix
-- exportables. Jamais de nom ni de contact : la voix n'est connue que par son numéro.
create function public.worker_export_start(p_export_id bigint) returns jsonb
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
        'partition', case when s.is_exam then 'test' else 'train' end
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

-- Export terminé : chiffres, emplacements, et partie figée pour chaque voix exportée.
create function public.worker_export_done(
  p_export_id bigint,
  p_stats jsonb,
  p_location text,
  p_hf_repo text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_export public.exports;
begin
  update public.exports set
    status = 'pret', finished_at = now(), stats = p_stats, location = p_location,
    hf_repo = p_hf_repo, error = null
  where id = p_export_id
  returning * into v_export;
  if v_export is null then
    return;
  end if;

  update public.speakers set partition_fixed_at = now()
  where language_code = v_export.language_code and partition_fixed_at is null
    and number in (
      select jsonb_array_elements_text(coalesce(p_stats->'voix_liste', '[]'))
    );

  insert into public.audit_log (actor_kind, action, target_type, target_id, details)
  values ('systeme', 'export_termine', 'export', p_export_id::text, jsonb_build_object(
    'langue', v_export.language_code, 'type', v_export.kind, 'version', v_export.version,
    'audios', p_stats->'audios', 'heures', p_stats->'heures'));
end $$;

create function public.worker_export_failed(p_export_id bigint, p_error text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.exports set status = 'echec', finished_at = now(), error = left(p_error, 500)
  where id = p_export_id;
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

revoke execute on function acces.exportable_speaker(text) from public, anon;
grant execute on function acces.exportable_speaker(text) to authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.worker_export_start(bigint)',
    'public.worker_export_done(bigint, jsonb, text, text)',
    'public.worker_export_failed(bigint, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'acces.exam_overview(text)', 'public.exam_overview(text)',
    'acces.set_exam_speakers(text, uuid[], uuid[])', 'public.set_exam_speakers(text, uuid[], uuid[])',
    'acces.request_export(text, text)', 'public.request_export(text, text)',
    'acces.export_location(bigint, text)', 'public.export_location(bigint, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
