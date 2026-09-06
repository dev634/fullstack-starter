# Présentation

Cette application est un outil de **gestion de chantiers et de projets photovoltaïques** : elle centralise les **entreprises clientes**, leurs **contacts**, les **projets** (toiture, ombrière, centrale au sol…) et tout le suivi de chantier associé — **tâches**, **matériel**, **réserves** (snagging), **interventions**, **sous-traitants**, **intérimaires** et **fichiers**.

Elle propose aussi une **administration** complète (rôles, accès, branding), un **portail client** cloisonné, l'**import/export CSV**, un **journal d'activité**, la **réinitialisation de mot de passe** et une interface **bilingue (français / anglais)**.

## À qui s'adresse ce document

Ce document couvre l'ensemble du cycle de vie, **de l'installation à l'utilisation quotidienne** :

- l'installation et la configuration technique (développeur / administrateur système) ;
- l'utilisation fonctionnelle (administrateurs, éditeurs, lecteurs, clients).

## Pile technique

- **Framework** : Next.js 16 (App Router, Server Components & Server Actions)
- **Langage** : TypeScript, React 19
- **Base de données** : PostgreSQL, via l'ORM Prisma 7
- **Authentification** : Auth.js (NextAuth v5), sessions JWT
- **Style** : Tailwind CSS 4
- **Stockage d'images/fichiers** : Cloudinary
- **Validation** : Zod 4
- **Emails** (optionnel) : Resend
- **OCR** (optionnel) : Anthropic ou OpenAI, pour le scan des bons de livraison

# Prérequis

Avant l'installation, prévoir :

- **Node.js 20 ou supérieur** et **npm**.
- Un serveur **PostgreSQL** accessible (local ou distant).
- Un compte **Cloudinary** (offre gratuite suffisante) pour le stockage des photos et fichiers.
- *Optionnel* : un compte **Resend** pour l'envoi réel des emails de réinitialisation de mot de passe.
- *Optionnel* : une clé **Anthropic** ou **OpenAI** pour la reconnaissance des bons de livraison.
- *Optionnel* : un DSN **Sentry** pour le suivi des erreurs serveur.

Sans les services optionnels, l'application fonctionne : les liens de réinitialisation s'affichent alors dans la console, et le scan renvoie un message « non configuré » clair au lieu d'échouer.

# Installation

## Récupération du code

Cloner le dépôt puis installer les dépendances :

```
git clone <url-du-depot>
cd fullstack-starter
npm install
```

## Configuration de l'environnement

Copier le fichier d'exemple et le renseigner :

```
cp .env.example .env
```

Variables du fichier `.env` :

- **DATABASE_URL** — chaîne de connexion PostgreSQL, au format `postgresql://utilisateur:motdepasse@hote:5432/base?schema=public`.
- **AUTH_SECRET** — secret de chiffrement des sessions. Le générer avec `npx auth secret`.
- **CLOUDINARY_URL** — variable « API Environment variable » du tableau de bord Cloudinary, au format `cloudinary://api_key:api_secret@cloud_name`.
- **RESEND_API_KEY** et **EMAIL_FROM** *(optionnel)* — envoi des emails de réinitialisation. Sans elles, les liens sont écrits dans la console.
- **SENTRY_DSN** *(optionnel)* — suivi d'erreurs. Sans valeur, le SDK ne fait rien.
- **ANTHROPIC_API_KEY** *(optionnel)* — scan des bons de livraison (par défaut).
- **OCR_PROVIDER=openai** + **OPENAI_API_KEY** *(optionnel)* — utiliser OpenAI plutôt qu'Anthropic pour le scan.

## Base de données

Une fois `DATABASE_URL` renseignée, appliquer les migrations pour créer le schéma :

```
npx prisma migrate deploy
```

Puis générer le client Prisma (souvent fait automatiquement, sinon) :

```
npx prisma generate
```

Enfin, alimenter la base avec des données de démonstration et les comptes par défaut :

```
npm run db:seed
```

Le seed crée notamment :

- deux entreprises de démonstration avec leurs contacts ;
- trois comptes utilisateurs (voir « Comptes par défaut » ci-dessous).

Pour **réinitialiser complètement** la base (efface tout, rejoue les migrations et le seed) :

```
npm run db:reset
```

## Lancer l'application

En développement (rechargement à chaud) :

```
npm run dev
```

L'application est alors disponible sur `http://localhost:3000`.

En production :

```
npm run build
npm start
```

## Comptes par défaut (démonstration)

Après le seed, trois comptes existent, tous avec le mot de passe **`password123`** — **à changer impérativement hors développement** :

- **superadmin@example.com** — rôle Super administrateur (accès total).
- **admin@example.com** — rôle Administrateur.
- **editor@example.com** — rôle Éditeur.

