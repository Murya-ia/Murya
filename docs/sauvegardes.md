# Sauvegardes et restauration

Spec §8.3 : « sauvegarde automatique […] vers un second emplacement, avec un test de
restauration documenté ». Ce document dit ce qui est sauvegardé, où, combien de temps, et
comment tout remettre en place si la base ou le stockage sont perdus.

## En bref

| Quoi                                    | Quand                      | Gardé                                    |
| --------------------------------------- | -------------------------- | ---------------------------------------- |
| Base (voix, fiches, identités, audios…) | chaque nuit (2 h 30)       | 7 dernières nuits + 4 derniers dimanches |
| Audios des voix                         | chaque nuit (les nouveaux) | tant que la voix n'est pas retirée       |
| Consentements oraux                     | chaque nuit (les nouveaux) | tant que la voix n'est pas retirée       |
| Comptes de l'équipe (connexion)         | avec la base               | comme la base                            |

- **Où** : Backblaze B2, bucket `murya-sauvegardes-staging`, chez un autre fournisseur que
  Cloudflare (si le compte Cloudflare a un problème, les sauvegardes restent).
- **Qui** : le workflow GitHub « Sauvegarde » (`.github/workflows/sauvegarde.yml`), avec le code
  de `worker/murya_worker/backup.py`. Le compte rendu de chaque nuit est visible dans l'onglet
  _Actions_ de GitHub : il ne contient que des nombres.
- **Chiffrement** : tout est chiffré avec [age](https://age-encryption.org) avant de partir chez
  B2. GitHub ne connaît que la clé **publique** (variable `AGE_RECIPIENTS`), qui sert seulement à
  chiffrer. La clé **privée**, seule capable de relire une sauvegarde, est dans un fichier texte
  gardé par les admins — jamais dans GitHub, jamais dans le dépôt. **Sans elle, les sauvegardes
  sont inutilisables** : gardez-en une copie hors de l'ordinateur (clé USB rangée en lieu sûr).

## Droit à l'effacement

Quand un admin retire une voix (spec §5.8) :

1. ses fichiers sont effacés du stockage R2 tout de suite, et l'API laisse une trace minimale
   `retraits/{langue}/{numéro}.json` (numéro, date, admin, clés des fichiers d'identité ; aucun
   nom) ;
2. la nuit suivante, la sauvegarde efface ses propres copies des fichiers de cette voix ;
3. les copies de la base qui contiennent encore la voix sont supprimées en fin de rotation :
   **au plus tard 30 jours après le retrait, la voix n'existe plus nulle part** ;
4. si l'on restaure un jour une sauvegarde plus ancienne que le retrait, la restauration
   retire la voix à nouveau, grâce à la trace (étape 3 de la restauration).

Le bucket B2 doit donc garder **une seule version** de chaque fichier (réglage « Keep only the
last version of the file ») : un fichier effacé disparaît vraiment, sous 24 h.

## Ce qu'il y a dans le bucket de sauvegarde

```text
base/quotidien/2026-11-03/donnees.sql.gz.age   les données de la base (chiffrées)
base/quotidien/2026-11-03/manifeste.json       date, version du schéma, nombre de lignes (lisible)
base/hebdo/2026-11-01/…                         copie du dimanche
fichiers/audio/dje/varie/V001/….wav.age         un fichier par audio
fichiers/audio/retraits/dje/V012.json.age       traces des retraits
fichiers/identites/consentements-oraux/….age    consentements oraux
```

La base est sauvegardée **sans son schéma** (seulement les données) : le schéma, ce sont les
migrations du dépôt (`supabase/migrations`). Le manifeste indique la dernière migration
appliquée au moment de la sauvegarde.

## Restaurer

### Exercice (à faire chaque trimestre, et après chaque changement important)

Il restaure la dernière vraie sauvegarde dans une base jetable, sur une machine de GitHub, sans
rien toucher au staging, et affiche un compte rendu (nombres seulement).

1. Un admin ajoute la clé privée comme secret temporaire, dans un terminal (il colle **toute**
   la ligne `AGE-SECRET-KEY-…` du fichier texte quand on la lui demande) :

   ```bash
   C:\Users\ASUS\outils\gh\bin\gh.exe secret set SAUVEGARDE_CLE_PRIVEE --env staging --repo Murya-ia/Murya
   ```

2. GitHub > _Actions_ > **Exercice de restauration** > _Run workflow_.
3. Vérifier le compte rendu : `differences` doit être vide (ou ne lister que les tables
   touchées par des voix retirées depuis la sauvegarde).
4. **Supprimer le secret** tout de suite après :

   ```bash
   C:\Users\ASUS\outils\gh\bin\gh.exe secret delete SAUVEGARDE_CLE_PRIVEE --env staging --repo Murya-ia/Murya
   ```

5. Noter la date et le résultat dans le tableau « Exercices » en bas de ce document.

La CI fait en plus, à chaque push, un test complet avec des données d'essai (job « Sauvegarde
et restauration ») : sauvegarde, base effacée, restauration, vérifications.

### Pour de vrai (base ou stockage perdus)

1. **Base cible.** Un projet Supabase (l'ancien s'il existe encore, sinon un nouveau). Y
   appliquer les migrations du dépôt, à la version indiquée dans le manifeste :
   `npx supabase link --project-ref <ref>` puis `npx supabase db push --linked`.
2. **Poste de restauration.** Un ordinateur avec Python 3.12, le client PostgreSQL 17 (`psql`)
   et le dossier `worker` du dépôt : `pip install -r worker/requirements.txt`.
3. **Variables** (dans le terminal) : `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`,
   `B2_APPLICATION_KEY` ; et, pour recopier aussi les fichiers, `R2_ACCOUNT_ID`,
   `R2_BUCKET_AUDIO`, `R2_BUCKET_IDENTITES`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (jeton
   R2 en écriture).
4. **Restauration**, depuis le dossier `worker` :

   ```bash
   python -m murya_worker.restore --cle C:\chemin\cle-sauvegarde-murya.txt --base "postgresql://postgres.<ref>:<mot de passe>@<pooler>:5432/postgres" --fichiers
   ```

   `--date AAAA-MM-JJ` pour une sauvegarde précise (sinon la plus récente). Sans `--fichiers`,
   seule la base est restaurée.

   Le script, en une seule transaction : vide nos tables, charge les données, puis **retire à
   nouveau les voix retirées depuis la sauvegarde**, et compare le nombre de lignes au
   manifeste.

5. **Vérifier** : se connecter à l'espace équipe, ouvrir l'accueil (le tableau de bord se
   recalcule), écouter un audio. Mettre à jour la clé secrète Supabase de l'API et du worker
   si le projet a changé (docs/comptes.md).

## Exercices de restauration

| Date | Sauvegarde restaurée | Résultat | Par |
| ---- | -------------------- | -------- | --- |
|      |                      |          |     |
