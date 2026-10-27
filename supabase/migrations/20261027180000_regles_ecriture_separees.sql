-- =============================================================================
-- Sépare les règles d'écriture des règles de lecture.
--
-- Le contrôle de performance de Supabase signalait deux règles RLS de lecture sur les
-- mêmes tables (« team_read » et « admin_write », écrite « for all »), donc évaluées
-- deux fois à chaque lecture. On remplace chaque règle « for all » par trois règles
-- (ajout, modification, suppression) ; la lecture reste couverte par « team_read ».
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['languages', 'settings', 'team_members', 'consent_versions', 'sentences']
  loop
    execute format('drop policy admin_write on public.%I', t);
    execute format(
      'create policy admin_insert on public.%I for insert to authenticated
         with check ((select acces.has_role(''admin'')))', t);
    execute format(
      'create policy admin_update on public.%I for update to authenticated
         using ((select acces.has_role(''admin''))) with check ((select acces.has_role(''admin'')))', t);
    execute format(
      'create policy admin_delete on public.%I for delete to authenticated
         using ((select acces.has_role(''admin'')))', t);
  end loop;
end $$;

-- Liste des mots décidés : responsable qualité ou admin.
drop policy quality_write on public.orthography_decisions;
create policy quality_insert on public.orthography_decisions for insert to authenticated
  with check ((select acces.has_role('qualite')) or (select acces.has_role('admin')));
create policy quality_update on public.orthography_decisions for update to authenticated
  using ((select acces.has_role('qualite')) or (select acces.has_role('admin')))
  with check ((select acces.has_role('qualite')) or (select acces.has_role('admin')));
create policy quality_delete on public.orthography_decisions for delete to authenticated
  using ((select acces.has_role('qualite')) or (select acces.has_role('admin')));
