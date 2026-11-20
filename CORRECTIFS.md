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
| 3 | Au oui/non, une mauvaise réponse ne coûtant rien, il était toujours gagnant de répondre pour toute la liste | 10 noms au plus par joueur, avec un compteur et un blocage dans l'interface. Aucune pénalité n'a été ajoutée, pour garder la règle « on ne perd jamais de points » |
| 4 | L'admin, qui joue aussi, pouvait changer les probabilités jusqu'à la clôture, après avoir vu les autres parier | Probabilités, coefficient et barème sont figés dès le premier pari posé. On peut encore ajouter des noms à un oui/non ou à « Mon vote » tant que le pari est ouvert |

La page Règles, l'aide de l'administration, le README et le texte du pari des parrainages ont été mis à jour en conséquence.

Ce qui n'a pas changé : le barème des estimations, et le fait que le tableau de bord PocketBase (`/_/`) montre tous les pronos à qui y a accès. Le code ne peut pas empêcher ce second point. Le plus sûr est de confier l'administration à quelqu'un qui ne joue pas.

## Nouveauté : pseudo modifiable

Un joueur peut changer de pseudo dans son Profil (route `/api/jeu/pseudo`). Les règles sont les mêmes qu'à l'inscription : 2 à 30 caractères, et pas deux pseudos identiques, même en changeant les majuscules. Les pronos, duels et classements désignent les joueurs par leur identifiant : changer de pseudo ne casse rien. Modifier le pseudo, le rôle ou la guilde directement par l'API de PocketBase reste interdit.
