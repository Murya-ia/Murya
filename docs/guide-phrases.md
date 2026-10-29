# Guide : écrire et importer les phrases

Ce guide accompagne le modèle [`modele-phrases.csv`](modele-phrases.csv). Il sert à toute
l'équipe : auteurs, relecteurs et admins.

## 1. Mettre le modèle dans Google Sheets (une seule fois)

1. Google Sheets → **Fichier** → **Importer** → **Importer** → choisissez `modele-phrases.csv`
   → « Remplacer la feuille de calcul » → séparateur **Détecter automatiquement**.
2. **Affichage** → **Figer** → **1 ligne** : les titres restent visibles quand on descend.
3. Listes déroulantes (évitent les fautes de frappe) :
   - sélectionnez la colonne **Statut** → **Données** → **Validation des données** →
     « Menu déroulant » avec : `À écrire`, `À relire`, `Validée`, `Refusée`, `Exemple` ;
   - même chose pour la colonne **Test** avec : `oui`, `non`.
4. Partagez la feuille avec l'équipe (bouton **Partager**), en « Éditeur ».

## 2. Les colonnes

| Colonne      | Ce qu'on écrit                                                 | Exemple            |
| ------------ | -------------------------------------------------------------- | ------------------ |
| **ID**       | Identifiant unique de la phrase (voir règles ci-dessous)       | `S0457`            |
| **Zarma**    | La phrase en zarma, orthographe officielle                     | —                  |
| **Français** | Sa traduction en français                                      | Je vais au marché. |
| **Thème**    | Un mot pour le sujet (voir la liste)                           | `marché`           |
| **Auteur**   | Prénom de la personne qui a écrit la phrase                    | Awa                |
| **Relu par** | Prénom de la personne qui l'a relue (jamais l'auteur lui-même) | Bachir             |
| **Statut**   | Où en est la phrase                                            | `À relire`         |
| **Test**     | `oui` seulement pour les 5 phrases du test, `non` sinon        | `non`              |

Les noms des colonnes doivent rester **exactement** comme dans le modèle.

### Les identifiants (colonne ID)

- `T0001` à `T0005` : les **5 phrases du test**, lues par chaque nouvelle voix.
- `S0001`, `S0002`… jusqu'à `S3000` : les phrases de la collecte.
- Lettres, chiffres, `-` et `_` seulement : **pas d'espace ni d'accent**.
- Un identifiant **ne change jamais** et **ne sert qu'une fois**, même si la phrase est
  supprimée. C'est lui qui relie la phrase aux enregistrements.

### Le statut

```
À écrire  →  À relire  →  Validée
                       ↘  Refusée
```

- **À écrire** : ligne réservée, phrase pas encore écrite.
- **À relire** : l'auteur a fini ; un relecteur doit vérifier le zarma et la traduction.
- **Validée** : relue et correcte. **Seules les phrases « Validée » sont importées.**
- **Refusée** : ne sera jamais importée (gardez la ligne, ne réutilisez pas son ID).
- **Exemple** : les 2 premières lignes du modèle, jamais importées (on peut les supprimer).

### Les thèmes proposés

salutations, famille, marché, santé, agriculture, école, transport, météo, cuisine, travail,
nombres, temps, maison, questions, émotions, administration, religion, élevage, eau, commerce.
On peut en ajouter ; l'important est de **varier** pour que l'IA entende tout le vocabulaire.

## 3. Comment écrire une bonne phrase

