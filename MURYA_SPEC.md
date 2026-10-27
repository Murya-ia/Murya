# Murya Collecte — Cahier des charges pour Claude Code

> **À lire en entier avant d'écrire la moindre ligne de code.**
> Commence par me proposer l'architecture et le plan des jalons (section 12), pose-moi tes questions, puis attends ma validation.

---

## 1. Contexte

Murya construit une IA vocale pour les langues locales africaines, en commençant par le **zarma** (code ISO `dje`). Les langues suivantes viendront ensuite : haoussa (`hau`), kanouri (`kr`), tamasheq (`taq`), peul (`fuh`)…

Cette plateforme sert à **collecter des enregistrements vocaux** : des personnes lisent des phrases en zarma sur leur téléphone, à distance, et l'équipe vérifie chaque audio.

**Contraintes du projet**
- Budget quasi nul : privilégier des services avec un vrai palier gratuit, sans engagement.
- Les utilisateurs sont au Niger et dans la diaspora : connexions lentes et instables, téléphones Android parfois anciens, données mobiles chères.
- Une partie des participants lit peu ou mal : interface simple, gros boutons, très peu de texte.
- L'équipe est composée de 5 étudiants ; le code doit rester lisible et facile à maintenir.

**Objectifs chiffrés de la première collecte (janvier à mars 2027)**
- 3 000 phrases zarma (avec traduction française).
- Au moins 50 voix, environ 150 phrases chacune, soit ~7 200 enregistrements et ~10 heures d'audio validé.
- 1 voix principale qui lit les 3 000 phrases (~4 à 5 heures), en qualité supérieure.

**Exigence de charge** : l'architecture doit tenir **plusieurs milliers d'utilisateurs simultanés** (campagnes de recrutement, diffusion du lien sur WhatsApp ou à la radio) sans tomber, et sans refonte le jour où l'on passe à 10 langues.

---

## 2. Les rôles

| Rôle | Qui | Ce qu'il peut faire |
|---|---|---|
| **Voix** (participant) | Personne qui prête sa voix | Donner son consentement, remplir sa fiche, enregistrer ses phrases, voir sa progression. Aucun compte ni mot de passe : accès par lien d'invitation personnel. |
| **Recruteur** | Membre de l'équipe | Créer des liens d'invitation, suivre ses voix, valider leur test, enregistrer un consentement oral. |
| **Vérificateur** | Membre de l'équipe | Écouter et noter les audios (sauf ceux des voix qu'il a recrutées). |
| **Responsable qualité** | 1 membre | Double écoute, trancher les cas douteux, gérer la liste des mots décidés. |
| **Admin** | 2 personnes maximum | Tout, y compris voir les identités (noms, contacts), traiter les retraits, lancer les exports. |

Un membre peut avoir plusieurs rôles. L'authentification de l'équipe se fait par e-mail (lien magique ou mot de passe).

---

## 3. Parcours de la voix (participant)

### 3.1 Arrivée
1. La personne reçoit un **lien d'invitation unique** sur WhatsApp, par exemple `https://collecte.murya.xxx/i/<jeton>`.
   - Le jeton est long et aléatoire, non devinable, lié au recruteur et à une langue.
   - Il peut expirer ou être révoqué par le recruteur.
   - Le jeton identifie la session de la voix ; elle peut fermer le navigateur et revenir plus tard avec le même lien.
2. Choix de la langue de l'interface : zarma ou français (zarma par défaut). Tous les textes de l'interface sont dans des fichiers de traduction.

