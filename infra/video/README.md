# Vidéo du tutoriel

Vidéo d'environ une minute, au format téléphone (vertical), montrée dans l'écran « Comment bien
enregistrer » de l'appli des voix. Animation : `video.html` (couleurs, police et logo Murya) ;
la voix off et les sous-titres disent la même chose.

- Version française : `apps/voix/public/tutoriel-fr.mp4` (voix de synthèse ElevenLabs, voix
  « Adam – Formation, Tutos », 720 × 1280, 2 Mo).
- Version zarma : à faire avec la voix d'un membre de l'équipe (aucun logiciel ne parle le
  zarma de façon fiable).

## Texte de la voix off (9 phrases, une par scène)

| Scène | Texte français                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| s1    | Bienvenue sur Murya. Avec votre voix, vous aidez à créer une intelligence artificielle qui comprend les langues locales africaines. |
| s2    | C'est simple : l'application vous montre une phrase, et vous la lisez à voix haute.                                                 |
| s3    | D'abord, installez-vous dans un endroit calme : pas de télévision, pas de moto, pas de foule autour de vous.                        |
| s4    | Tenez le téléphone à une main de votre bouche. Pas trop près, pas trop loin.                                                        |
| s5    | Touchez le bouton pour enregistrer. Attendez une seconde. Puis lisez la phrase, normalement, comme vous parlez tous les jours.      |
| s6    | Quand vous avez fini, touchez encore le bouton pour arrêter. Vous pouvez réécouter, recommencer, ou valider.                        |
| s7    | Pas de réseau ? Pas de souci. Vos enregistrements sont gardés dans le téléphone, et partent tout seuls quand le réseau revient.     |
| s8    | Une phrase est trop difficile ? Touchez « Je n'arrive pas à lire cette phrase », et passez à la suivante.                           |
| s9    | Merci pour votre aide. Chaque voix compte.                                                                                          |

## Faire la version zarma

1. Traduire les 9 phrases, puis les enregistrer **une par une** (un fichier par phrase,
   `s1` à `s9`), au calme, avec un téléphone. Formats acceptés : m4a, mp3, wav.
2. Les ranger dans `infra/video/audio/` (`s1.m4a`, `s2.m4a`…), et traduire les sous-titres
   dans `TEXTS` de `video.html`.
3. Mettre la durée de chaque fichier dans `durees.json` (en secondes ; `ffprobe` la donne).
4. Filmer l'animation (Chrome et ffmpeg installés), depuis ce dossier : `node filmer.cjs`.
   Les images vont dans `images/`, et le moment où commence chaque phrase dans `voix.json`.
5. Assembler la voix aux bons moments puis encoder en 720 × 1280 avec ffmpeg (commandes dans
   l'historique Git du commit de la vidéo française).
6. Copier le résultat dans `apps/voix/public/tutoriel-dje.mp4` et l'ajouter à `VIDEOS` dans
   `apps/voix/src/screens/TutorialScreen.tsx`.
