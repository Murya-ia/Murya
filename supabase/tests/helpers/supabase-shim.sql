-- Imitation minimale de ce que Supabase fournit déjà en production, pour exécuter
-- les migrations et les tests dans PGlite (Postgres en mémoire, sans Docker).
-- Ce fichier n'est JAMAIS appliqué sur un vrai projet Supabase.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
-- Comme nos projets Supabase (« Automatically expose new tables » désactivé) : AUCUN droit
-- automatique sur les tables. Les tests vérifient donc que les migrations donnent elles-mêmes
-- tous les droits nécessaires. Les fonctions gardent le comportement par défaut de Postgres.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  last_sign_in_at timestamptz
);

-- Même définition que dans Supabase : l'identifiant de l'utilisateur vient du jeton JWT,
-- placé par l'API dans le paramètre de session `request.jwt.claims`.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
