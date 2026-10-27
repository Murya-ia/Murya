-- =============================================================================
-- Données de DÉMONSTRATION pour le projet STAGING uniquement (jamais en production).
-- Permettent de tester le parcours des voix avant d'avoir le vrai texte de consentement
-- (relu par un juriste) et les vraies phrases zarma.
--
-- Appliquer :  npx supabase db query --linked -f supabase/seeds/staging-demo.sql
-- (sans effet si déjà appliqué)
-- =============================================================================

-- Consentement v1 : BROUILLON à remplacer par le texte validé (nouvelle version).
insert into public.consent_versions (language_code, version, texts, published_at)
select 'dje', 1, '{
  "fr": {
    "intro": "[BROUILLON DE TEST — texte à faire relire par un juriste] Murya construit une intelligence artificielle qui comprend et parle le zarma. Pour cela, nous enregistrons des personnes qui lisent des phrases à voix haute. Votre nom est gardé à part : il n''est jamais lié à votre voix. Vous pouvez demander à retirer votre voix à tout moment.",
    "points": {
      "enregistrement": "J''accepte que ma voix soit enregistrée pendant que je lis des phrases.",
      "entrainement_ia": "J''accepte que mes enregistrements servent à entraîner et à tester des modèles d''intelligence artificielle.",
      "usage_commercial": "J''accepte que mes enregistrements soient utilisés commercialement et partagés avec des partenaires de recherche.",
      "metadonnees": "J''accepte que mon sexe, ma tranche d''âge, ma région et ma langue maternelle soient conservés, sans lien avec mon nom.",
      "majeur": "Je confirme avoir 18 ans ou plus."
    }
  }
}'::jsonb, now()
where not exists (select 1 from public.consent_versions where language_code = 'dje');

-- 5 phrases de test et 10 phrases de démonstration (en français, faute de phrases zarma).
insert into public.sentences (language_code, code, text, translation_fr, theme, is_test)
values
  ('dje', 'TEST01', 'Bonjour, je m''appelle comme ma grand-mère.', null, 'demo', true),
  ('dje', 'TEST02', 'Le marché de Niamey ouvre tôt le matin.', null, 'demo', true),
  ('dje', 'TEST03', 'Il a plu toute la nuit sur le fleuve.', null, 'demo', true),
  ('dje', 'TEST04', 'Mon frère vend du mil et du riz.', null, 'demo', true),
  ('dje', 'TEST05', 'Nous irons au village la semaine prochaine.', null, 'demo', true),
  ('dje', 'DEMO01', 'Le soleil se couche derrière les arbres.', null, 'demo', false),
  ('dje', 'DEMO02', 'La radio annonce la météo de demain.', null, 'demo', false),
  ('dje', 'DEMO03', 'Les enfants jouent devant la maison.', null, 'demo', false),
  ('dje', 'DEMO04', 'Combien coûte un sac de mil aujourd''hui ?', null, 'demo', false),
  ('dje', 'DEMO05', 'Ma mère prépare le repas pour toute la famille.', null, 'demo', false),
  ('dje', 'DEMO06', 'Le bus pour Dosso part à huit heures.', null, 'demo', false),
  ('dje', 'DEMO07', 'Il faut boire beaucoup d''eau quand il fait chaud.', null, 'demo', false),
  ('dje', 'DEMO08', 'Le médecin arrive au dispensaire à midi.', null, 'demo', false),
  ('dje', 'DEMO09', 'Les pêcheurs rentrent avec beaucoup de poissons.', null, 'demo', false),
  ('dje', 'DEMO10', 'Merci beaucoup, à demain si Dieu le veut.', null, 'demo', false)
on conflict (language_code, code) do nothing;