### 3.2 Consentement
1. Affichage du texte de consentement **versionné** (le texte est stocké en base avec un numéro de version ; on ne modifie jamais une version publiée, on en crée une nouvelle).
2. Bouton « Écouter » qui lit le texte en audio (fichier audio pré-enregistré par l'équipe, par langue et par version).
3. Cases à cocher, une par point. Le bouton « J'accepte » n'est actif que si toutes sont cochées :
   - enregistrement de la voix ;
   - usage pour entraîner et tester des modèles d'IA ;
   - usage commercial et partage avec des partenaires de recherche ;
   - conservation du sexe, de la tranche d'âge, de la région et de la langue maternelle, sans lien avec le nom ;
   - confirmation d'avoir 18 ans ou plus.
4. Saisie du nom (et optionnellement d'un contact). **Ces données vont dans une table séparée (`identities`), visible uniquement par les admins.**
5. On enregistre : version du texte, horodatage, cases cochées, langue de l'interface utilisée.

**Consentement oral** (personnes qui lisent peu) : un recruteur peut, depuis l'espace équipe, téléverser l'enregistrement audio de l'accord oral de la personne. Ce fichier est rangé avec les identités, jamais avec les données vocales.

### 3.3 Fiche
- Sexe (homme / femme / préfère ne pas dire).
- Tranche d'âge : 18-25, 26-40, 41-60, plus de 60.
- Région où la personne a grandi (liste des régions du Niger + « Autre pays »).
- Langue maternelle (liste + « Autre »).
- Modèle de téléphone (détecté automatiquement si possible, sinon champ libre facultatif).
- La personne reçoit un **numéro de voix anonyme** : `V001`, `V002`… (séquence par langue).

### 3.4 Tutoriel
- Une vidéo courte (environ 2 minutes, en zarma), hébergée de façon légère (bas débit possible, sous-titres).
- Bouton « Passer » pour ceux qui l'ont déjà vue.

### 3.5 Test (5 phrases)
1. La voix enregistre 5 phrases de test fixes.
2. Son statut passe à `test_en_attente`.
3. Le recruteur reçoit une notification dans l'espace équipe (et idéalement un e-mail), écoute, puis valide ou demande de recommencer, avec un message court.
4. Une fois validée, la voix reçoit son lot de 150 phrases (statut `active`).

### 3.6 Enregistrement (écran principal)
- La phrase s'affiche **en très gros**, centrée.
- Gros bouton « Enregistrer » → l'enregistrement commence ; le bouton devient « Stop ».
- Un indicateur de niveau sonore en direct (barre qui bouge quand on parle), pour que la personne voie que le micro fonctionne.
- **Arrêt automatique à 20 secondes.**
- Après « Stop » : boutons « Réécouter », « Recommencer », « Valider ».
- **Vérification instantanée dans le navigateur** avant l'envoi : si l'audio est trop court, silencieux ou saturé, un message simple (et une icône) demande de recommencer. Voir section 6.1.
- « Valider » envoie l'audio et passe à la phrase suivante, **sans attendre la fin de l'envoi** (envoi en arrière-plan, voir 3.8).
- Bouton « Je n'arrive pas à lire cette phrase » : la phrase est sautée et signalée à l'équipe.
- Barre de progression : `42 / 150`.
- Toutes les 50 phrases : écran « Faites une pause de 5 minutes », avec un bouton pour continuer.
- La personne peut quitter à tout moment et reprendre exactement où elle en était.
- Écran de fin : remerciement, nombre de phrases enregistrées, et message indiquant qu'un membre de l'équipe la recontactera si besoin.

### 3.7 Réenregistrement
Si des audios sont rejetés, la voix voit en revenant sur son lien une liste « À refaire » avec uniquement les phrases concernées.

### 3.8 Fonctionnement hors ligne et réseau faible (obligatoire)
- Application web progressive (PWA) installable, avec mise en cache de l'interface.
- Chaque audio validé est d'abord **stocké localement (IndexedDB)**, puis envoyé en arrière-plan.
- File d'envoi avec reprise automatique, nouvelles tentatives à délai croissant, et reprise après fermeture de l'onglet.
- Un petit indicateur discret : « 3 audios en attente d'envoi ». La voix peut continuer à enregistrer même sans réseau.
- Un audio n'est supprimé du téléphone qu'après confirmation par le serveur.
- **Idempotence** : chaque enregistrement a un identifiant unique (UUID) généré dans le navigateur ; un envoi répété ne crée jamais de doublon.

---

## 4. Le format audio

### 4.1 Voix variées
- **Capture en PCM brut via la Web Audio API** (AudioWorklet), puis rééchantillonnage et encodage **WAV mono 16 bits, 16 kHz directement dans le navigateur**. Cela évite les formats différents selon les navigateurs (WebM sur Android, MP4 sur iPhone) et toute conversion côté serveur.
- Désactiver dans les contraintes du micro : `echoCancellation`, `noiseSuppression`, `autoGainControl` (on veut le son réel, sans traitement).
- Taille : environ 32 Ko par seconde, soit environ 160 Ko pour une phrase de 5 secondes.
- Conserver une demi-seconde de silence avant et après la parole (ne pas couper automatiquement).

### 4.2 Voix principale
- WAV mono 16 bits, **44,1 kHz ou 48 kHz** (selon le téléphone), sans aucun traitement.
- Une version 22,05 kHz peut être produite plus tard par un script ; garder l'original.

### 4.3 Nommage et stockage
- Clé de stockage : `{langue}/{type}/{numéro_voix}/{langue}_{numéro_voix}_{id_phrase}_{prise}.wav`
  - exemple : `dje/varie/V023/dje_V023_S0457_1.wav`
  - `type` = `varie` ou `principale`
- **Aucune donnée personnelle dans les noms de fichiers ni dans les URL.**

---

## 5. L'espace équipe

### 5.1 Tableau de bord (page d'accueil)
Par langue :
- Nombre de voix par statut (invitée, test en attente, active, terminée, retirée).
- Heures enregistrées et heures validées (total et par semaine, sous forme de graphique).
- Taux de rejet.
- Répartition par sexe, tranche d'âge et région, **comparée aux quotas** (voir 5.6).
- Voix par recruteur et progression de chacune.
- Avancement de la voix principale : phrases validées sur 3 000.
- Phrases ayant atteint 0, 1, 2, 3 lectures validées.

### 5.2 Gestion des phrases
- **Import CSV** depuis Google Sheets (colonnes : `id`, `zarma`, `francais`, `theme`, `auteur`, `relu_par`, `statut`). Seules les phrases `Validée` sont importées.
- Mise à jour : réimporter un CSV met à jour les phrases existantes par `id` ; une phrase déjà enregistrée ne peut pas voir son texte modifié silencieusement (créer une nouvelle version et garder l'historique).
- Désactiver une phrase (elle n'est plus distribuée).
- Voir les phrases signalées « Je n'arrive pas à lire » avec le nombre de signalements.
- **Liste des mots décidés** (orthographe) : mot, orthographe retenue, variantes refusées, date, décidé par.

### 5.3 Recrutement
- Créer un lien d'invitation (langue, nom ou surnom interne de la personne, recruteur).
- Partager le lien en un clic (bouton qui ouvre WhatsApp avec le message d'invitation pré-rempli).
- Suivi par voix : contactée → d'accord → test fait → test validé → terminée.
- Valider ou refuser le test, avec un message.
- Téléverser un consentement oral.

### 5.4 Écoute et vérification
- File d'écoute : les audios **suspects** (vérifications automatiques) en premier, puis les autres par ancienneté.
- **Un vérificateur ne voit jamais les audios des voix qu'il a recrutées.**
- Pour chaque audio : lecteur (avec forme d'onde), texte attendu, indicateurs automatiques, et trois boutons :
  - **Validé**
  - **À corriger** : un champ permet de modifier le texte pour qu'il corresponde exactement à l'audio ; le texte corrigé est stocké **sur l'enregistrement**, la phrase d'origine reste intacte.
  - **Rejeté** : avec un motif à choisir (inaudible, bruit fort, autre voix, coupé, mauvaise phrase, rire/toux, autre) et un commentaire.
- Raccourcis clavier (Espace = lecture, 1/2/3 = statuts, flèche = suivant) pour écouter vite sur ordinateur.
- Bouton « Doute » qui envoie l'audio au responsable qualité.
- Verrouillage : deux vérificateurs ne doivent pas noter le même audio en même temps (réservation temporaire d'un audio pendant quelques minutes).

### 5.5 Double écoute
- Chaque semaine, tirage aléatoire de 10 % des audios validés de la semaine, assignés au responsable qualité.
- Rapport : taux de désaccord global et par vérificateur.

### 5.6 Quotas et alertes
- Quotas configurables par langue (par défaut : 50 % de femmes, au moins 20 % de plus de 40 ans, au moins 30 % hors de Niamey, au moins 70 % de langue maternelle zarma).
- Alerte sur le tableau de bord si une voix dépasse 2 rejets sur 10.
- Alerte si un audio attend une vérification depuis plus de 3 jours.

### 5.7 Voix principale
- Mode séparé, activé pour une voix précise par un admin.
- Organisation en **séances** (date, durée, nombre de phrases), environ 150 à 200 phrases par séance.
- Un **audio de référence** à réécouter au début de chaque séance, pour garder le même ton.
- Chaque séance doit être entièrement vérifiée avant que la suivante soit ouverte.
- Elle lit l'ensemble des phrases actives, dans un ordre mélangé.

### 5.8 Retrait d'une voix (droit à l'effacement)
- Un admin recherche la voix (par nom dans `identities` ou par numéro).
- Bouton « Retirer » : suppression définitive des fichiers audio (stockage principal **et** copies de sauvegarde à la prochaine rotation), des enregistrements en base, de la fiche et de l'identité.
- On garde seulement une ligne de journal : numéro de voix, date du retrait, admin qui l'a fait.
- Un export déjà réalisé ne peut pas être modifié : le journal permet de retirer la voix du prochain export.

### 5.9 Exports
- Un admin lance un export pour une langue et un type (`varie` / `principale`).
- L'export produit :
  - un fichier `metadata.csv` et `metadata.jsonl` : chemin de l'audio, texte (corrigé s'il y a lieu), id phrase, numéro de voix, sexe, tranche d'âge, région, langue maternelle, durée, partition (`train` / `test`) ;
  - les audios validés dans une archive ou un dossier ;
  - une fiche de version (`README.md`) : date, heures, nombre de voix, répartition, différences avec l'export précédent.
- **Partition d'examen** : un admin désigne des voix « examen » (par défaut 10 % des voix, réparties par sexe, âge et région). **Tous** leurs audios vont dans `test`, jamais dans `train`.
- Option : pousser l'export vers un dépôt **privé** Hugging Face (format `datasets` audio).
- Les identités ne sont **jamais** incluses dans un export.

### 5.10 Journal d'activité
Chaque action sensible est tracée : changement de statut, correction de texte, retrait, export, accès aux identités.

---

## 6. Vérifications automatiques

### 6.1 Dans le navigateur (retour instantané à la voix)
Avant l'envoi :
- durée inférieure à 1 seconde → « Trop court, recommencez » ;
- volume moyen très faible → « On ne vous entend pas » ;
- saturation (trop d'échantillons au maximum) → « Trop fort, éloignez un peu le téléphone » ;
- la parole touche le début ou la fin du fichier → « Attendez une seconde avant de parler ».

Les seuils sont configurables côté serveur et téléchargés au démarrage.

### 6.2 Côté serveur (pour l'équipe, à refaire car le navigateur n'est pas fiable)
Pour chaque audio reçu, une tâche en file d'attente calcule :

| Vérification | Alerte si |
|---|---|
| Format | Pas WAV mono 16 bits à la bonne fréquence |
| Durée | < 1 s ou > 20 s |
| Silence | Volume moyen (RMS) sous un seuil |
| Saturation | Part d'échantillons écrêtés au-dessus d'un seuil |
| Vitesse de lecture | Mots de la phrase / durée de parole hors de 1 à 4 mots par seconde |
| Coupure | Moins de 0,1 s de silence au début ou à la fin |
| Doublon | Empreinte (hash) identique à un audio déjà reçu |
| Rapport signal/bruit | Estimation sous un seuil |

Résultats enregistrés sur l'enregistrement (valeurs + indicateur `suspect`). Tous les seuils sont dans une table de configuration, ajustables sans redéployer.

Plus tard (pas maintenant) : brancher un modèle de reconnaissance vocale pour pré-transcrire et repérer les audios dont le contenu s'éloigne du texte.

---

## 7. Distribution des phrases

- Un lot = 150 phrases (configurable), mélangeant tous les thèmes.
- Priorité aux phrases qui ont **le moins de lectures validées ou en cours**, pour que chaque phrase atteigne 2 à 3 voix (objectif configurable).
- Une voix ne reçoit jamais deux fois la même phrase.
- L'attribution doit rester correcte quand des centaines de voix demandent un lot en même temps : la faire dans une **fonction transactionnelle en base** (verrouillage de lignes, `SELECT … FOR UPDATE SKIP LOCKED` ou équivalent), pas dans le code de l'interface.
- Une phrase attribuée mais non enregistrée après X jours redevient disponible.

---

## 8. Architecture (exigence : tenir des milliers d'utilisateurs simultanés)

### 8.1 Principes non négociables
1. **Les fichiers audio ne transitent jamais par le serveur applicatif.** Le navigateur demande une URL d'envoi signée et courte durée, puis envoie l'audio **directement au stockage objet**. Le serveur ne gère que de petites requêtes JSON.
2. **Serveurs sans état** : n'importe quelle instance peut répondre à n'importe quelle requête ; on peut en ajouter sans rien changer.
3. **Interface servie en statique par un CDN** : la charge de l'interface ne touche jamais la base de données.
4. **Travail lourd en file d'attente** : vérifications audio, exports, sauvegardes passent par des tâches asynchrones traitées par des workers qu'on peut multiplier.
5. **Base de données protégée** : pool de connexions, index sur toutes les requêtes fréquentes, pas de requête lourde dans le chemin de l'utilisateur, tableau de bord calculé à partir de compteurs ou de vues matérialisées rafraîchies périodiquement.
6. **Envois idempotents et reprises** côté client (section 3.8) : un pic de charge ou une coupure ne perd aucun audio et ne crée aucun doublon.
7. **Limitation de débit** par jeton d'invitation et par adresse IP, pour éviter les abus.

### 8.2 Pile recommandée (à discuter avec moi avant de commencer)
Proposition, à justifier ou à remplacer par mieux en respectant la contrainte de coût :
- **Interface** : PWA en TypeScript (React + Vite, ou SvelteKit en mode statique), hébergée sur **Cloudflare Pages** (ou équivalent avec CDN gratuit). Poids cible du premier chargement : moins de 200 Ko compressés.
- **Base de données, authentification de l'équipe, API** : **Supabase** (Postgres + Auth + règles de sécurité au niveau des lignes + fonctions). Utiliser le pool de connexions.
- **Stockage des audios** : **Cloudflare R2** (compatible S3, pas de frais de sortie), avec URL signées pour l'envoi et la lecture. Alternative : Supabase Storage.
- **File d'attente et workers** : une table de tâches dans Postgres (ou une extension de file comme `pgmq`), traitée par un worker **Python** (bibliothèques audio : `soundfile`, `numpy`, éventuellement `librosa`) déployé dans un conteneur, sur un hébergeur avec palier gratuit ou très bas coût. Le worker doit pouvoir tourner en plusieurs exemplaires.
- **Suivi des erreurs** : Sentry (palier gratuit) côté interface et côté worker.

**Vérifie les quotas et les conditions actuelles des paliers gratuits** de chaque service avant de les retenir, et indique-moi à partir de quel volume il faudra payer et combien. Pour mémoire : 15 heures d'audio en WAV 16 kHz font environ 1,7 Go, plus la voix principale en 44,1 kHz (environ 1,5 Go pour 5 heures), plus les sauvegardes.

### 8.3 Sécurité et données personnelles
- Règles de sécurité au niveau des lignes sur toutes les tables.
- Table `identities` (noms, contacts, consentements oraux) accessible **uniquement** aux admins, jamais exposée à l'API publique.
- URL de lecture des audios signées et à durée limitée ; le bucket n'est jamais public.
- HTTPS partout ; jetons d'invitation stockés hachés.
- Aucune donnée personnelle dans les journaux applicatifs.
- Sauvegarde automatique hebdomadaire de la base et des audios vers un second emplacement, avec un test de restauration documenté.

### 8.4 Multilingue dès le départ
- Toutes les tables portent un code de langue ; ajouter le haoussa ne doit demander **aucune modification du code**, seulement de la configuration (nouvelle langue, nouvelles phrases, nouveau texte de consentement traduit, nouvelle vidéo).
- Les numéros de voix sont séquentiels par langue.

---

## 9. Modèle de données (à affiner)

- `languages` : code, nom, actif.
- `consent_versions` : id, langue, version, texte, audio, date de publication.
- `invites` : id, jeton haché, langue, recruteur, libellé interne, statut, expiration.
- `speakers` : id, numéro (`V023`), langue, sexe, tranche d'âge, région, langue maternelle, téléphone, recruteur, statut, lecture assistée (oui/non), voix d'examen (oui/non), voix principale (oui/non), dates.
- `identities` : speaker_id, nom, contact, consentement oral (clé du fichier) — **accès admin uniquement**.
- `consents` : speaker_id, version, cases cochées, horodatage, mode (écrit / oral).
- `sentences` : id (`S0457`), langue, texte, traduction française, thème, version, actif, nombre de lectures validées.
- `assignments` : speaker_id, sentence_id, date d'attribution, statut.
- `recordings` : id (UUID client), speaker_id, sentence_id, prise, type (`varie` / `principale`), clé de stockage, durée, fréquence, taille, hash, résultats des vérifications, suspect (oui/non), statut qualité, texte corrigé, motif de rejet, commentaire, vérificateur, dates.
- `reviews` : historique de chaque décision (y compris double écoute).
- `sentence_flags` : signalements « je n'arrive pas à lire ».
- `orthography_decisions` : mot, orthographe retenue, variantes, décidé par, date.
- `sessions_principale` : séances de la voix principale.
- `jobs` : file des tâches (type, charge utile, statut, tentatives, erreurs).
- `exports` : version, langue, type, date, statistiques, emplacement.
- `audit_log` : acteur, action, cible, date.
- `settings` : seuils de vérification, taille des lots, quotas.

---

## 10. Exigences non fonctionnelles

- **Mobile d'abord** : tester sur Chrome Android (y compris un téléphone d'entrée de gamme ancien), Safari iPhone, et un ordinateur pour l'espace équipe.
- **Accessibilité** : gros boutons, contraste élevé, icônes en plus du texte, consignes en audio quand c'est possible.
- **Gestion du micro** : demande d'autorisation expliquée ; si la personne refuse, un écran avec la marche à suivre pour réactiver le micro (Android et iPhone).
- **Résilience** : aucune perte d'audio en cas de coupure, de fermeture de l'onglet ou de batterie vide (tout ce qui est validé est déjà dans IndexedDB).
- **Performance** : écran d'enregistrement utilisable en moins de 3 secondes sur une connexion 3G.
- **Observabilité** : erreurs remontées dans Sentry, journal des tâches en échec, page de santé.
- **Tests** : tests unitaires (encodage WAV, vérifications audio, attribution des phrases), tests de bout en bout du parcours voix, et **test de charge** (k6 ou équivalent) simulant au moins 2 000 utilisateurs simultanés et 50 envois d'audio par seconde, avant le lancement.
- **Documentation** : un `README.md` qui explique comment installer, lancer en local, déployer, ajouter une langue, et restaurer une sauvegarde.

---

## 11. Hors périmètre pour l'instant
- Entraînement des modèles (fait à part, dans Colab ou Kaggle, à partir des exports).
- Pré-transcription automatique par un modèle (prévoir seulement le point d'extension).
- Paiement automatique des remerciements (crédit téléphonique) : suivi manuel suffisant.
- Application mobile native.

---

## 12. Jalons proposés

1. **J1 — Fondations** : choix de la pile validé, schéma de base, sécurité au niveau des lignes, authentification de l'équipe, CI, déploiement d'un « bonjour » en production.
2. **J2 — Parcours voix** : invitation, consentement, fiche, tutoriel, test, enregistrement WAV dans le navigateur, envoi direct au stockage, file hors ligne, reprise.
3. **J3 — Espace équipe** : import des phrases, recrutement, validation des tests, file d'écoute, vérification, réenregistrements.
4. **J4 — Qualité** : vérifications automatiques côté serveur (worker), double écoute, quotas, alertes.
5. **J5 — Voix principale** : mode séances, audio de référence, verrou entre séances.
6. **J6 — Données** : exports, partition d'examen, dépôt privé Hugging Face, sauvegardes, retrait d'une voix.
7. **J7 — Charge et lancement** : tests de charge, corrections, test complet par les 5 membres de l'équipe (chacun enregistre ses 150 phrases), documentation.

À chaque jalon : montre-moi ce qui marche, ce qui reste, et les décisions que tu as prises.

---

## 13. Comment travailler avec moi
- Pose-moi tes questions avant de commencer, et chaque fois qu'un choix change le coût, la sécurité ou l'expérience des voix.
- Explique tes choix simplement : nous sommes étudiants en informatique, pas encore experts en production.
- Petits commits clairs, une fonctionnalité à la fois.
- Ne mets jamais de clé secrète dans le code ; utilise des variables d'environnement et un fichier `.env.example`.
