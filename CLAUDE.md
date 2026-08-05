# Conventions du projet

## Stack

Next.js (App Router) · TypeScript strict · Tailwind CSS · Node.js · PostgreSQL via Prisma · Docker · Caddy

## Pipeline pour toute nouvelle feature

Séquentiel : chaque étape dépend de la précédente, à la seule exception de l'étape 5. Ne parallélise rien d'autre.

1. **explorer** — cartographie l'existant. Objectif : ne pas réécrire ce qui existe déjà.
2. **db-specialist** — *uniquement si la feature touche au modèle de données.* Schéma et migration validés avant d'écrire la moindre ligne applicative.
3. **implementer** — logique métier et couche serveur, sur un périmètre de fichiers explicitement listé.
4. **integrateur** — *uniquement s'il y a de l'UI visible.* Consomme ce qu'a produit l'implementer, ne touche pas à la logique.
5. **reviewer et security-auditor, lancés ensemble** — les deux lisent le même diff et ne modifient rien : il n'y a aucune dépendance de l'un à l'autre. Le reviewer produit une liste DRY / SOLID / mobile first / TypeScript classée par gravité, l'auditeur une liste classée par criticité.
6. **Arbitrage humain** — je lis les deux rapports et je décide ce qui est appliqué. Cette étape ne se saute pas.
7. **refactorer** — applique uniquement les points validés à l'étape 6.
8. **security-auditor, seconde passe** — périmètre réduit au seul diff du refactorer, sur le code tel qu'il sera mergé. Il s'agit de vérifier que les corrections n'ont rien ouvert, pas de refaire l'audit.

Les étapes 2 et 4 sont conditionnelles. Les étapes 5 à 8 ne le sont pas, même pour une petite feature.

Pourquoi la sécurité passe en 5 plutôt qu'en 8 seulement : un audit qui ne parle qu'après l'arbitrage force un second arbitrage et une seconde passe de refactoring. Remonter la première passe met les deux rapports sur la table en même temps, pour une décision unique. L'étape 8 reste, mais devient courte.

**Barrière de vérification.** L'implementer et l'integrateur ne rendent pas la main sans que `npm run verify` (lint, `tsc --noEmit`, tests) passe. Une faute mécanique doit être attrapée par le compilateur, pas par une revue en étape 5 : c'est gratuit, immédiat, et ça évite un aller-retour complet. S'ils ne peuvent pas lancer la commande, ils le disent au lieu de rendre un travail non vérifié.

Frontière entre implementer et integrateur : l'implementer s'arrête aux données et à la logique, l'integrateur commence aux composants. Si les deux doivent modifier le même fichier, le périmètre est mal découpé — redécoupe plutôt que de les laisser se marcher dessus.

Le parallélisme sert ailleurs aussi : pour explorer plusieurs modules indépendants d'un coup, demander explicitement plusieurs subagents explorer en parallèle. Le critère est le même que pour l'étape 5 — on ne lance ensemble que des agents qui n'attendent rien l'un de l'autre et qui n'écrivent pas dans les mêmes fichiers. Deux agents en lecture seule sur le même diff remplissent toujours ce critère ; deux agents qui écrivent, jamais.

## Règles de code

**Mobile first** — les classes Tailwind de base ciblent le mobile, les breakpoints ajoutent le desktop. Jamais l'inverse.

**DRY** — au-delà de deux occurrences, extraire. En dessous, laisser et signaler. Une abstraction à un seul appelant est un défaut, pas une qualité.

**SOLID** — une responsabilité par composant et par fonction. La logique métier vit dans des fonctions pures, hors des composants. Les dépendances sont importées depuis une source unique.

**TypeScript** — mode strict. Pas de `any`, pas de `as` pour faire taire le compilateur, pas de `@ts-ignore`.

**Validation** — toute entrée externe validée par un schéma avant usage.

**Requêtes Prisma** — `select` explicite dès qu'un modèle contient un champ sensible. Jamais de requête dans une boucle.

## Répartition des modèles

Le critère n'est pas l'importance de l'agent, mais le coût d'une erreur difficile à détecter.

| Agent | Modèle |
|---|---|
| explorer | haiku |
| db-specialist | opus, effort high |
| implementer | sonnet |
| integrateur | sonnet |
| reviewer | opus, effort high |
| refactorer | sonnet |
| security-auditor | opus, effort high |

Un implémenteur qui se trompe produit du code qui casse : c'est visible. Un auditeur sécurité qui rate une faille ne produit rien de visible du tout. D'où Opus sur les rôles de jugement et de détection, Sonnet sur l'exécution cadrée, Haiku sur la lecture en volume.

## Contraintes d'exécution
- Aucune dépendance installée sans validation préalable.
- Aucune migration lancée en base par un agent : le schéma est écrit, la commande est proposée, je l'exécute.
- Aucune modification de fichier hors du périmètre annoncé. En cas de besoin, s'arrêter et le signaler.
- Aucun commit ni push automatique.

## Revue des diffs

Je lis chaque diff avant de merger. Un agent ne merge pas à ma place.
