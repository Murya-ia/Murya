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
worker/           worker Python : vérifications audio, sauvegardes, exports
infra/            essai de charge (k6), réglages du stockage
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
- Espace équipe : http://localhost:5174 — avec des données d'exemple, sans compte :
  http://localhost:5174/?demo
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

Worker Python (vérifications audio, sauvegardes, exports), depuis le dossier `worker` :

```bash
python -m pytest -q
```

`npm test` lance aussi les tests de la base : les migrations sont exécutées dans **PGlite**
(Postgres compilé pour tourner dans Node), sans Docker ni connexion. La CI applique en plus les
migrations sur le vrai Postgres de Supabase.

## Modifier la base

1. Créez un fichier `supabase/migrations/AAAAMMJJHHMMSS_description.sql` (ne jamais modifier
   une migration déjà appliquée).
2. Ajoutez ou adaptez les tests dans `supabase/tests/`, puis `npm test`.
3. Appliquez-la à la base de la version d'essai :

```bash
npx supabase db push --linked
```

Pour lancer une requête ou un fichier SQL sur cette base : `npx supabase db query --linked -f fichier.sql`.

## Déployer

Le déploiement automatique (`.github/workflows/deploy.yml` : push sur `main` → version d'essai ;
étiquette `v*` → production) attend la variable de dépôt `DEPLOY_ENABLED`. En attendant, on
déploie à la main, depuis la racine du dépôt :

1. **Base** : `npx supabase db push --linked` (si une migration a été ajoutée).
2. **API** : `cd api` puis `npx wrangler deploy --env staging`.
3. **Interfaces** : définir d'abord les adresses (valeurs publiques de la version d'essai) :

```bash
export VITE_API_URL=https://murya-api-staging.murya-api.workers.dev VITE_SUPABASE_URL=https://zsjvyiirvpqigqsvwcgy.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_cog8d6yufk-QJQLR4t8_QA_S7ecZBjV VITE_VOICE_APP_URL=https://murya-voix-staging.murya-api.workers.dev
```

puis `npm run build -w @murya/voix -w @murya/equipe`, et `npx wrangler deploy --env staging`
dans `apps/voix` puis dans `apps/equipe`.

**Toujours vérifier** que la construction contient bien l'adresse de Supabase avant de
déployer : sans ces variables, l'interface mise en ligne ne marche pas.

```bash
grep -l zsjvyiirvpqigqsvwcgy apps/equipe/dist/assets/*.js
```

## Tâches automatiques

| Tâche                                 | Quand                | Où                                 | Documentation                                  |
| ------------------------------------- | -------------------- | ---------------------------------- | ---------------------------------------------- |
| Vérification des audios (worker)      | toutes les 15 min    | GitHub Actions « Worker »          | [`docs/architecture.md`](docs/architecture.md) |
| Sauvegarde chiffrée (base + fichiers) | chaque nuit (2 h 30) | GitHub Actions « Sauvegarde »      | [`docs/sauvegardes.md`](docs/sauvegardes.md)   |
| Exports demandés par un admin         | toutes les 15 min    | GitHub Actions « Exports »         | [`docs/comptes.md`](docs/comptes.md) § 2.7     |
| Reprise des effacements (retraits)    | toutes les heures    | API (tâche planifiée Cloudflare)   | [`docs/sauvegardes.md`](docs/sauvegardes.md)   |
| Essai de charge                       | à la main            | GitHub Actions « Essai de charge » | [`docs/charge.md`](docs/charge.md)             |

## Ajouter une langue

Tout porte un code de langue (`dje` pour le zarma) : une nouvelle langue ne demande pas de
refonte, mais quelques étapes.

1. **La langue en base** : une migration qui ajoute la ligne, sur le modèle du zarma
   (`supabase/migrations/20261027120000_schema_de_base.sql`, section « Données de
   référence ») :

```sql
insert into public.languages (code, name_fr, name_native, active, mother_tongue_code)
values ('hau', 'Haoussa', 'Hausa', true, 'haoussa');
```

Les réglages (`settings`) valent pour toutes les langues ; pour une valeur propre à la
langue (quotas, taille des lots…), ajouter une ligne avec `scope = 'hau'`. 2. **Le texte d'accord** relu par un juriste : une ligne `consent_versions` publiée pour la
langue (modèle : `supabase/seeds/staging-demo.sql`). On ne modifie jamais une version
publiée : on en crée une nouvelle. 3. **Les phrases** (dont les 5 phrases du test) : import depuis la page Phrases de l'espace
équipe, voir [`docs/guide-phrases.md`](docs/guide-phrases.md). 4. **L'espace équipe** travaille aujourd'hui sur une seule langue (constante `LANGUAGE` dans
`apps/equipe/src/lib/team.tsx`) : pour gérer deux langues à la fois, il faudra ajouter un
choix de langue en haut de l'espace (à faire avec la deuxième langue). 5. **L'interface de l'appli des voix** existe en zarma et en français
(`apps/voix/src/i18n/`). Une voix d'une autre langue peut l'utiliser en français ; pour la
traduire, ajouter un fichier `xxx.json` et le bouton correspondant sur l'écran de choix de
langue.

## Restaurer une sauvegarde

Chaque nuit, la base et les fichiers sont sauvegardés, chiffrés, chez Backblaze B2. La clé
privée qui permet de les relire est gardée par les admins (fichier texte, avec une copie hors
de l'ordinateur). Procédure complète, exercice compris : [`docs/sauvegardes.md`](docs/sauvegardes.md).
En résumé, depuis le dossier `worker` :

```bash
python -m murya_worker.restore --cle chemin/cle-sauvegarde-murya.txt --base "adresse de la base" --fichiers
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) : architecture, coûts, décisions, jalons
- [`docs/comptes.md`](docs/comptes.md) : comptes, clés et réglages de chaque service
- [`docs/guide-equipe.md`](docs/guide-equipe.md) : utiliser l'espace équipe (pour l'équipe)
- [`docs/essai-equipe.md`](docs/essai-equipe.md) : essai complet par les 5 membres
- [`docs/guide-phrases.md`](docs/guide-phrases.md) : écrire et importer les phrases
- [`docs/sauvegardes.md`](docs/sauvegardes.md) : sauvegardes et restauration
- [`docs/charge.md`](docs/charge.md) : essais de charge et résultats
- [`docs/appareils.md`](docs/appareils.md) : téléphones essayés
