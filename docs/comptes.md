# Créer les comptes et mettre en ligne

Ce guide se suit **une seule fois**, dans l'ordre. Comptez environ 1 h 30.
Les comptes sont à créer par l'équipe (pas par Claude) : ils engagent une carte bancaire
et des données personnelles.

> **Règle d'or** : aucun mot de passe, clé ou jeton ne va dans le code ni dans un message
> WhatsApp. Ils vont dans un gestionnaire de mots de passe partagé (Bitwarden gratuit, par
> exemple), puis dans les « secrets » de GitHub et de Cloudflare.

## 0. Adresse e-mail d'équipe

1. Créez une adresse dédiée (ex. `murya.collecte@gmail.com`), **pas** celle d'un étudiant :
   les comptes doivent survivre au départ d'un membre.
2. Activez la double authentification (2FA) dessus.
3. Créez tous les comptes ci-dessous avec cette adresse, chacun avec la 2FA activée.

## 1. GitHub

1. Créez une organisation (ex. `murya-ai`) et un dépôt **public** `murya-collecte`.
2. Invitez les 5 membres dans l'organisation.
3. Poussez le code :
   ```bash
   git remote add origin https://github.com/murya-ai/murya-collecte.git
   git push -u origin main
   ```
4. La CI (`.github/workflows/ci.yml`) se lance seule. Le déploiement attend l'étape 5.

## 2. Cloudflare (interfaces, API, stockage des audios)

### 2.1 Compte, R2 et connexion de Wrangler (fait le 27/10/2026)

1. Compte Cloudflare créé avec l'adresse d'équipe, R2 activé avec la carte d'équipe.
2. `npx wrangler login` lancé depuis la racine du dépôt (clic sur « Allow »).
3. Buckets, règles CORS et cycle de vie créés en ligne de commande (à refaire seulement si on
   recrée un compte) :

```bash
npx wrangler r2 bucket create murya-audio-staging
npx wrangler r2 bucket create murya-audio
npx wrangler r2 bucket cors set murya-audio-staging --file infra/r2/cors-staging.json
npx wrangler r2 bucket cors set murya-audio --file infra/r2/cors-production.json
npx wrangler r2 bucket lifecycle add murya-audio-staging preuve-7-jours preuve/ --expire-days 7
```

Les buckets ne sont **jamais** rendus publics. Les adresses autorisées (CORS) sont dans
`infra/r2/` : à modifier là, puis relancer la commande `cors set`.

### 2.2 Interfaces et API (Workers)

Cloudflare Pages fait désormais partie des Workers. Les deux interfaces sont donc des Workers
« fichiers statiques » (gratuits et illimités), configurés dans `apps/voix/wrangler.jsonc` et
`apps/equipe/wrangler.jsonc`. Le premier `wrangler deploy` crée le Worker. Adresses :

| Élément        | Staging                                            | Production                                 |
| -------------- | -------------------------------------------------- | ------------------------------------------ |
| App de la voix | https://murya-voix-staging.murya-api.workers.dev   | https://murya-voix.murya-api.workers.dev   |
| Espace équipe  | https://murya-equipe-staging.murya-api.workers.dev | https://murya-equipe.murya-api.workers.dev |
| API            | https://murya-api-staging.murya-api.workers.dev    | https://murya-api.murya-api.workers.dev    |

### 2.3 Clés R2 et secrets de l'API (à faire par l'équipe)

1. Tableau de bord Cloudflare > _R2_ > _Manage API tokens_ > _Create Account API token_ :
   - nom : `api-staging` ; permission **Object Read & Write** ;
   - _Specify bucket(s)_ : seulement `murya-audio-staging` ;
   - à la création, Cloudflare affiche **une seule fois** l'_Access Key ID_ et le
     _Secret Access Key_ : rangez-les dans Bitwarden.
2. Dans un terminal, depuis le dossier `api` (Wrangler demande la valeur ; collez-la, elle
   n'apparaît pas à l'écran — ne la collez **jamais** dans un chat) :

```bash
npx wrangler secret put R2_ACCOUNT_ID --env staging
npx wrangler secret put R2_ACCESS_KEY_ID --env staging
npx wrangler secret put R2_SECRET_ACCESS_KEY --env staging
npx wrangler secret put PROOF_CODE --env staging
```

`R2_ACCOUNT_ID` est l'identifiant du compte (page d'accueil de R2, « Account ID »).
`PROOF_CODE` est un code de votre choix, à donner à l'équipe pour la page de preuve.

3. Plus tard, pour la production : un jeton `api-production` limité à `murya-audio`, et les trois
   premiers secrets avec `--env production` (jamais `PROOF_CODE` en production).

### 2.3 bis Clé secrète Supabase de l'API (fait le 27/10/2026 pour le staging)

L'API appelle les fonctions SQL des voix avec la clé **secrète** Supabase
(_Project Settings_ > _API Keys_ > _Secret keys_, elle commence par `sb_secret_`).
Elle donne tous les droits sur la base : seulement dans l'API, jamais dans une interface.

