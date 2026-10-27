# Architecture de Murya Collecte

> Version validée le 27/10/2026. Toute modification importante de ce document passe par une
> discussion d'équipe. Le cahier des charges complet est dans [`MURYA_SPEC.md`](../MURYA_SPEC.md).

## Vue d'ensemble

```
TÉLÉPHONE DE LA VOIX (PWA)
  ├─ interface (cache hors ligne) ← Cloudflare Pages (CDN, fichiers statiques)
  ├─ petites requêtes JSON + jeton → API (Cloudflare Worker) ──RPC──→ Supabase Postgres
  └─ fichier WAV, envoi direct    → R2 privé (URL signée 10 min, ne passe pas par l'API)

PC DE L'ÉQUIPE (app équipe)
  ├─ interface                    ← Cloudflare Pages
  ├─ données                      → Supabase directement (connexion e-mail + RLS)
  └─ écoute des audios            ← R2 (URL de lecture signée par l'API, 15 min)

WORKER PYTHON (Docker, 1 à N exemplaires)
  lit la table jobs (Postgres) → vérifs audio · exports · sauvegardes · retraits · Hugging Face
```

| Brique                     | Choix                                                | Pourquoi                                                                                                                         |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| App voix (`apps/voix`)     | Vite + React + TypeScript, PWA, **sans** supabase-js | Budget < 120 Ko compressés vérifié en CI (`npm run budget`). Si React ne tient pas le budget : Preact (même code).               |
| App équipe (`apps/equipe`) | Vite + React + TS + supabase-js                      | Sur ordinateur, peut être plus lourde. La voix ne télécharge jamais son code.                                                    |
| API (`api/`)               | Cloudflare Worker (TS, routeur Hono)                 | Sans état. 4 rôles : vérifier le jeton, limiter le débit, signer les URL R2, appeler les fonctions SQL.                          |
| Base (`supabase/`)         | Supabase Postgres                                    | Logique sensible dans des **fonctions SQL transactionnelles**. RLS sur toutes les tables. `pg_cron` pour les tâches périodiques. |
| Audios                     | R2, buckets privés `audio`, `identites`, `exports`   | Sortie gratuite. Consentements oraux isolés dans leur propre bucket.                                                             |
| File de tâches             | table `jobs` + `FOR UPDATE SKIP LOCKED`              | Lisible, visible dans Supabase, plusieurs workers possibles.                                                                     |
| Worker (`worker/`, J4)     | Python, `soundfile` + `numpy`, Docker                | Même image partout. Hébergé sur GitHub Actions (dépôt public = gratuit).                                                         |

### Pourquoi l'API entre la voix et Supabase ?

La voix n'a pas de compte. L'API transforme le jeton en « qui est cette voix », applique la limite
de débit et détient les clés R2. Les fonctions SQL des voix reçoivent le **hash du jeton**, pas
l'identifiant de la voix : même un bug dans l'API ne peut pas agir pour une autre voix.

## Mécanismes clés

### Envoi d'un audio sans perte ni doublon

1. « Valider » : WAV + UUID écrits dans IndexedDB, la phrase suivante s'affiche tout de suite.
2. La file d'envoi appelle `preparer_envoi(uuid)` : le serveur crée la ligne `recordings`
   (`upload_status = en_envoi`), fixe le numéro de prise, renvoie une URL signée.
   Même UUID rappelé = même réponse.
3. `PUT` du WAV directement vers R2.
4. `confirmer_envoi(uuid)` : l'API vérifie que le fichier est là, la fonction SQL passe la ligne à
   `recu` **et** crée la tâche de vérification dans la même transaction.
5. Seulement ensuite : suppression du téléphone. Coupure à n'importe quelle étape = reprise à l'étape 2.

Le lot de phrases est gardé dans le téléphone : on peut enregistrer sans réseau.

### Attribution des lots

`attribuer_lot` prend les phrases les moins lues (validées + en cours), jamais déjà lues par
cette voix, avec `FOR UPDATE SKIP LOCKED` : 200 voix qui demandent un lot à la même seconde
prennent des phrases différentes au lieu de s'attendre. `pg_cron` libère chaque nuit les phrases
attribuées depuis plus de X jours sans enregistrement.

### File d'écoute

