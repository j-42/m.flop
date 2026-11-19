# Monsieur Flop, politiques et manigances

Jeu de pronostics entre amis sur la présidentielle 2027. Les joueurs parient sur les étapes de l’élection : parrainages, podium, flop 3, participation, vainqueur. Ils gagnent des points selon la probabilité de leurs réponses et montent en grade. Ils sont regroupés en guildes, s’affrontent en duels et décrochent des trophées. Il n’y a ni argent ni mise.

L’application tient dans un seul conteneur : PocketBase, qui gère le serveur web, la base SQLite, les comptes et le tableau de bord d’administration, plus le code du jeu.

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

Les données du volume sont conservées. La migration de la base ne s’exécute qu’une fois : elle ne réinitialise rien lors des mises à jour.

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
| Nom, sous-titre, grades, calendrier, sons par défaut | `pb_public/config.js` | Après reconstruction de l’image |
| Guildes, candidats, paris, probabilités, résultats | Dans le jeu, Profil puis Administration | Immédiate |

Sans fichier `perso/affiche.jpg`, l’accueil s’affiche sans image.

## Administrer le jeu

### Avant d’inviter

1. Dans **Profil**, puis **Administration**, onglet **Paris**, ouvrir chaque brouillon.
2. Vérifier les dates, remplir une probabilité par réponse, cocher **Publié** et enregistrer. La publication est refusée tant qu’une probabilité manque, ou si les probabilités d’un pari à choix ne font pas environ 100 % (100 % par place pour un classement, à 5 points près). Dès qu’un joueur a parié, les probabilités et le coefficient sont figés : les vérifier avant d’ouvrir le pari.
3. Les paris du 1er tour attendent la liste officielle du Conseil constitutionnel. Le moment venu, mettre à jour le statut des candidats dans l’onglet **Candidats**, puis utiliser **Ajouter les officiels seulement** dans chaque pari.
4. Onglet **Invitations** : créer un code par personne, ou un code de groupe utilisable plusieurs fois. **Copier l’invitation** prépare un message avec le lien et le code.

Dates retenues dans le catalogue, à confirmer par le décret de convocation des électeurs :

| Étape | Date | Statut |
|---|---|---|
| Fin de la collecte des parrainages | 12 mars 2027, 18 h | Estimation |
| Ouverture des paris du 1er tour | 16 mars 2027 | Estimation |
| 1er tour | 18 avril 2027, clôture à 20 h | Date annoncée |
| 2nd tour | 2 mai 2027, clôture à 20 h | Date annoncée |

### Pendant le jeu

**Résultats** : un pari clos apparaît avec un bouton rouge **Résultat**. Saisir le résultat calcule les points de tout le monde. Une nouvelle saisie corrige et recalcule. **Annuler le résultat** remet les points de ce pari à zéro.

**Mon vote** : à la saisie du résultat, les pourcentages officiels peuvent être renseignés. Au 1er tour, ils servent au trophée du Grand Déçu.

**2nd tour** : après le 1er tour, ajouter les deux finalistes aux paris « Qui sera élu ? » et « Mon vote au 2nd tour », remplir les probabilités et publier.

**Mot de passe oublié** : dans le tableau de bord `/_/`, collection `users`, ouvrir le joueur et saisir un nouveau mot de passe.

**Co-admin** : onglet **Joueurs** de l’administration du jeu.

Les règles complètes, côté joueur, sont dans la page **Règles** de l’application : calcul des points, types de paris, grades, duels, guildes, trophées.

## Structure du dépôt

```
Dockerfile            Image : PocketBase vérifié + code du jeu
docker-compose.yml    Service, volume de données, durcissement
pb_migrations/        Création de la base au premier démarrage
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
| Publication refusée | Une probabilité manque, leur total s’écarte trop de 100 %, ou pas assez de réponses |
| Modification refusée | Des joueurs ont déjà parié : probabilités, coefficient et barème sont figés |
| Saisie du résultat refusée | Le pari n’est pas encore clos |
| Architecture non prise en charge au build | Construire pour `linux/amd64`, `linux/arm64` ou `linux/arm/v7` |

## Licences

PocketBase : licence MIT. Polices Shantell Sans et Caveat : SIL Open Font License, textes dans `pb_public/fonts/`.
