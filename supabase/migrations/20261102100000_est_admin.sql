-- « La personne connectée est-elle admin ? », appelable par l'API (page « Membres ») :
-- `has_role` vit dans le schéma `acces`, que l'API n'expose pas. Petite fonction publique
-- qui s'exécute avec les droits de la personne connectée.
create function public.is_admin() returns boolean
language sql stable security invoker set search_path = '' as $$
  select acces.has_role('admin');
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