`prendre_audio_a_ecouter()` réserve un audio 5 minutes, en excluant les voix recrutées par le
vérificateur. Suspects d'abord, puis par ancienneté.

## Sécurité et données personnelles

- `identities` est dans le schéma `prive`, **non exposé** par l'API Supabase. Lecture par une
  fonction réservée aux admins qui écrit dans le journal à chaque accès.
- Les inscriptions libres sont désactivées dans Supabase Auth : un admin crée les comptes équipe.
  Un compte connecté qui n'est pas dans `team_members` ne voit rien (RLS).
- Jetons d'invitation : 32 octets aléatoires, stockés en SHA-256. L'app retire le jeton de la barre
  d'adresse après la première ouverture. `Referrer-Policy: no-referrer`, aucun service tiers sur
  l'app voix, jeton masqué avant envoi à Sentry.
- Limite de débit principale **par jeton** ; limite par IP large (au Niger, beaucoup d'abonnés
  d'un même opérateur partagent une IP).
- Sauvegarde hebdomadaire vers Backblaze B2, rotation 4 semaines : une voix retirée disparaît
  des sauvegardes au plus tard 4 semaines après.

## Multilingue

Tout porte un `language_code`. Les phrases ont une clé unique `(language_code, code)`. Textes
d'interface en fichiers JSON par langue ; consentements, vidéos, seuils et quotas en base.
Tous les textes de phrases sont normalisés en Unicode **NFC** (contrôlé par la base).

## Conventions de code

- Identifiants de code et de base en anglais (comme le modèle de données de la spec) ;
  commentaires, documentation et interface en français ; valeurs métier comme dans la spec
  (`test_en_attente`, `varie`, `principale`…).
- Une migration SQL par changement de schéma (`supabase/migrations`), jamais modifiée une fois
  appliquée en production.
- Aucun secret dans le code : variables d'environnement, modèle dans `.env.example`.

## Outils

- **npm workspaces** (pas de pnpm à installer).
- **Tests SQL sans Docker** : PGlite (Postgres compilé en WebAssembly) exécute les migrations
  et les tests en local avec un simple `npm test`. La CI applique en plus les migrations sur le
  vrai Postgres de Supabase.
- **Supabase CLI** et **Wrangler** installés comme dépendances npm (`npx supabase …`, `npx wrangler …`).

## Coûts (paliers vérifiés le 27/10/2026)

| Service            | Gratuit                                                                       | Quand payer                                |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------ |
| Cloudflare Pages   | illimité pour les fichiers statiques                                          | jamais                                     |
| Cloudflare Workers | 100 000 req/jour                                                              | campagne : 5 $/mois (10 M req)             |
| R2                 | 10 Go-mois, 1 M écritures, 10 M lectures, sortie gratuite                     | 0,015 $/Go/mois au-delà                    |
| Supabase           | 500 Mo, 2 projets, pause après 1 semaine d'inactivité, pas de sauvegarde auto | Pro 25 $/mois si le test de charge l'exige |
| GitHub Actions     | illimité (dépôt public)                                                       | jamais                                     |
| Sentry             | 5 000 erreurs, 1 utilisateur                                                  | inutile                                    |
| Resend             | 3 000 e-mails/mois, 100/jour                                                  | inutile                                    |
| Backblaze B2       | 10 Go                                                                         | ~0,006 $/Go/mois au-delà                   |
| Hugging Face       | 100 Go privés                                                                 | inutile                                    |

## Décisions prises

| Date       | Décision                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 27/10/2026 | Architecture et ordre des jalons validés.                                                                                                                                  |
| 27/10/2026 | React + TypeScript pour les deux interfaces.                                                                                                                               |
| 27/10/2026 | Dépôt GitHub **public** (aucun secret ni donnée personnelle dedans).                                                                                                       |
| 27/10/2026 | Carte d'équipe disponible : R2 comme stockage principal.                                                                                                                   |
| 27/10/2026 | Nom de domaine à acheter (Cloudflare Registrar conseillé). En attendant : adresses `*.pages.dev`.                                                                          |
| 27/10/2026 | Par défaut (sauf avis contraire) : budget campagne 5 $/mois + Supabase Pro seulement si nécessaire ; comptes créés avec une adresse e-mail d'équipe partagée, 2FA activée. |

| 27/10/2026 | Téléphone de test iPhone : iPhone 13 Pro. Lancement : le plus tôt possible. |
| 27/10/2026 | Orthographe de référence : arrêté de 1999 (voir « Orthographe zarma » ci-dessous). |

### Questions encore ouvertes

- Consentement « avant chaque enregistrement » : à préciser (à chaque retour de la voix ? avant chaque lot ?).
- Logo : source vectorielle (sera déposée à la racine du dépôt) ; symbole SVG provisoire en attendant.
- Téléphone Android ancien pour les tests.
- Date de début de la voix principale.
- Traduction zarma de l'interface et audios du consentement : pas encore faits.
- CSV réel d'une vingtaine de phrases ; nombre de phrases déjà validées.

## Orthographe zarma

Référence : **arrêté n° 0215/MEN/SP-CNRE du 19 octobre 1999** fixant l'orthographe du
soŋay-zarma (31 lettres). Lettres hors alphabet français :

| Lettre           | Majuscule | Unicode (après normalisation NFC) | Remarque                              |
| ---------------- | --------- | --------------------------------- | ------------------------------------- |
| ŋ                | Ŋ         | U+014B / U+014A                   | souvent écrit « ng » à tort           |
| ɲ                | Ɲ         | U+0272 / U+019D                   | souvent écrit « ny » à tort           |
| ḛ ḭ ṵ (nasales)  | Ḛ Ḭ Ṵ     | 1 caractère (U+1E1B, U+1E2D…)     | tilde **sous** la voyelle             |
| a̰ o̰ (nasales)    | A̰ O̰       | 2 caractères : lettre + U+0330    | pas de forme précomposée dans Unicode |
| voyelles longues |           | lettre doublée (aa, a̰a̰…)          | pas de signe spécial                  |

Conséquences pour le code :

- La base normalise en NFC : `ḛ` tapé en deux caractères devient un seul ; `a̰` reste en deux.
  Ne jamais compter les « lettres » avec `.length` ; les mots se comptent par espaces.
- L'import CSV (J3) signalera les variantes probables : tilde **au-dessus** (ã ẽ ĩ õ ũ),
  « ny », « ng », apostrophes différentes (’ et ') — à trancher dans la liste des mots décidés.
- Affichage : polices système (Noto sur Android, San Francisco sur iPhone). Le rendu du tilde
  souscrit sera vérifié sur la page de preuve, sur les vrais téléphones.

## Jalons

| Jalon                  | Contenu                                                                                  | Dates indicatives |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------- |
| J1 Fondations          | dépôt, CI, schéma + RLS + tests, connexion équipe, déploiement, **page de preuve audio** | 28 oct – 6 nov    |
| J2 Parcours voix       | invitation, consentement, fiche, tutoriel, test, enregistrement, hors ligne              | 9 – 27 nov        |
| J3 Espace équipe       | import CSV, recrutement, validation des tests, écoute, À refaire                         | 30 nov – 11 déc   |
| J4 Qualité             | vérifs serveur, double écoute, quotas, alertes, tableau de bord                          | 14 – 18 déc       |
| J6a Protection         | sauvegardes + restauration, retrait d'une voix, journal                                  | 21 déc – 3 jan    |
| J7 Charge et lancement | k6 2 000 utilisateurs, test des 5 membres, README                                        | 4 – 15 jan        |
| J5 Voix principale     | séances, audio de référence, verrou                                                      | fin janvier       |
| J6b Exports            | CSV/JSONL/README, partition d'examen, Hugging Face                                       | février           |

## Points d'attention

- **iPhone** : PWA installée = stockage séparé de Safari ; Safari peut effacer un site non ouvert
  depuis 7 jours. On demande `navigator.storage.persist()`, on avertit s'il reste des audios à
  envoyer, et on conseille de ne pas installer l'app sur iPhone.
- **16 kHz** : capture à la fréquence native puis conversion dans le navigateur
  (`OfflineAudioContext`), car un `AudioContext` à 16 kHz direct ne marche pas partout.
- **Micro brut** : certains téléphones ignorent `echoCancellation: false` ; on enregistre les
  réglages réellement appliqués (`getSettings()`) avec chaque audio.
- **Test de charge** : lancé depuis GitHub Actions (≈ 64 Mbit/s montants nécessaires), contre le staging.