- **Courte et naturelle** : 4 à 15 mots, comme on parle vraiment au quotidien.
- **Une seule phrase** par ligne.
- **Les nombres en toutes lettres** (pas de chiffres) : la voix doit savoir quoi lire.
- **Pas d'abréviation ni de sigle**, pas de nom de personne réelle, pas de numéro de téléphone.
- **Rien de blessant**, ni politique, ni religieux de façon polémique.
- **Variez** : questions, ordres, phrases joyeuses ou tristes, sujets différents.
- La **ponctuation** compte (point, point d'interrogation, virgule) : elle guide l'intonation.

### Les 5 phrases du test

Elles servent à vérifier qu'une nouvelle voix enregistre bien. Choisissez des phrases
**courtes**, **faciles à lire**, et qui contiennent ensemble les sons particuliers du zarma :
les nasales (a̰, ḛ, ḭ, o̰, ṵ), ŋ, ɲ et des voyelles longues (aa, ee…).

## 4. L'orthographe zarma

Référence : **arrêté n° 0215/MEN/SP-CNRE du 19 octobre 1999 fixant l'orthographe de la langue
soŋay-zarma** (ministère de l'Éducation nationale du Niger), texte saisi par l'Université Abdou
Moumouni de Niamey :
[copie archivée](https://web.archive.org/web/20210512070544/http://www.songhay.org/fr/documents/grammaire/Guide_Niger.pdf).

L'alphabet a **30 lettres** :
a a̰ b c d e ḛ f g h i ḭ j k l m n ŋ ɲ o o̰ p r s t u ṵ w y z.

Lettres à copier-coller :

| Lettre    | Majuscule | À ne pas écrire                 |
| --------- | --------- | ------------------------------- |
| ŋ         | Ŋ         | « ng »                          |
| ɲ         | Ɲ         | « ny »                          |
| a̰ ḛ ḭ o̰ ṵ | A̰ Ḛ Ḭ O̰ Ṵ | ã ẽ ĩ õ ũ (tilde **au-dessus**) |

- Les **nasales** prennent le tilde **sous** la voyelle.
- Les **voyelles longues** s'écrivent en doublant la lettre : `aa`, `a̰a̰`. La longueur ne
  s'écrit pas en début de mot, ni en fin de mot, sauf pour le défini des mots en -a :
  `karga` (chaise) → `kargaa` (la chaise).
- Les **tons ne s'écrivent pas**.
- **Majuscule** en début de phrase, après `.` `?` `!`, et aux noms propres.
- **Trait d'union** dans les mots composés (`fondo-fay`) et les mots entièrement redoublés
  (`hina-hina`) ; pas de trait d'union dans les nombres (`iway cindi fo`, onze).
- `-yaŋ` qui fait un nom à partir d'un verbe est **collé** (`karyaŋ`) ; `yaŋ` du pluriel est
  **séparé** (`boro yaŋ`, des personnes).
- On écrit les mots **séparément**, sans les contractions de l'oral (`a no a se`), sauf
  l'apostrophe devant un pronom complément : `Ay kond'a lokkol`.
- Quand l'équipe hésite sur un mot, le responsable qualité tranche et l'ajoute à la liste
  **Mots décidés** (espace équipe → Phrases). Consultez-la avant d'écrire.

L'import affiche une **alerte** (sans bloquer) pour : tilde au-dessus, « ny », « ng » en fin de
syllabe, apostrophes mélangées (’ et '), espaces en trop, caractères inhabituels.

## 5. Importer dans l'espace équipe (admins)

1. Google Sheets → **Fichier** → **Télécharger** → **Valeurs séparées par des virgules (.csv)**.
2. Espace équipe → **Phrases** → **Importer des phrases** → choisissez le fichier.
3. Lisez l'aperçu : nombre de phrases « Validée » et **alertes d'orthographe**. Corrigez dans
   Google Sheets si besoin, puis recommencez.
4. Cliquez sur **Importer**. Le résultat indique les phrases ajoutées, modifiées, inchangées,
   ignorées (pas « Validée ») et les erreurs (ligne et identifiant).

On peut réimporter le même fichier autant de fois qu'on veut :

- une phrase déjà importée et **inchangée** n'est pas touchée ;
- si son **texte change**, une **nouvelle version** est créée : les enregistrements déjà faits
  gardent le texte exact qui a été lu ;
- pour **retirer** une phrase de la collecte, ne la supprimez pas du fichier : désactivez-la
  dans l'espace équipe (Phrases → Désactiver).
