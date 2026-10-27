# Murya

IA vocale pour les langues locales africaines, en commençant par le zarma.

## Murya Collecte

Ce dépôt contient la plateforme de collecte d'enregistrements vocaux : des personnes lisent des
phrases en **zarma** (`dje`) sur leur téléphone, à distance ; l'équipe vérifie chaque audio.

- Cahier des charges : [`MURYA_SPEC.md`](MURYA_SPEC.md)
- Architecture, coûts et décisions : [`docs/architecture.md`](docs/architecture.md)
- Créer les comptes et mettre en ligne : [`docs/comptes.md`](docs/comptes.md)

## Organisation du dépôt

```
apps/voix/        PWA des voix (téléphone) — doit rester très légère
apps/equipe/      espace équipe (ordinateur)
packages/commun/  code partagé : encodage WAV, analyse audio, thème, logo
api/              API sans état (Cloudflare Worker) : jetons, URL signées R2
supabase/         schéma SQL (migrations), tests de la base
scripts/          outils (budget de poids)
docs/             documentation
```

## Installer

Prérequis : [Node.js](https://nodejs.org) 22 ou plus récent, et Git. Docker n'est **pas** nécessaire.

```bash
npm install
```

Sous Windows, si `npx supabase` affiche « No matching Supabase CLI binary package found » :

```bash
npm install --no-save @supabase/cli-windows-x64
```

## Lancer en local

1. `cp .env.example .env.local` puis remplir (valeurs du projet **staging**, voir `docs/comptes.md`).
2. `cp api/.dev.vars.example api/.dev.vars` puis remplir.
3. Dans trois terminaux :

```bash
npm run dev:api
```

```bash
npm run dev:voix
```

```bash
npm run dev:equipe
```

- App de la voix : http://localhost:5173 — page de preuve audio : http://localhost:5173/preuve
- Espace équipe : http://localhost:5174
- API : http://localhost:8787/sante

Pour tester le micro depuis un téléphone sur le même Wi-Fi, il faut une adresse HTTPS : le
plus simple est d'utiliser la version **staging** déployée.

## Vérifier

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run format:check
```

```bash
npm run build && npm run budget
```

`npm test` lance aussi les tests de la base : les migrations sont exécutées dans **PGlite**
(Postgres compilé pour tourner dans Node), sans Docker ni connexion. La CI applique en plus les
migrations sur le vrai Postgres de Supabase.

## Modifier la base

1. Créez un fichier `supabase/migrations/AAAAMMJJHHMMSS_description.sql` (jamais modifier une
   migration déjà appliquée en production).
2. Ajoutez ou adaptez les tests dans `supabase/tests/`.
3. `npm test`. Le déploiement applique ensuite la migration automatiquement.

## Déployer

Automatique une fois les comptes configurés (`docs/comptes.md`, étape 5) :
push sur `main` → staging ; tag `v*` → production.

## À venir

Ajouter une langue (J2–J3) et restaurer une sauvegarde (J6a) : ces sections seront écrites
avec les jalons correspondants.
