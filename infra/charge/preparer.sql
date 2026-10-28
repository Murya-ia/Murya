-- Essai de charge (spec §9) : prépare des voix d'essai, prêtes à enregistrer.
--
-- Tout se passe dans une langue à part, « zz » (inactive, invisible pour l'équipe) : les vraies
-- voix, phrases, quotas et exports ne sont jamais touchés. Les voix passent par les vraies
-- fonctions du parcours (accord, fiche, tutoriel) ; seul le test d'entrée est sauté.
-- Les jetons sont écrits dans jetons.txt, sur la machine de l'essai uniquement.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -v n=500 -f preparer.sql

select set_config('charge.n', :'n', false);

insert into public.languages (code, name_fr, active)
values ('zz', 'Essai de charge', false)
on conflict (code) do nothing;

insert into public.consent_versions (language_code, version, texts, published_at)
select 'zz', 1, '{"fr": {"intro": "Accord d''essai (essai de charge)."}}', now() - interval '1 minute'
where not exists (select 1 from public.consent_versions where language_code = 'zz');

insert into public.sentences (language_code, code, text)
select 'zz', format('C%s', lpad(i::text, 4, '0')), format('Phrase d''essai numéro %s.', i)
from generate_series(1, 300) i
on conflict (language_code, code) do nothing;

-- Lots de 100 phrases : assez pour toute la durée de l'essai.
insert into public.settings (scope, key, value, description)
values ('zz', 'batch_size', '100', 'Essai de charge')
on conflict (scope, key) do nothing;

create temp table charge_jetons (jeton text not null);

do $$
declare
  v_admin uuid;
  v_consent public.consent_versions := public.current_consent('zz');
  v_token text;
  v_hash text;
begin
  select user_id into v_admin from public.team_members
  where 'admin' = any(roles) order by created_at limit 1;
  for i in 1..current_setting('charge.n')::integer loop
    -- Même fabrication de jeton que create_invite.
    v_token := rtrim(translate(encode(
      uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '=');
    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
    insert into public.invites (token_hash, language_code, recruiter_id, label, expires_at)
    values (decode(v_hash, 'hex'), 'zz', v_admin, format('Essai de charge %s', i),
            now() + interval '1 day');
    perform public.voice_consent(v_hash, v_consent.id, v_consent.points, 'fr',
                                 format('Essai de charge %s', i), null);
    perform public.voice_profile(v_hash, 'femme', '26-40', 'Niamey', 'zarma', 'essai de charge');
    perform public.voice_tutorial_done(v_hash);
    insert into charge_jetons values (v_token);
  end loop;
  -- Test d'entrée sauté : les voix enregistrent directement leur lot.
  update public.speakers set status = 'active', test_reviewed_at = now()
  where language_code = 'zz' and status = 'inscrite';
end $$;

\copy charge_jetons to 'jetons.txt'
select count(*) as voix_pretes from public.speakers where language_code = 'zz' and status = 'active';
