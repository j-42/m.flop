# Correctifs

Ce fork part de la première version de [j-42/m.flop](https://github.com/j-42/m.flop) (commit `6ea36e9`). Ce fichier liste ce qui a été corrigé ou changé depuis, et pourquoi.

Chaque point a été vérifié sur un PocketBase lancé en local, par des requêtes sur l'API du jeu. Pour les bugs, les mêmes tests ont aussi été lancés sur le code d'origine, pour confirmer qu'ils y échouaient.

## Bugs et fuites corrigés

Commit `39d1056`.

| # | Problème | Effet constaté | Correction | Fichier |
|---|---|---|---|---|
| 1 | Les trophées Kamikaze et Girouette comptaient aussi les paris encore ouverts | En surveillant le classement, on voyait qui venait de parier sur une réponse à moins de 10 %, alors que les paris doivent rester secrets jusqu'à la clôture | Les trophées ne tiennent compte que des paris clos ou résolus | `pb_hooks/jeu_lib.js`, `calculerTrophees` |
| 2 | Un admin pouvait repousser la date de clôture d'un pari déjà clos | Le pari se rouvrait alors que les pronos de tous avaient déjà été dévoilés : chacun pouvait corriger le sien | Un pari clos avec des mises ne peut plus être rouvert | `pb_hooks/jeu_lib.js`, `verifierModifPari` |
| 3 | Un admin pouvait retirer d'un pari une réponse déjà choisie par des joueurs | Les joueurs concernés obtenaient 0 point sans être prévenus | Une réponse choisie par au moins un joueur ne peut plus être retirée | `pb_hooks/jeu_lib.js`, `verifierModifPari` |
| 4 | « Annuler le résultat » était accepté sur un pari sans résultat | Un brouillon passait en « publié » sans le contrôle des probabilités fait à la publication | Refusé si le pari n'est pas résolu | `pb_hooks/main.pb.js`, `/api/jeu/admin/annuler-resultat` |
| 5 | À l'inscription, le premier compte et les utilisations d'un code étaient vérifiés hors de la transaction | 8 inscriptions simultanées sur une base vide créaient 8 admins, et un code à usage unique servait 8 fois | Les vérifications sont refaites dans la transaction : 1 seul admin, 1 seule utilisation | `pb_hooks/main.pb.js`, `/api/jeu/inscription` |

## Règles du jeu rééquilibrées

Commit `9d02540`.

| # | Problème | Changement |
|---|---|---|
| 1 | Un duel se lançait contre n'importe qui, y compris un joueur qui n'avait pas parié. Défier tous les inactifs donnait des victoires sans risque et le trophée du Duelliste | Un duel où l'un des deux n'a pas parié est annulé à la résolution et ne compte pour personne. Avant la résolution, il reste « en cours », pour ne pas révéler qui a parié |
| 2 | Avec 10 ÷ probabilité, une réponse à 1 % rapportait 1 000 points : un seul outsider pouvait décider du classement. Le serveur ne vérifiait pas non plus que les probabilités d'un pari faisaient 100 % | Gain plafonné à 300 points par réponse, avant coefficient (le plafond joue sous 3,4 % environ). La publication d'un pari à choix est refusée si ses probabilités ne font pas 100 % à 5 points près, ou 100 % par place pour un classement |
| 3 | Au oui/non, une mauvaise réponse ne coûtant rien, il était toujours gagnant de répondre pour toute la liste | 10 noms au plus par joueur, avec un compteur et un blocage dans l'interface. Aucune pénalité n'a été ajoutée, pour garder la règle « on ne perd jamais de points ». Limite retirée depuis, voir plus bas |
| 4 | L'admin, qui joue aussi, pouvait changer les probabilités jusqu'à la clôture, après avoir vu les autres parier | Probabilités, coefficient et barème sont figés dès le premier pari posé. On peut encore ajouter des noms à un oui/non ou à « Mon vote » tant que le pari est ouvert |

La page Règles, l'aide de l'administration, le README et le texte du pari des parrainages ont été mis à jour en conséquence.

Ce qui n'a pas changé : le barème des estimations, et le fait que le tableau de bord PocketBase (`/_/`) montre tous les pronos à qui y a accès. Le code ne peut pas empêcher ce second point. Le plus sûr est de confier l'administration à quelqu'un qui ne joue pas.

## Nouveauté : pseudo modifiable

Un joueur peut changer de pseudo dans son Profil (route `/api/jeu/pseudo`). Les règles sont les mêmes qu'à l'inscription : 2 à 30 caractères, et pas deux pseudos identiques, même en changeant les majuscules. Les pronos, duels et classements désignent les joueurs par leur identifiant : changer de pseudo ne casse rien. Modifier le pseudo, le rôle ou la guilde directement par l'API de PocketBase reste interdit.

## Tableau unique des candidats

Avant, chaque pari gardait sa propre copie de la liste des candidats, avec ses probabilités. Ajouter un candidat, le passer officiel, changer une probabilité ou saisir un résultat se faisait pari par pari.

L'onglet Candidats de l'administration devient un tableau unique. Pour chaque candidat : statut, cote des 500 signatures, intentions de vote au 1er et au 2nd tour, scores réels des deux tours. Sous le tableau : vote blanc et abstention réels des deux tours, et trois cases d'avancement (liste officielle publiée, résultats du 1er tour définitifs, résultats du 2nd tour définitifs).

| Changement | Détail | Fichiers |
|---|---|---|
| Paris reliés au tableau | Un pari peut être relié au tableau (`config.lien`). Ses réponses, ses cotes et son résultat en viennent. Tant que personne n'a parié, ils suivent le tableau. Ensuite ils sont figés, comme avant | `pb_hooks/jeu_lib.js`, `LIENS`, `optionsReliees`, `synchroniserParis` |
| Cotes calculées | Les cotes des paris du 1er tour sont déduites des intentions de vote par simulation : 10 000 tirages, écart type de 0,5 + 0,12 × l'intention, cotes bornées entre 1 et 99 %. L'élu : part du premier finaliste dans les intentions du 2nd tour, écart type de 3,5 points. Pour ces paris, le contrôle « les probabilités font 100 % » ne s'applique pas, la borne de 1 % pouvant faire dépasser le total | `cotesPremierTour`, `cotesSecondTour` |
| Import des sondages | Bouton qui lit les sondages du 1er tour publiés par 2027 et moi (Licence ouverte, d'après les notices de la Commission des sondages) et en fait la moyenne par candidat | `importerSondages`, route `/api/jeu/admin/import-sondages` |
| Résolution automatique | À l'enregistrement du tableau et toutes les 10 minutes, les paris reliés clos dont le résultat est connu sont résolus et les points calculés. Une correction de score recalcule les points | `synchroniserParis`, `cronAdd` dans `main.pb.js` |
| Finalistes | Les deux premiers des scores du 1er tour sont ajoutés aux paris du 2nd tour | `finalistes` |
| Migration | Champ `donnees` sur les candidats, collection `reglages`, type de pari `scores`. Les paris de départ sont reliés au tableau s'ils n'ont pas de pronos et n'ont pas été renommés. « Taux de participation au 1er tour » devient « Taux d'abstention au 1er tour » | `pb_migrations/1700000100_tableau_candidats.js` |

## Nouveaux paris

Nouveau type de pari « Scores » : le joueur donne le score de chaque candidat en %. Pour chaque candidat, il part de 100 points et en perd 10 par point d'écart (réglable), sans descendre sous 0. Il gagne la moyenne, au plus 100 points. Les points comptent pour le trophée du Sniper.

Paris ajoutés en brouillon par la migration : Scores du 1er tour, Vote blanc au 1er tour, Scores du 2nd tour, Taux d'abstention au 2nd tour, Vote blanc au 2nd tour.

## Autres changements

| # | Changement | Fichiers |
|---|---|---|
| 1 | Au oui/non, la limite de 10 noms par joueur est retirée : on répond pour autant de noms qu'on veut. Une mauvaise réponse ne coûte toujours rien | `pb_hooks/jeu_lib.js`, `pb_public/app.js` |
| 2 | Dans l'éditeur de pari, les dates se saisissent au format jj/mm/aaaa et hh:mm sur 24 heures, avec un calendrier en français. Le champ natif du navigateur suivait la langue du navigateur (format américain et AM/PM sur un navigateur en anglais) | `pb_public/app.js`, `pb_public/style.css` |

## Duels, guildes, sons, administration

| # | Changement | Fichiers |
|---|---|---|
| 1 | Duels : un joueur lance un seul duel par pari (il peut toujours être défié par d'autres). Le gagnant reçoit 20 points de bonus, compté dans le classement, les grades et les trophées. Le perdant ne perd rien, un match nul ne rapporte rien. Avant, défier tout le monde ne coûtait rien | `pb_hooks/jeu_lib.js` (`BONUS_DUEL`, `classementComplet`), `pb_hooks/main.pb.js` (`/api/jeu/duel`), `pb_public/app.js` |
| 2 | L'admin peut changer la guilde d'un joueur, dans l'onglet Joueurs | `/api/jeu/admin/guilde`, `adminJoueurs` |
| 3 | Bord politique de chaque candidat dans le tableau, renseigné à l'import des sondages pour les candidats qui n'en ont pas. Sept bords : extrême gauche, gauche, écologiste, centre, droite, extrême droite, autre | `BORDS`, `importerSondages` |
| 4 | Sons déposés dans `perso/sons/` : un son au hasard du bord du candidat choisi (bulletin, oui/non, classement, menu « Mon vote »), un son pour « Valider mon pari », une musique de fond. Le bouton de l'en-tête ouvre deux curseurs de volume, musique (25 par défaut, discret) et bruitages, gardés dans le navigateur de chaque joueur | `/api/jeu/sons`, `pb_public/app.js`, `pb_public/index.html`, `perso/LISEZMOI.txt` |
| 5 | Tableau des candidats : ajout et suppression de candidats dans le tableau, appliqués à l'enregistrement ; colonne Rang retirée ; bloc d'import des sondages déplacé en bas | `pb_public/app.js`, `/api/jeu/admin/tableau` |
| 6 | Onglets de l'administration : l'onglet cliqué s'affiche tout de suite avec « Chargement… », et une réponse arrivée après un changement d'onglet est ignorée. Avant, la page s'élargissait mais l'ancien onglet restait affiché pendant le calcul des cotes | `vueAdmin`, `router` |
| 7 | Les cotes calculées sont gardées en cache dans `reglages` tant que les intentions de vote ne changent pas : le tableau s'ouvre sans refaire la simulation | `cotesT1` |
| 8 | Les paragraphes ne sont plus limités à 65 caractères de large | `pb_public/style.css` |

## Import des candidats et cotes des 500 signatures

| # | Changement | Fichiers |
|---|---|---|
| 1 | Nouveau statut de candidat « Pressenti » : cité dans les sondages, pas déclaré. Il n'entre dans aucun pari tant qu'il n'est pas déclaré | `pb_migrations/1700000200_statut_pressenti.js`, `STATUTS_CANDIDAT` |
| 2 | Bouton « Importer les candidats » : ajoute les déclarés et pressentis absents du tableau, avec parti et bord, et passe en « Retiré » ceux qui ont renoncé, d'après les données ouvertes de 2027 et moi. Ne touche pas aux candidats officiels, non retenus ou absents de la source | `importerCandidats`, route `/api/jeu/admin/import-candidats` |
| 3 | Bouton « Calculer les cotes des 500 signatures » : règle par paliers d'intention de vote, corrigée par le résultat de la dernière présidentielle du candidat (qualifié, ou nombre de parrainages obtenus) | `calculerCotesParrainages`, `coteParrainages`, route `/api/jeu/admin/cotes-parrainages` |

