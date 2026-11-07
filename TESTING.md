# Cas à tester

`npm test` couvre les règles pures et le client SMTP. `npm run e2e` rejoue les parcours ci-dessous dans Chromium headless, en desktop 1440 et mobile 375. Chaque bug corrigé ajoute son cas ici.

## Écrire

- Lien personnel dans l'adresse (`#t=…`) : il est retiré de la barre d'adresse et mémorisé. Lien inconnu : message « Lien inconnu ». Pas de lien : « boîte aux lettres privée ».
- Brouillon enregistré automatiquement, retrouvé après rechargement.
- Souhait long : il passe à la ligne, rien n'est tronqué (desktop et mobile).
- Entrée dans un souhait crée la ligne suivante. La croix retire la ligne.
- Détails d'un souhait : « + Détails » (pointillés) quand il n'y en a aucun, sinon « Détails ». Ouvert, l'encart propose « Taille, couleur, prix », « Lien (facultatif) » et « Où le trouver » (300 caractères, plusieurs lignes), et le focus va dans l'encart. Replié, un résumé en pastilles (précision, lieu avec épingle, « lien »). Sur mobile, le bouton passe sous le texte du souhait.
- Lien de souhait autre que `http(s)` : refusé avec un message clair.
- Plier sans aucun souhait : refusé, le focus va sur le premier souhait.

## Envoyer

- Pliage en trois, glissement dans l'enveloppe, rabat, cachet. « Reprendre ma lettre » ramène à l'écriture sans rien envoyer.
- « Envoyer au Père Noël » : envol, boîte aux lettres, toast. Un mail part vers l'autre personne avec **son** lien, jamais celui de l'expéditeur.
- Après envoi : `PUT /api/letter` et `POST /api/send` répondent 409.
- Échec SMTP : la lettre est quand même scellée, le toast le dit, Resend prend le relais si `RESEND_API_KEY` est défini. La boîte aux lettres affiche « Renvoyer le mail » ; un nouvel `POST /api/send` relance la notification au lieu de répondre 409.

## Avant l'ouverture

- La lettre de l'autre est scellée : un clic la fait trembler et affiche « Patience ». Son contenu n'est ni dans la page ni dans `/api/state`.
- Compte à rebours jours, heures, minutes, secondes ; l'en-tête affiche le même nombre de jours.
- Autre personne sans lettre : enveloppe en pointillés, texte « n'a pas encore envoyé sa lettre ».

## Le jour J

- À l'heure exacte, la page se met à jour seule (sans rechargement).
- Clic sur l'enveloppe : cachet qui se brise, rabat, lettre qui sort et se déplie, puis lecture. « Passer l'animation » va directement à la fin.
- Liens des souhaits ouverts dans un nouvel onglet avec `rel="noopener noreferrer"`.
- Détails à la lecture : « Précision : … », encadré « Où le trouver : … » avec épingle, « voir le lien ». Un champ vide n'affiche rien.
- Lettre ancienne, écrite avant « Où le trouver » (items sans champ `where` en base) : toujours lisible, ni encadré vide ni « undefined ». `e2e.sh` réécrit la lettre de Bob en base dans ce format avant l'ouverture.
- Relire sa propre lettre depuis la boîte aux lettres.
- Autre personne sans lettre : « n'a pas écrit de lettre ».