## Scripts utiles

- `npm run dev` — serveur de développement.
- `npm run build` / `npm start` — build et démarrage en production.
- `npm run db:seed` — insère les données de démonstration.
- `npm run db:reset` — réinitialise la base (migrations + seed).
- `npm run prisma:studio` — ouvre Prisma Studio pour explorer la base.
- `npm run lint` — analyse statique (ESLint).
- `npm test` — lance les tests unitaires (Vitest).

# Concepts et rôles

## Hiérarchie des rôles

L'application définit cinq rôles, du plus au moins privilégié :

- **SUPERADMIN (Super administrateur)** — accès total, seul à pouvoir configurer la matrice des accès, le thème et l'ordre des sections.
- **ADMIN (Administrateur)** — gère le contenu, les utilisateurs et les fonctions.
- **EDITOR (Éditeur)** — crée et modifie le contenu (entreprises, projets, tâches…), sans accès à l'administration sensible.
- **VIEWER (Lecteur)** — consultation seule.
- **CLIENT** — accès externe **cloisonné** au **portail client** ; ne voit que les projets qui lui sont rattachés (voir chapitre « Portail client »).

Un rôle supérieur possède toujours les droits d'un rôle inférieur.

## Matrice « Rôles & accès »

Le comportement n'est pas figé : un Super administrateur peut configurer, dans **Administration → Rôles & accès**, le **rôle minimum requis** pour chaque **capacité** de l'application (créer/modifier du contenu, corbeille, import, journal d'activité…). Par défaut, ces valeurs reproduisent le comportement standard décrit ci-dessus.

Trois capacités sont **verrouillées et non délégables** — « Paramètres & accès », « Gérer les fonctions » et « Gérer les utilisateurs » : elles configurent le modèle d'accès lui-même, donc les déléguer reviendrait à déléguer le droit de s'attribuer tous les autres. Dans le même esprit, **personne ne peut modifier la fonction qui le restreint** : ni en éditant sa propre fonction, ni en rattachant son compte à une autre. Seul un Super administrateur peut le faire pour quelqu'un d'autre — c'est la sortie de secours qui évite de se verrouiller dehors.

![La matrice « Rôles & accès » : rôle minimum requis pour chaque capacité.](screenshots/admin-roles.png)

## Fonctions (métiers)

Une liste de **fonctions** (manœuvre, électricien, chef de chantier…) est gérée dans **Administration → Fonctions**. Chaque fonction peut être **assignée** à un utilisateur ou à un contact, et sert aussi à **piloter la visibilité des sections** d'un projet (voir ci-dessous).

![La gestion des fonctions (métiers), réordonnables par glisser-déposer.](screenshots/admin-fonctions.png)

## Visibilité des sections par fonction

Pour chaque fonction, un administrateur peut choisir **quelles sections de la page projet** sont visibles par les utilisateurs qui la portent (Tâches, Matériel, Réserves, Interventions, Sous-traitants, Intérimaires, Fichiers). Les administrateurs voient toujours toutes les sections.

![Configuration des sections visibles pour une fonction.](screenshots/admin-sections-visibility.png)

# Utilisation

## Connexion et mot de passe

- **Se connecter** : depuis `/login`, avec l'email et le mot de passe.
- **Mot de passe oublié** : la page de connexion propose un lien ; un email (ou un lien en console, selon la configuration) permet de définir un nouveau mot de passe.
- **Se déconnecter** : bouton « Déconnexion » dans la barre de navigation.

![L'écran de connexion.](screenshots/login.png)

## Tableau de bord

La page d'accueil présente une synthèse : nombre d'entreprises par statut (prospect, client, inactif) et les dernières entreprises ajoutées.

![Le tableau de bord : indicateurs par statut et dernières entreprises ajoutées.](screenshots/dashboard.png)

## Entreprises (clients)

La rubrique **Entreprises** liste les sociétés clientes.

![La liste des entreprises, avec recherche, tri et actions (export, import, corbeille…).](screenshots/clients.png)

- **Créer / modifier** une entreprise : nom, email, téléphone, site web, adresse, statut (Prospect / Client / Inactif), photo.
- **Contacts** : chaque entreprise possède un ou plusieurs contacts (nom, email, téléphone, fonction). Un contact peut être marqué « principal ».
- **Rechercher** par nom d'entreprise ou de contact ; **trier** par nom, email ou ville.
- **Import / Export CSV** : exporter la liste, ou importer en masse à partir d'un fichier aux mêmes colonnes que l'export.
- **Corbeille** : la suppression place l'entreprise en corbeille (restaurable) ; la suppression définitive est irréversible.
- **Activité** : un journal trace les créations, modifications et suppressions.

![Le formulaire de création d'une entreprise.](screenshots/company-add.png)

![La fiche d'une entreprise, avec ses contacts.](screenshots/client-detail.png)

![L'import CSV : mêmes colonnes que l'export.](screenshots/import.png)

## Projets

Chaque entreprise possède des **projets**. Un projet comporte :

- un **nom**, un **numéro d'affaire**, un **type** (centrale au sol, ombrière, toiture, autre) et un **statut** (étude, signé, en cours, raccordement, terminé, annulé) ;
- des informations : **puissance** (kWc), **budget** (€), **adresse du chantier**, **dates** de début et de fin, **notes**.

![Le formulaire de création d'un projet.](screenshots/project-add.png)

> ⚠️ **Passage ci-dessous périmé (PR #206 à #213, septembre 2026) — à réécrire.**
> La page d'un projet n'affiche plus ces sections dépliées sur place : c'est
> désormais un **hub de cartes**, chacune menant à sa propre page (Tâches,
> Réserves, Fichiers, Personnel, Interventions). **Matériel** n'a plus de page
> à lui : il vit dans la page **Tâches**. **Sous-traitants** et **Intérimaires**
> sont réunis dans une seule page **Personnel**. Restent exacts : l'ordre des
> sections reste configurable (il ordonne les cartes), et la visibilité par
> fonction se règle toujours sur les **sept** clés listées ici. Les captures de
> cette section montrent l'ancienne organisation. Enfin, le bouton « Générer
> rapport PDF » imprime la page telle qu'elle est affichée : les sections du
> tableau de bord étant repliées au chargement, le rapport ne contient que
> leurs en-têtes tant qu'on ne les a pas ouvertes (défaut connu, voir
> `docs/CONVENTIONS.md`).

La page d'un projet est organisée en **sections dépliables**, dont l'ordre est configurable par un Super administrateur (Administration → Ordre des sections) :

- **Tâches** — suivi d'avancement (voir ci-dessous).
- **Matériel** — stock et suivi des matériaux.
- **Réserves** — plans PDF annotés de réserves géolocalisées.
- **Interventions** — visites planifiées.
- **Sous-traitants** — entreprises et personnel sous-traitants.
- **Intérimaires** — travailleurs temporaires.
- **Fichiers** — arborescence de dossiers et documents.

Un **tableau de bord projet** synthétise l'avancement, et un bouton **« Générer rapport PDF »** produit un rapport imprimable.

![La page d'un projet : en-tête, avancement et sections dépliables (tâches, matériel, réserves…).](screenshots/project.png)

![Le tableau de bord d'un projet : avancement global, par catégorie et détaillé.](screenshots/project-dashboard.png)

## Tâches

La section Tâches gère l'avancement du chantier :

- **Tâches simples** (case à cocher) ou **avec quantité** (ex. « 0 / 2894 panneaux »), l'avancement pondérant alors le pourcentage global.
- **Séries** : génération en masse de tâches suivant un motif (ex. « String 1 »… « String 27 »).
- **Catégories** et **groupes** pour organiser les tâches.
- **Assignation** : une tâche, une série ou une catégorie peut être confiée soit à un **sous-traitant**, soit à un **intérimaire** (exclusivement l'un ou l'autre).
- **Matériel lié** : un matériau peut être rattaché à une tâche/série/catégorie, avec une quantité requise qui pilote l'indicateur de stock (rouge / orange / vert).

![La section Tâches d'un projet, avec l'avancement.](screenshots/project-tasks.png)

## Réserves (snagging)

Inspiré des outils type FinalCad :

- on **importe un plan PDF** (une ou plusieurs planches, ex. un plan par niveau) ;
- on **pose des réserves** en cliquant sur le plan (position relative conservée quel que soit le zoom) ;
- chaque réserve a une **description**, un **statut** (ouverte / levée), une **position GPS** optionnelle et des **photos** ;
- le **libellé** et la **couleur** des deux statuts se règlent **par chantier**, via le bouton **« Réglages »** dans l'en-tête de la section Réserves (« Ouverte » peut devenir « À traiter », etc.). Un champ laissé vide revient au défaut de l'application. Qui peut écrire sur le chantier peut le configurer.

*Note* : l'affichage des plans PDF nécessite que la **diffusion des PDF** soit activée dans le compte Cloudinary.

## Scan de bon de livraison (OCR)

Depuis la section Matériel, le bouton **« Scanner un bulletin »** permet de photographier/téléverser un bon de livraison ; l'IA en extrait les lignes de matériel. Nécessite une clé Anthropic (par défaut) ou OpenAI (`OCR_PROVIDER=openai`).

## Fichiers

Chaque projet dispose d'une **arborescence de dossiers** : création de dossiers imbriqués, téléversement de fichiers, suppression. Les fichiers sont stockés sur Cloudinary.

# Portail client

Le **portail client** permet à un **contact** d'une entreprise de se connecter et de **consulter uniquement les projets qui lui sont rattachés**, sans accéder au reste de l'application.

## Donner un accès à un contact

Depuis la fiche d'un contact (page d'une entreprise) :

1. **Cocher les projets** de l'entreprise auxquels le contact doit avoir accès (« Projets accessibles »).
2. Cliquer sur **« Créer un accès portail »**. L'application crée un compte de connexion (rôle CLIENT) rattaché au contact et génère un **lien à usage unique** (valable 24 h).
3. **Transmettre ce lien** au contact pour qu'il définisse son mot de passe.

![Sur la fiche d'un contact : projets accessibles et création de l'accès portail.](screenshots/contact-portal.png)

## Côté client

Une fois connecté, le contact arrive sur **`/portail`** et ne voit que **ses projets liés**. Il peut ouvrir chaque projet pour en consulter l'identité, l'avancement et les réserves. Toute tentative d'accès à une autre page le renvoie au portail. Les informations sensibles (budget, notes internes) ne lui sont pas montrées.

![Le portail client : uniquement les projets rattachés au contact.](screenshots/portal.png)

![La vue projet côté client (consultation).](screenshots/portal-project.png)

*Note* : dans la version actuelle, le portail est en **consultation** ; les contributions du client (dépôt de fichier, commentaire…) constituent une évolution prévue, activable par la matrice des accès.

# Administration

Accessible via **Administration** dans la barre de navigation (selon les droits) :

- **Fonctions** — gérer la liste des métiers et, par fonction, les sections visibles.
- **Utilisateurs** — créer, modifier, supprimer les comptes ; attribuer un rôle et une fonction. Un acteur ne peut jamais attribuer ni gérer un rôle supérieur au sien, ni se supprimer lui-même, ni retirer le dernier Super administrateur.
- **Thème** *(Super admin)* — nom de l'application, logo, couleurs (aperçu en direct).
- **Ordre des sections** *(Super admin)* — glisser-déposer pour ordonner les sections de la page projet.
- **Rôles & accès** *(Super admin)* — la matrice capacité → rôle minimum décrite plus haut.

![La gestion des utilisateurs : rôle, fonction et garde-fous de privilèges.](screenshots/admin-users.png)

![L'onglet Thème : nom, logo et couleurs de l'application, avec aperçu.](screenshots/admin-theme.png)

![L'onglet Ordre des sections : glisser-déposer pour réordonner.](screenshots/admin-sections.png)

# Internationalisation

L'interface est disponible en **français** et en **anglais**. La bascule se fait via le sélecteur **FR / EN** de la barre de navigation. Le choix est mémorisé.

# Sécurité

- **Authentification** par Auth.js, sessions **JWT** signées (`AUTH_SECRET`).
- **Autorisation** par rôle et par **capacité** (matrice Rôles & accès), **plus** les restrictions de la fonction (rubriques, sections, projets). Les **lectures** sont contrôlées au même titre que les modifications : une page, un tableau de bord, une corbeille ou un journal n'affiche que ce que le périmètre autorise, le filtrage étant fait dans la requête et non à l'affichage.
- **Portail client cloisonné** : un compte CLIENT est confiné au portail et ne voit que ses projets liés (contrôle au niveau du proxy **et** des pages).
- **CSP à nonce** par requête pour limiter l'injection de scripts.
- **Limitation de débit** (rate limiting) persistée en base sur les tentatives de connexion et de réinitialisation.
- **Validation** systématique des entrées (Zod) côté serveur.

# Maintenance et développement

- **Migrations** : créer une migration à la main dans `prisma/migrations/…`, puis `npx prisma migrate deploy`. Régénérer le client avec `npx prisma generate`.
- **Tests** : `npm test` (unitaires, Vitest). Lancer depuis la racine du dépôt.
- **Qualité** : `npm run lint` (ESLint), TypeScript strict.
- **Explorer la base** : `npm run prisma:studio`.

# Dépannage

- **Les plans PDF des réserves ne s'affichent pas** → activer « Allow delivery of PDF and ZIP files » dans les paramètres de sécurité du compte Cloudinary.
- **Aucun email de réinitialisation reçu** → sans `RESEND_API_KEY`, le lien de réinitialisation est écrit dans la **console serveur** (comportement normal en développement).
- **Le scan de bulletin renvoie « non configuré »** → renseigner `ANTHROPIC_API_KEY` (ou `OCR_PROVIDER=openai` + `OPENAI_API_KEY`).
- **Erreur de connexion à la base** → vérifier `DATABASE_URL` et que PostgreSQL est démarré.
- **Un client voit trop / trop peu de projets** → vérifier les projets cochés sur sa fiche de contact et le rôle du compte lié.
