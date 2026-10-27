-- =============================================================================
-- Sort les fonctions de contrôle d'accès de la partie exposée par l'API.
--
-- Le contrôle de sécurité de Supabase signalait que `has_role` et `is_team_member`
-- (SECURITY DEFINER) étaient appelables directement via /rest/v1/rpc. On les déplace
-- dans le schéma `acces`, que l'API n'expose pas. Les règles RLS continuent de
-- fonctionner sans changement : Postgres les relie aux fonctions elles-mêmes, pas à
-- leur nom.
-- =============================================================================

create schema if not exists acces;
revoke all on schema acces from public, anon;
-- Les règles RLS sont évaluées avec le rôle de la personne connectée : il doit pouvoir
-- utiliser le schéma et exécuter ces fonctions (mais l'API ne les publie pas).
grant usage on schema acces to authenticated, service_role;

alter function public.is_team_member() set schema acces;
alter function public.has_role(text) set schema acces;

revoke execute on function acces.is_team_member() from public, anon;
revoke execute on function acces.has_role(text) from public, anon;
grant execute on function acces.is_team_member() to authenticated, service_role;
grant execute on function acces.has_role(text) to authenticated, service_role;
