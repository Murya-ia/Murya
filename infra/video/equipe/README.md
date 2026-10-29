# Vidéo de présentation de l'espace équipe

Vidéo d'environ 3 min 45, au format téléphone (vertical), à envoyer aux membres de l'équipe
(par exemple sur WhatsApp). Elle montre les **vraies pages** de l'espace équipe, capturées en
mode démo (données d'exemple : aucune vraie voix, aucun vrai nom), avec une voix off
française et des sous-titres.

Plan : Bienvenue (missions, rôles) · Pour tous (connexion, écran d'accueil du téléphone,
accueil, menu, compte) · Recruteurs (page Voix, inviter, test, « écouter puis répéter ») ·
Vérificateurs (page Écoute, décisions, correction, son, file commune) · Responsable qualité
(doutes, double écoute, voix principale) · Pour tous (phrases, tableau de bord) · Admins
(membres, activité, exports et journal) · Sur ordinateur.

## Fichiers

| Fichier        | Rôle                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `textes.json`  | texte de la voix off, une phrase par scène (`s01` à `s27`)               |
| `capturer.cjs` | prend les captures de l'appli en mode démo → `ecrans/`, `ecrans.json`    |
| `video.html`   | l'animation (scènes, zooms, projecteur, sous-titres)                     |
| `durees.json`  | durée de la voix de chaque scène (en secondes)                           |
| `filmer.cjs`   | filme l'animation image par image → `images/` ; `--apercu 3,20` → essais |
| `monter.py`    | place la voix aux bons moments et encode → `murya-espace-equipe.mp4`     |

Voix off : ElevenLabs, voix « Adam – Formation, Tutos » (la même que le tutoriel des voix),
un fichier par scène dans `audio/` (`s01.wav`…). Les captures, les images, l'audio et la
vidéo ne sont pas dans Git : on les refait avec les commandes ci-dessous.

## Refaire la vidéo (après un changement de page, ou pour une autre langue)

Depuis ce dossier, avec Chrome et ffmpeg installés :

1. `npm run dev:equipe` (à la racine), puis `node capturer.cjs` : nouvelles captures.
2. Voix off : un fichier par scène dans `audio/`, puis leur durée dans `durees.json`
   (`ffprobe` la donne). Pour une version zarma : traduire `textes.json` (sous-titres) et
   enregistrer les phrases avec la voix d'un membre de l'équipe.
3. `node filmer.cjs --apercu 4,45,110` pour vérifier quelques images (`apercu/`), puis
   `node filmer.cjs` pour toute la vidéo (une dizaine de minutes).
4. `python monter.py`.
