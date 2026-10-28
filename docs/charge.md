# Essai de charge

Spec §9 : « test de charge simulant au moins 2 000 utilisateurs simultanés et 50 envois d'audio
par seconde, avant le lancement ». L'essai simule des voix qui ouvrent l'app puis enregistrent
leurs phrases, exactement comme un téléphone : session, lot, puis pour chaque phrase
_préparer l'envoi → déposer l'audio dans R2 → confirmer_.

## Ce qui est en place

- `infra/charge/preparer.sql` : crée N voix d'essai dans une **langue à part, « zz »**
  (inactive, invisible pour l'équipe, jamais dans les quotas ni les exports). Elles passent par
  les vraies fonctions (accord, fiche, tutoriel) ; seul le test d'entrée est sauté.
- `infra/charge/voix.js` : le scénario k6 (montée en 2 min, palier, descente en 1 min ; une
  phrase toutes les 6 à 10 s par voix ; audio WAV de 3 s).
- `infra/charge/nettoyer.sql` : efface les voix d'essai et tout ce qu'elles ont produit en base.
  Les fichiers `zz/` du bucket audio s'effacent seuls après un jour (règle « essai-de-charge »),
  et les sauvegardes les ignorent.
- Workflow GitHub **« Essai de charge »** (à lancer à la main) : prépare, simule, résume, nettoie.

## Lancer un essai

1. **Lever la limite par adresse IP** de l'API pour une heure (tout l'essai part d'une seule
   machine). La limite par lien de voix reste active. Depuis `api/` :

   ```bash
   npx wrangler deploy --env staging --var CHARGE_JUSQUA:2026-11-03T15:00:00Z
   ```

   (heure de fin en temps universel ; passé cette heure, la limite revient d'elle-même).

2. GitHub > _Actions_ > **Essai de charge** > _Run workflow_ : nombre de voix et durée du palier.
3. Lire le résumé (audios par seconde, erreurs, temps de réponse par étape).
4. **Remettre l'API normale** : `npx wrangler deploy --env staging` (sans `--var`).

## Limites du gratuit

Le palier gratuit de Cloudflare Workers s'arrête à **100 000 appels par jour**. Un essai à
500 voix pendant 5 minutes en fait environ 50 000 : un seul essai par jour. L'essai complet à
2 000 voix demande la formule payante (5 $ par mois), à prendre avant la campagne de
recrutement de toute façon.

## Résultats

| Date       | Voix | Palier | Audios/s | Erreurs                 | Temps de réponse (95 %)                       | Conclusion                                                                 |
| ---------- | ---- | ------ | -------- | ----------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| 28/10/2026 | 20   | 1 min  | 1,3      | 0,1 % (1 dépôt R2)      | —                                             | rodage : les scripts marchent                                              |
| 28/10/2026 | 500  | 5 min  | **14**   | **0 %** (21 829 appels) | préparer 13 s, confirmer 22,6 s, dépôt R2 1 s | aucun audio perdu, mais trop lent : objectif 50/s non atteint              |
| 28/10/2026 | 500  | 5 min  | **14**   | 0,5 %                   | préparer 33 s, confirmer 33 s                 | après optimisation (confirmation en 1 appel au lieu de 2) : aucun gain     |
| 28/10/2026 | 500  | 3 min  | **6**    | 2 %                     | —                                             | diagnostic **directement contre Supabase**, sans l'API : encore moins bien |

Analyse du 28/10/2026 : les requêtes SQL elles-mêmes restent rapides (2 à 3 ms en moyenne,
tableau « Query Performance » de Supabase) ; c'est l'entrée de Supabase (petite machine
partagée du palier gratuit, mémoire proche de sa limite) qui fait la queue. Pistes : moins
d'appels à Supabase par audio (la confirmation en fait deux), puis une machine Supabase plus
grande si cela ne suffit pas.

Conclusion après optimisation et diagnostic : retirer un appel par audio n'a rien changé, et
Supabase seul (sans l'API) fait encore moins bien. **La limite est la machine Supabase gratuite**
(entrée et petite machine partagée), pas notre code ni Cloudflare. Pour atteindre 50 audios par
seconde : formule Supabase payante avec une machine plus grande, puis refaire l'essai.
