# Monsieur Flop, politiques et manigances

Jeu de pronostics entre amis sur la présidentielle 2027. Les joueurs parient sur les étapes de l’élection : parrainages, podium, flop 3, scores, abstention, vote blanc, vainqueur. Ils gagnent des points selon la probabilité de leurs réponses et montent en grade. Ils sont regroupés en guildes, s’affrontent en duels et décrochent des trophées. Il n’y a ni argent ni mise.

L’application tient dans un seul conteneur : PocketBase, qui gère le serveur web, la base SQLite, les comptes et le tableau de bord d’administration, plus le code du jeu.

Ce dépôt est un fork de [j-42/m.flop](https://github.com/j-42/m.flop). Les bugs corrigés et les règles modifiées depuis sont listés dans [CORRECTIFS.md](CORRECTIFS.md).

## Déploiement

### Prérequis

Docker et Docker Compose v2. Plateformes prises en charge : `linux/amd64`, `linux/arm64` (Raspberry Pi 4 ou 5 en 64 bits), `linux/arm/v7`. La construction de l’image télécharge PocketBase 0.40.6 depuis GitHub et vérifie son empreinte SHA-256.

### Lancer

```bash
git clone <url-du-depot> monsieur-flop
cd monsieur-flop
docker compose up -d --build
```

Le jeu répond sur le port 8090. Pour changer le port côté hôte :

```bash
FLOP_PORT=8123 docker compose up -d --build
```

Vérifier l’état du conteneur, qui doit afficher `healthy` :

```bash
docker compose ps
```

### Mise en ligne

Le conteneur parle en HTTP. Il faut le placer derrière un reverse proxy ou un tunnel qui fournit le HTTPS, indispensable puisque des mots de passe circulent. Si le proxy tourne sur la même machine, publier le port uniquement en local en remplaçant la ligne `ports` du `docker-compose.yml` par :

```yaml
      - "127.0.0.1:${FLOP_PORT:-8090}:8090"
```

Le jeu limite les tentatives de connexion et d’inscription par adresse IP. Derrière un proxy, il faut donc indiquer à PocketBase l’en-tête qui porte la vraie adresse des visiteurs. Sans ce réglage, la limite s’applique à tous les joueurs à la fois. Pour le faire :

1. Ouvrir le tableau de bord sur `/_/`.
2. Aller dans **Settings**, puis **Application**.
3. Dans la rubrique **IP proxy headers**, remplir **Trusted IP proxy headers**. Mettre `X-Forwarded-For` pour la plupart des proxys, `CF-Connecting-IP` derrière Cloudflare.

Le tableau de bord propose l’en-tête qu’il détecte.

### Premier démarrage

Au premier lancement, la base est créée automatiquement. Elle contient 9 guildes, 38 candidats déclarés et 10 paris en brouillon, avec la limitation des tentatives et la sauvegarde quotidienne déjà activées.

**1. Créer le superutilisateur du tableau de bord `/_/`.** Il sert aux réglages techniques, aux mots de passe oubliés et aux sauvegardes :

```bash
docker compose exec monsieur-flop /pb/pocketbase superuser upsert admin@exemple.fr 'UnMotDePasseLongEtUnique'
```

Autre possibilité : ouvrir le lien d’installation affiché dans `docker compose logs monsieur-flop`.

**2. Créer le compte admin du jeu.** Le tout premier compte inscrit dans l’application devient automatiquement admin du jeu, sans code d’invitation. L’organisatrice doit le créer avant d’envoyer la moindre invitation.

### Données et sauvegardes

Tout l’état du jeu se trouve dans le volume `flop_data`, monté sur `/pb/pb_data` : la base, les comptes, les paris et les sauvegardes. Le reste du conteneur est en lecture seule.

Une sauvegarde complète est faite chaque nuit à 4 h, et les 14 dernières sont conservées dans le volume. Pour les copier hors de la machine :

```bash
docker compose cp monsieur-flop:/pb/pb_data/backups ./sauvegardes
```

La restauration se fait depuis le tableau de bord `/_/`, rubrique des sauvegardes dans les réglages.

Attention : `docker compose down -v` supprime le volume, donc toutes les données du jeu. `docker compose down` sans `-v` les conserve.

### Mettre à jour

```bash
git pull
docker compose up -d --build
```

Les données du volume sont conservées. Chaque migration de la base ne s’exécute qu’une fois : elle ne réinitialise rien lors des mises à jour.

### Sécurité

Le conteneur est durci de plusieurs façons :

- utilisateur non root, uid 10001 ;
- système de fichiers en lecture seule ;
- aucune capacité Linux ;
- `no-new-privileges` ;
- journaux Docker limités à 30 Mo.

Côté application :

- les collections ne sont pas accessibles directement, tout passe par les routes du jeu, qui vérifient les droits et les dates de clôture ;
- les paris des autres restent secrets jusqu’à la clôture ;
- l’inscription se fait uniquement par code d’invitation ;
- les mots de passe font 10 caractères minimum ;
- les pages sont servies avec une politique de sécurité du contenu stricte : aucune ressource externe n’est chargée, polices comprises.

## Personnalisation

| Quoi | Où | Prise en compte |
|---|---|---|
| Image d’accueil | `perso/affiche.jpg` | Après reconstruction de l’image |
| Musique de fond, sons par bord politique, son « Valider » | Dossier `perso/sons/`, voir [Sons et musique](#sons-et-musique) | Après reconstruction de l’image |
| Nom, sous-titre, grades, calendrier, sons par défaut | `pb_public/config.js` | Après reconstruction de l’image |
| Guildes, candidats, intentions de vote, paris, résultats | Dans le jeu, Profil puis Administration | Immédiate |

Sans fichier `perso/affiche.jpg`, l’accueil s’affiche sans image.

## Administrer le jeu

### Avant d’inviter

1. Dans **Profil**, puis **Administration**, onglet **Candidats** : c’est le tableau unique du scrutin. Cliquer sur **Importer les intentions de vote**, ajuster les valeurs si besoin, remplir la cote des 500 signatures de chaque candidat, puis **Enregistrer le tableau**.
2. Onglet **Paris**, ouvrir chaque brouillon. Les paris de départ sont reliés au tableau : leurs réponses et leurs cotes en viennent. Vérifier les dates, cocher **Publié** et enregistrer. Dès qu’un joueur a parié, les cotes et le coefficient sont figés : les vérifier avant d’ouvrir le pari.
3. Un pari non relié se remplit à la main : une probabilité par réponse. La publication est alors refusée tant qu’une probabilité manque, ou si les probabilités d’un pari à choix ne font pas environ 100 % (100 % par place pour un classement, à 5 points près).
4. Onglet **Invitations** : créer un code par personne, ou un code de groupe utilisable plusieurs fois. **Copier l’invitation** prépare un message avec le lien et le code.

Dates retenues dans le catalogue, à confirmer par le décret de convocation des électeurs :

| Étape | Date | Statut |
|---|---|---|
| Fin de la collecte des parrainages | 12 mars 2027, 18 h | Estimation |
| Ouverture des paris du 1er tour | 16 mars 2027 | Estimation |
| 1er tour | 18 avril 2027, clôture à 20 h | Date annoncée |
| 2nd tour | 2 mai 2027, clôture à 20 h | Date annoncée |

### Le tableau des candidats

Une ligne par candidat : statut, bord politique, cote des 500 signatures, intentions de vote au 1er et au 2nd tour, scores réels des deux tours. Sous le tableau : vote blanc (en % des votants) et abstention (en % des inscrits) des deux tours.

**Import des intentions de vote.** Le serveur du jeu lit le fichier `data/sondages.json` du dépôt public [2027etmoi/2027etmoi](https://github.com/2027etmoi/2027etmoi) (Licence ouverte), qui reprend les sondages du 1er tour déposés à la Commission des sondages sur environ sept semaines. Pour chaque candidat : moyenne des hypothèses de chaque sondage, puis moyenne des sondages. Les candidats sont rapprochés par leur nom ; le compte rendu liste ceux qui n’ont pas pu l’être. L’import renseigne aussi le bord politique des candidats qui n’en ont pas : celui de la source, les souverainistes en « autre », et l’extrême gauche repérée par le parti (Lutte ouvrière, NPA, Révolution permanente).

**Ajouter ou supprimer un candidat.** Dans le tableau, **Ajouter un candidat** crée une ligne, **Supprimer** marque une ligne : les deux sont appliqués à l’enregistrement. Un candidat qui figure dans un pari où des joueurs ont parié ne peut pas être supprimé : le passer en « Retiré ». Le conteneur doit pouvoir joindre `raw.githubusercontent.com` en HTTPS. Les intentions du 2nd tour se saisissent à la main.

**Cotes calculées.** Pour les paris du 1er tour (en tête, podium, flop 3, pire score), le jeu simule 10 000 fois le scrutin à partir des intentions de vote, avec un écart type de 0,5 + 0,12 × l’intention (environ 4 points pour un candidat à 30 %). Un candidat sans intention compte pour 0,5 %. Les cotes sont bornées entre 1 et 99 %. Pour l’élu, la cote vient de la part du premier finaliste dans les intentions du 2nd tour, avec un écart type de 3,5 points. Les candidats du 1er tour sont ceux au statut « Sur la liste officielle », ou à défaut les déclarés.

**Paris reliés.** Dans l’éditeur d’un pari, le champ **Relié au tableau des candidats** choisit d’où viennent ses réponses, ses cotes et son résultat. Tant que personne n’a parié, les réponses et les cotes suivent le tableau à chaque enregistrement. Ensuite elles sont figées ; seuls de nouveaux noms peuvent encore être ajoutés à un oui/non ou à « Mon vote » ouvert. Les finalistes du 2nd tour sont les deux candidats du 1er tour qui ont les meilleurs scores saisis dans la colonne Score T1. Le jeu ne gère pas le cas d’un candidat élu dès le 1er tour.

**Résultats.** Trois cases dans le tableau : liste officielle publiée, résultats du 1er tour définitifs, résultats du 2nd tour définitifs. Une fois la case cochée et le tableau enregistré, les paris reliés et clos sont résolus et les points calculés. Le serveur refait cette vérification toutes les 10 minutes, pour les paris qui ferment après la saisie. Corriger un score ensuite recalcule les points.

### Pendant le jeu

**Résultats des paris non reliés** : un pari clos apparaît avec un bouton rouge **Résultat**. Saisir le résultat calcule les points de tout le monde. Une nouvelle saisie corrige et recalcule. **Annuler le résultat** remet les points de ce pari à zéro.

**2nd tour** : saisir les scores du 1er tour et les intentions de vote du 2nd tour pour les deux finalistes, enregistrer le tableau, puis publier « Qui sera élu ? », « Mon vote au 2nd tour » et les paris du 2nd tour.

**Mot de passe oublié** : dans le tableau de bord `/_/`, collection `users`, ouvrir le joueur et saisir un nouveau mot de passe.

**Co-admin, changement de guilde** : onglet **Joueurs** de l’administration du jeu. Changer la guilde d’un joueur fait compter tous ses points pour sa nouvelle guilde.

**Duels** : un joueur lance un seul duel par pari, mais peut être défié par plusieurs joueurs. Le gagnant reçoit 20 points de bonus (`BONUS_DUEL` dans `pb_hooks/jeu_lib.js`), le perdant ne perd rien. Le bonus compte dans le classement, les grades et les trophées.

Les règles complètes, côté joueur, sont dans la page **Règles** de l’application : calcul des points, types de paris, grades, duels, guildes, trophées.

### Sons et musique

Les fichiers son ne sont pas fournis : ils se déposent dans le dossier `perso/`. Utiliser des sons libres de droits ou faits soi-même.

```
perso/
  sons/
    musique.mp3               musique de fond, en boucle
    extreme_gauche/           un dossier par bord politique
    gauche/
    ecolo/
    centre/
    droite/
      cloche.mp3
      Vive la France 2.mp3
      applaudissements.ogg
    extreme_droite/
    autre/
    valider/                  sons du bouton « Valider mon pari »
      valider.mp3
```

Les fichiers `.gitkeep` des dossiers servent à les garder dans Git quand ils sont vides ; le jeu les ignore.

**Sons par bord.** Quand un joueur choisit un candidat (bulletin, oui ou non, classement, menu de « Mon vote »), le jeu lit le bord de ce candidat dans le tableau des candidats et joue un fichier tiré au hasard dans le dossier de ce bord. Le tirage est refait à chaque clic. Si un nouveau son part avant la fin du précédent, le précédent s’arrête.

- Autant de fichiers que voulu par dossier, noms libres, espaces et accents compris.
- Formats acceptés : `.mp3`, `.ogg`, `.wav`, `.m4a`. Les autres fichiers sont ignorés, de même que les fichiers dont le nom commence par un point et les sous-dossiers.
- Durée conseillée : une à deux secondes, pour ne pas gêner quand on enchaîne les clics. Il n’y a pas de limite technique.
- Dossier vide ou absent, ou candidat sans bord : le petit « pop » habituel.

**Son « Valider mon pari ».** Les fichiers du dossier `perso/sons/valider/`, tirés au hasard s’il y en a plusieurs. Un fichier `perso/sons/valider.mp3` placé directement dans `sons/` est aussi accepté. Sans fichier : le bruit de tampon habituel.

**Musique de fond.** `perso/sons/musique.mp3` (ou `musique.ogg`, `musique.m4a`), jouée en boucle, à faible volume par défaut. Les navigateurs n’autorisent le son qu’après une première action sur la page : la musique démarre au premier clic.

**Volumes.** Le bouton en forme de haut-parleur, en haut de l’écran, ouvre deux curseurs : volume de la musique (25 par défaut, discret) et volume des bruitages (70 par défaut), de 0 à 100. À 0, c’est coupé. Les bruitages regroupent les sons des bords, le son « Valider » et les sons fabriqués par le navigateur. Chaque joueur règle les siens ; ils sont gardés dans son navigateur. Sans fichier de musique, le curseur de la musique est grisé.

**Prise en compte.** À l’ouverture du site, le serveur lit le contenu de ces dossiers et envoie la liste des fichiers au navigateur. Les fichiers sont copiés dans l’image Docker à la construction. Après chaque ajout ou suppression :

1. reconstruire l’image : `docker compose up -d --build` ;
2. chaque joueur recharge la page.

## Structure du dépôt

```
Dockerfile            Image : PocketBase vérifié + code du jeu
docker-compose.yml    Service, volume de données, durcissement
pb_migrations/        Création de la base, puis évolutions (tableau des candidats)
pb_hooks/             Règles du jeu côté serveur (points, secret, duels, trophées, admin)
pb_public/            Interface web (HTML, CSS, JavaScript sans compilation)
perso/                Image d’accueil
```

## Dépannage

| Symptôme | Piste |
|---|---|
| Le conteneur n’est pas `healthy` | `docker compose logs monsieur-flop` |
| « Trop de tentatives » pour tout le monde | En-tête de proxy de confiance non renseigné, voir Mise en ligne |
| Un pari n’apparaît pas aux joueurs | Brouillon, ou date d’ouverture pas encore passée |
| Publication refusée | Une probabilité manque, leur total s’écarte trop de 100 %, ou pas assez de réponses. Pour un pari relié : une cote manque dans le tableau |
| Import des sondages impossible | Le conteneur n’a pas accès à `raw.githubusercontent.com` |
| Pari relié sans réponses | Enregistrer le tableau ; pour le 2nd tour, saisir d’abord les scores du 1er tour |
| Modification refusée | Des joueurs ont déjà parié : probabilités, coefficient et barème sont figés |
| Saisie du résultat refusée | Le pari n’est pas encore clos |
| Architecture non prise en charge au build | Construire pour `linux/amd64`, `linux/arm64` ou `linux/arm/v7` |

## Licences

PocketBase : licence MIT. Polices Shantell Sans et Caveat : SIL Open Font License, textes dans `pb_public/fonts/`.
