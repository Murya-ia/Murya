# Guide de l'espace équipe

Pour les membres de l'équipe Murya. Adresse de la version d'essai :
https://murya-equipe-staging.murya-api.workers.dev

Chaque membre a un ou plusieurs **rôles**, affichés sur l'accueil. Le menu du haut ne montre
que les pages utiles à vos rôles.

| Rôle                | Ce qu'il fait                                                             |
| ------------------- | ------------------------------------------------------------------------- |
| Recruteur           | invite des voix, écoute leur test, les accompagne                         |
| Vérificateur        | écoute les audios et décide : validé, à corriger, rejeté ou doute         |
| Responsable qualité | tranche les doutes, fait la double écoute, gère l'orthographe des phrases |
| Admin (2 au plus)   | tout, plus : identités, retraits, exports, journal                        |

## Se connecter

E-mail et mot de passe donnés par un admin. Il n'y a pas d'inscription libre : un mot de passe
oublié se redemande à un admin.

## Accueil

Ce qui vous attend, en grands chiffres : tests de voix à écouter, audios à vérifier, doutes à
trancher, signalements de phrases, demandes de retrait (admins). Cliquez sur un chiffre pour
aller directement au travail. En dessous : le **tableau de bord** de la langue (heures
enregistrées et validées, taux de rejet, quotas par sexe, âge et région, alertes).

## Voix (recruteurs et admins)

### Inviter une voix

1. Carte **« Inviter une voix »** : tapez le nom ou un surnom de la personne (vous seul et les
   admins le voyez), puis **« Créer le lien »**.
2. **« Envoyer sur WhatsApp »** ouvre WhatsApp avec le message prêt ; ou **« Copier le
   lien »**. Le lien est personnel : il ne faut pas le partager avec quelqu'un d'autre.
3. La personne ouvre le lien sur son téléphone : elle choisit sa langue, lit et coche l'accord,
   répond à quelques questions, regarde le tutoriel, puis lit les **5 phrases du test**.

Pour une personne qui lit peu : **accord oral**. Enregistrez avec votre téléphone la personne
qui donne son accord à voix haute. Puis, dans le suivi des voix, sur la ligne de son
invitation, cliquez sur **« Consentement oral »** : tapez son nom, joignez le fichier et
envoyez. Le fichier est rangé à part, jamais avec les audios.

### Écouter le test

Quand le test est fait, la ligne de la voix indique « Test fait — à écouter ». Cliquez sur
**« Écouter le test »** : les 5 audios s'affichent avec leur forme d'onde.

- Bien enregistré : **« Valider le test »**. La voix reçoit alors son lot de phrases.
- Problème (bruit, voix trop basse, mauvaise phrase) : écrivez un court message, puis
  **« Demander de refaire »**. La voix le lit dans son application.

### Suivi des voix

Le tableau **« Suivi des voix »** montre chaque personne : son numéro (V012), son étape et son
avancement. Une voix n'est jamais connue autrement que par son numéro dans les audios.

### Retrait d'une voix (droit à l'effacement)

- Un **recruteur** demande le retrait d'une de ses voix (avec une courte note).
- Un **admin** le confirme en retapant le numéro de la voix. C'est **définitif** : audios,
  fiche, identité et accords sont effacés aussitôt ; les sauvegardes les oublient au plus tard
  30 jours après.

### Voix principale (admins et responsable qualité)

La voix principale lit tout le corpus, en séances d'environ 150 phrases, en qualité supérieure.
Carte **« Voix principale »** de la page Voix :

1. **Désigner** (admins) : choisir la voix dans la liste, puis **« Désigner comme voix
   principale »**. Une seule par langue. Elle passe d'abord le test comme les autres.
2. **Suivre les séances** : enregistrées, à vérifier, rejetées. Ses audios s'écoutent dans la
   page Écoute comme les autres. Quand **tous** les audios d'une séance sont vérifiés, la
   séance suivante s'ouvre seule ; la voix le voit en revenant sur son lien.
3. **Audio de référence** (admins) : après la première séance, **« Choisir l'audio de
   référence »**, écouter quelques audios validés et prendre celui dont le ton est le meilleur.
   La voix le réécoute au début de chaque séance.

## Écoute (vérificateurs, responsable qualité, admins)

Un audio à la fois. Écoutez-le (bouton lecture ou **barre d'espace**), lisez le texte attendu,
puis décidez :

| Décision   | Touche | Quand                                                                   |
| ---------- | ------ | ----------------------------------------------------------------------- |
| Validé     | 1      | la phrase est lue telle quelle, clairement                              |
| À corriger | 2      | lu correctement mais un peu différemment : tapez le texte exact entendu |
| Rejeté     | 3      | inaudible, bruit fort, autre voix, coupé, mauvaise phrase… (motif)      |
| Doute      | D      | vous ne savez pas : le responsable qualité tranchera                    |
| Passer     | →      | laisser cet audio à quelqu'un d'autre                                   |

Les indicateurs au-dessus des boutons (durée, volume, saturation, bruit) aident à décider ; un
audio marqué **« Suspect »** mérite une écoute attentive. Vous n'écoutez jamais les audios de
vos propres recrues : un autre membre s'en charge.

Onglets en haut : **À vérifier**, **Doutes** (responsable qualité) et **Double écoute** (chaque
semaine, 10 % des audios validés sont réécoutés par une deuxième personne).

## Phrases

La liste des phrases, avec le nombre de lectures validées. Les admins et le responsable qualité
**importent** de nouvelles phrases (fichier CSV, voir [guide-phrases.md](guide-phrases.md)),
**désactivent** une phrase mal écrite, et tiennent la liste des **mots décidés** (orthographe
retenue). Quand une voix signale « je n'arrive pas à lire cette phrase », la phrase apparaît
ici.

## Exports (admins)

1. **Voix examen** : Murya propose environ 10 % des voix, réparties par sexe, âge et région.
   Tous leurs audios iront dans la partie « examen », jamais dans l'entraînement. Cochez ou
   décochez, puis **« Enregistrer la sélection »**.
2. **Nouvel export** : choisissez le type (voix variées ou voix principale), puis **« Lancer
   l'export »**. Il est prêt en 15 à 30 minutes ; la page se met à jour seule.
3. **Versions** : téléchargez l'archive, la fiche de version ou les métadonnées ; le lien
   Hugging Face ouvre le dépôt privé. Aucun nom ni contact n'est jamais dans un export.

## Journal (admins)

Qui a fait quoi, et quand : invitations, décisions, retraits, consultations d'identité,
exports. Filtres par action et par membre. Le journal ne peut être ni modifié ni effacé.

## En cas de problème

- Message « Une erreur est survenue » : rechargez la page (Ctrl + F5). Si cela continue,
  notez la page, l'heure et ce que vous faisiez, et prévenez un admin.
- Le numéro de version en bas de page dit quelle version est en ligne.