```bash
npx wrangler secret put SUPABASE_SECRET_KEY --env staging
```

### 2.3 ter Données de démonstration (staging seulement)

Consentement **brouillon** et 15 phrases de démonstration, pour tester le parcours avant
d'avoir le vrai texte et les vraies phrases zarma :

```bash
npx supabase db query --linked -f supabase/seeds/staging-demo.sql
```

Pour faire passer une voix de test de « test en attente » à « active » (l'écran arrive au J3) :

```bash
npx supabase db query --linked "update public.speakers set status = 'active', test_reviewed_at = now() where number = 'V001' and language_code = 'dje'"
```

### 2.4 Jeton pour GitHub

_My Profile_ > _API Tokens_ > _Create Token_ > modèle **Edit Cloudflare Workers**. Notez le jeton
(il servira à l'étape 5).

## 3. Supabase (base de données, connexion de l'équipe)

### 3.1 Ce qui est en place (fait le 27/10/2026)

| Élément        | Valeur                                                               |
| -------------- | -------------------------------------------------------------------- |
| Compte         | `mmmuryaa@gmail.com` (connexion avec le GitHub d'équipe `murya-ai`)  |
| Organisation   | Murya (offre gratuite)                                               |
| Projet staging | `murya-staging`, réf. `zsjvyiirvpqigqsvwcgy`, région West EU (Paris) |
| Adresse API    | https://zsjvyiirvpqigqsvwcgy.supabase.co                             |
| Mot de passe   | dans Bitwarden (« Supabase – base murya-staging »)                   |

Réglages appliqués dans le tableau de bord :

- à la création : « Automatically expose new tables » **désactivé** (les droits sont donnés
  par les migrations), « Enable automatic RLS » activé ;
- _Authentication_ > _Sign In / Providers_ : inscriptions libres **désactivées** ;
  _Email_ : mot de passe de 10 caractères minimum, lettres et chiffres ;
- _Authentication_ > _URL Configuration_ : _Site URL_ = adresse de l'espace équipe staging.

Le projet de **production** sera créé de la même façon avant le lancement (J7).

### 3.2 Appliquer les migrations

Une fois par ordinateur, depuis la racine du dépôt (le navigateur s'ouvre pour valider) :

```bash
npx supabase login
```

```bash
npx supabase link --project-ref zsjvyiirvpqigqsvwcgy
```

Puis, à chaque nouvelle migration :

```bash
npx supabase db push --linked
```

Et pour vérifier la sécurité et les performances de la vraie base :

```bash
npx supabase db advisors --linked --type all
```

### 3.3 Ajouter un membre de l'équipe

1. _Authentication_ > _Users_ > _Add user_ > _Create new user_ : e-mail du membre,
   « Auto confirm user » coché ; le membre tape lui-même son mot de passe.
2. Donner ses rôles (`recruteur`, `verificateur`, `qualite`, `admin` — deux admins au maximum) :

```bash
npx supabase db query --linked "insert into public.team_members (user_id, display_name, roles) select id, 'Prénom', array['recruteur','verificateur'] from auth.users where email = 'membre@exemple.org'"
```

> Le projet gratuit se met **en pause après 7 jours sans activité**. Il se réveille depuis le
> tableau de bord Supabase.

## 4. Configuration locale

1. Copiez `.env.example` en `.env.local` et remplissez les valeurs du projet **staging**.
2. Copiez `api/.dev.vars.example` en `api/.dev.vars` et remplissez les clés R2 **staging**.

## 5. Déploiement automatique

Dans GitHub, _Settings_ > _Environments_, créez `staging` et `production`
(pour `production`, ajoutez une règle « Required reviewers » avec les deux admins).
Dans chacun :

| Type     | Nom                             | Valeur                                                               |
| -------- | ------------------------------- | -------------------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`          | jeton de l'étape 2.4                                                 |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`         | Account ID                                                           |
| Secret   | `SUPABASE_DB_URL`               | adresse du session pooler du projet correspondant                    |
| Variable | `VITE_API_URL`                  | adresse du Worker (`https://murya-api-staging.<compte>.workers.dev`) |
| Variable | `VITE_SUPABASE_URL`             | URL du projet Supabase correspondant                                 |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | clé publishable correspondante                                       |

Enfin, _Settings_ > _Secrets and variables_ > _Actions_ > _Variables_ : créez la variable de
dépôt `DEPLOY_ENABLED` = `true`.

À partir de là :

- chaque push sur `main` met à jour le **staging** ;
- un tag `v0.1.0` (`git tag v0.1.0 && git push --tags`) déploie en **production**.

## 6. Plus tard

- **Nom de domaine** (Cloudflare Registrar, ~10–15 $/an) : on remplacera alors les adresses
  `workers.dev`, et on resserrera les règles de sécurité (`_headers`, CORS).
- **Sentry** (J2), **Resend** pour les e-mails (après achat du domaine),
  **Backblaze B2** pour les sauvegardes (J6a).
