# Bureau partagé — réservations d'équipe

Application de réservation synchronisée avec une base de données commune SQLite.

## Publier pour l'équipe
1. Ouvrir [Render](https://dashboard.render.com/) puis **New > Blueprint** et sélectionner ce dépôt GitHub.
2. Render lira `render.yaml`. Définir la variable secrète `TEAM_PASSWORD` (au moins 10 caractères).
3. Confirmer le service avec **disque persistant** (offre payante). Ne pas utiliser un stockage éphémère.
4. Quand Render annonce le déploiement réussi, transmettre à l'équipe **l'URL Render** et le mot de passe.

GitHub ne fait qu'héberger le code : ce dépôt n'est **pas** le site de réservation en ligne.

## Tester sur son ordinateur
Node.js >= 22.13 requis. Sur PowerShell :

```powershell
$env:TEAM_PASSWORD="mot-de-passe-equipe-long"
npm start
```

Ouvrir http://localhost:3000.

## Salles
1 en bas à gauche, 2 en haut à gauche, 3 en haut au centre, 4 en bas à droite, 5 en haut à droite, 6 rectangle vert à droite. Le gris est la zone centrale non réservable. **La salle 6 dans la zone verte est une hypothèse à confirmer.**

Salles 1–2 : deux places ; salles 3–6 : une place.

## Fonctionnement
Le code d'équipe est partagé ; toute personne disposant de ce code peut consulter, créer, modifier ou supprimer **toutes** les réservations. Aucune gestion de comptes individuels n'est incluse. Réservations persistées sur le disque SQLite, transactions pour prévenir les surréservations, diffusion des changements en temps réel par SSE.
