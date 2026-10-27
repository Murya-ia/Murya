-- =============================================================================
-- Droits explicites pour l'API Supabase.
--
-- Les projets sont créés avec « Automatically expose new tables » DÉSACTIVÉ
-- (recommandation de Supabase) : aucune table n'est accessible par l'API tant
-- qu'on ne l'autorise pas ici. Ensuite, la RLS décide quelles LIGNES chacun voit.
--
-- Règle pour les prochaines migrations : toute nouvelle table doit recevoir ici
-- (ou dans sa propre migration) ses droits explicites.
-- =============================================================================

grant usage on schema public to authenticated, service_role;

-- Lecture pour les membres connectés de l'équipe (la RLS filtre les lignes).
grant select on
  public.languages,
  public.settings,
  public.team_members,
  public.consent_versions,
  public.invites,
  public.speakers,
  public.consents,
  public.sentences,
  public.sentence_versions,
  public.assignments,
  public.sentence_flags,
  public.orthography_decisions,
  public.recordings,
  public.reviews,
  public.jobs,
  public.audit_log,
  public.withdrawals
to authenticated;

-- Écriture directe seulement sur les référentiels administrés (la RLS la réserve aux
-- admins, ou au responsable qualité pour l'orthographe). Tout le reste passera par des
-- fonctions SQL.
grant insert, update, delete on
  public.languages,
  public.settings,
  public.team_members,
  public.consent_versions,
  public.sentences,
  public.orthography_decisions
to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Rôle « service » : utilisé uniquement par l'API et le worker, jamais dans un navigateur.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
