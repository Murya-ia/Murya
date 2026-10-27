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

### 2.1 Compte et R2

1. Créez le compte Cloudflare, puis ouvrez **R2** dans le menu. L'activation de R2 demande
   d'enregistrer la carte d'équipe (rien n'est facturé sous 10 Go).
2. Notez l'**Account ID** (affiché sur la page R2).
3. Créez deux buckets : `murya-audio-staging` et `murya-audio`. Emplacement : _Automatic_.
   Ne les rendez **jamais** publics.
4. Pour **chaque** bucket, onglet _Settings_ > _CORS policy_, collez (en adaptant les adresses) :
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173", "https://murya-voix-staging.pages.dev"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Pour `murya-audio`, mettez seulement l'adresse de production de l'app de la voix.
5. Sur `murya-audio-staging`, _Settings_ > _Object lifecycle rules_ : ajoutez une règle
   « préfixe `preuve/` → supprimer après 7 jours » (fichiers de la page de preuve).
6. _R2_ > _Manage API tokens_ > _Create API token_ : permission **Object Read & Write**,
   limitée au bucket `murya-audio-staging`. Notez l'_Access Key ID_ et le _Secret Access Key_
   (affichés une seule fois). Refaites-le pour `murya-audio` (production).

### 2.2 Projets Pages (interfaces)

Depuis un terminal à la racine du dépôt :

```bash
npx wrangler login
npx wrangler pages project create murya-voix-staging --production-branch main
npx wrangler pages project create murya-equipe-staging --production-branch main
npx wrangler pages project create murya-voix --production-branch main
npx wrangler pages project create murya-equipe --production-branch main
```

Si un nom est déjà pris sur `pages.dev`, Cloudflare affiche l'adresse réellement attribuée :
reportez-la dans `api/wrangler.toml` (`ALLOWED_ORIGINS`) et dans la règle CORS de R2.

### 2.3 Secrets de l'API

```bash
cd api
npx wrangler secret put R2_ACCOUNT_ID --env staging
npx wrangler secret put R2_ACCESS_KEY_ID --env staging
npx wrangler secret put R2_SECRET_ACCESS_KEY --env staging
npx wrangler secret put PROOF_CODE --env staging      # code de la page de preuve, staging seulement
```

Puis les trois premiers avec `--env production` (jamais `PROOF_CODE` en production).

### 2.4 Jeton pour GitHub

_My Profile_ > _API Tokens_ > _Create Token_ > modèle **Edit Cloudflare Workers**, puis ajoutez
la permission _Account_ > _Cloudflare Pages_ > _Edit_. Notez le jeton.

## 3. Supabase (base de données, connexion de l'équipe)

1. Créez une organisation, puis **deux projets** : `murya-staging` et `murya-production`.
   Région : **West EU (Paris)** (la plus proche du Niger). Générez un mot de passe de base
   fort et rangez-le dans le gestionnaire.
2. Dans chaque projet :
   - _Authentication_ > _Sign In / Providers_ : **désactivez** « Allow new users to sign up » ;
     longueur minimale du mot de passe : 10.
   - _Authentication_ > _URL Configuration_ : _Site URL_ = adresse de l'espace équipe.
   - _Project Settings_ > _API Keys_ : notez l'URL du projet et la clé **publishable**.
     La clé **secret** ne sert pas encore (J2) ; ne la mettez jamais dans une interface.
   - _Connect_ > _Session pooler_ : copiez l'adresse de connexion (avec le mot de passe).
3. Appliquez le schéma (depuis la racine du dépôt) :
   ```bash
   npx supabase db push --db-url "postgresql://…adresse du session pooler…"
   ```
4. Créez le premier admin : _Authentication_ > _Users_ > _Add user_ (e-mail + mot de passe,
   « Auto confirm » coché). Copiez son identifiant (UUID), puis dans _SQL Editor_ :
   ```sql
   insert into public.team_members (user_id, display_name, roles)
   values ('<UUID copié>', 'Prénom', '{admin}');
   ```
   Les autres membres sont ajoutés de la même façon, avec leurs rôles
   (`recruteur`, `verificateur`, `qualite`, `admin` — deux admins au maximum).

> Le projet gratuit se met **en pause après 7 jours sans activité**. Le staging peut donc
> s'endormir entre deux séances de travail : il se réveille depuis le tableau de bord.

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
  `pages.dev` et `workers.dev`, et on resserrera les règles de sécurité (`_headers`, CORS).
- **Sentry** (J2), **Resend** pour les e-mails (après achat du domaine),
  **Backblaze B2** pour les sauvegardes (J6a).
