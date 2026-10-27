# Tests sur appareils réels

Résultats de la page de preuve (`/preuve`) sur de vrais téléphones. Ils servent à régler les
seuils des vérifications instantanées (réglage `client_checks`) et à repérer les téléphones
problématiques avant le lancement. Ajoutez une ligne par test (rapport copié depuis la page).

| Date       | Appareil      | Système / navigateur  | Fréquence native | Micro brut ?                                         | Mode       | Résultat                                                 |
| ---------- | ------------- | --------------------- | ---------------- | ---------------------------------------------------- | ---------- | -------------------------------------------------------- |
| 27/10/2026 | iPhone 13 Pro | iOS 26.5, Safari 26.5 | 48 kHz           | `echoCancellation: false` respecté ; autres inconnus | varié      | ✓ 16 kHz mono, 4 s, envoyé et vérifié en 2,6 s           |
| 27/10/2026 | iPhone 13 Pro | iOS 26.5, Safari 26.5 | 48 kHz           | idem                                                 | principale | ✓ 48 kHz mono, 5,1 s, 480 Ko, envoyé et vérifié en 2,7 s |

## Constats

### iPhone 13 Pro (27/10/2026)

- **Chaîne complète validée** : capture AudioWorklet, conversion 48 → 16 kHz, WAV, envoi direct
  dans R2, vérification du format par l'API.
- **Réglages du micro** : Safari confirme `echoCancellation: false` mais n'indique pas
  `noiseSuppression` ni `autoGainControl` (il ne les expose pas). Absent du rapport = inconnu,
  pas « désactivé ».
- **Niveau faible** : voix à -40,8 dBFS (crête 0,038), bruit de fond à -70,5 dBFS. Le son est
  propre (30 dB d'écart) mais bas, car le réglage automatique du volume est coupé.
  Avec le seuil actuel (`min_speech_rms_dbfs` = -45), une voix plus douce serait refusée à tort.
  → **À faire au J2** : juger « on vous entend » d'abord sur l'écart voix / bruit de fond, avec un
  seuil absolu plus bas ; abaisser aussi le plancher de détection de la parole (-50 dBFS), qui
  a probablement compté des syllabes faibles comme du silence (1,4 s de parole détectée).
- **Réseau** : Safari ne donne pas le type de connexion (`reseau: inconnu`).
- **Mode « voix principale »** : WAV 48 kHz (fréquence native gardée, sans conversion), 480 Ko
  pour 5,1 s (~94 Ko/s, soit environ 1,7 Go pour les 5 h prévues). Voix à -38,8 dBFS, même
  bruit de fond (-70,7 dBFS). Envoi en 2,7 s.

## À tester encore

- Un Android ancien (Chrome), idéalement d'entrée de gamme.
- Lien ouvert depuis WhatsApp (Android et iPhone).
- Mode « voix principale » sur Android.
- Affichage des lettres zarma (ŋ, ɲ, a̰, ḛ, ḭ, o̰, ṵ) sur chaque téléphone.
