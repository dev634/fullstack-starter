# Conventions du projet

## Stack

Next.js (App Router) · TypeScript strict · Tailwind CSS · Node.js · PostgreSQL via Prisma · Docker · Caddy

## Pipeline pour toute nouvelle feature

Séquentiel par défaut : chaque étape consomme la précédente. Seule l'étape 6 se parallélise.

1. **explorer** — cartographie l'existant. Objectif : ne pas réécrire ce qui existe déjà.
2. **db-specialist** — *uniquement si la feature touche au modèle de données.* Schéma et migration validés avant d'écrire la moindre ligne applicative.
3. **implementer** — logique métier et couche serveur, sur un périmètre de fichiers explicitement listé.
4. **integrateur** — *uniquement s'il y a de l'UI visible.* Consomme ce qu'a produit l'implementer, ne touche pas à la logique.
5. **Vérification live** — lancer l'app et exercer le vrai chemin utilisateur. Typecheck vert + tests verts + lint propre **ne prouvent pas que la feature marche** : deux fois déjà, tout était au vert sur du code qui ne fonctionnait pas. C'est cette étape qui attrape ce que le reste ne peut pas voir.
6. **reviewer + security-auditor, EN PARALLÈLE** — les deux lisent le même diff final, en lecture seule, sans dépendance entre eux. Les lancer ensemble donne **un seul tour d'arbitrage au lieu de deux** (vécu : le reviewer trouve un bloquant, on corrige, puis l'auditeur en trouve un autre — deux allers-retours pour rien).
7. **Arbitrage humain** — je lis les deux rapports et je décide ce qui est appliqué. Cette étape ne se saute pas.
8. **refactorer** — applique uniquement les points validés à l'étape 7. Puis on **rejoue la vérification live** (une correction peut casser ce qui marchait). Si le refactoring touche une surface sensible — autorisation, route, exposition de données — relancer le security-auditor sur ce seul delta.
9. **Capitalisation** — toute leçon qui aurait évité un finding est écrite dans le fichier de l'agent concerné, ou ici. **Les sous-agents n'ont aucune mémoire d'un run à l'autre : ces fichiers sont leur seule mémoire.** Sans cette étape, la même erreur revient au prochain run.

Les étapes 2 et 4 sont conditionnelles. Les autres ne le sont pas.

**Voie courte** — un changement sans surface applicative (index ou migration seule, i18n, commentaire, renommage interne) peut sauter les étapes 4 à 6, à condition d'écrire explicitement dans le rapport ce qui a été sauté et pourquoi. Le silence n'est pas une justification.

Frontière entre implementer et integrateur : l'implementer s'arrête aux données et à la logique, l'integrateur commence aux composants. Si les deux doivent modifier le même fichier, le périmètre est mal découpé — redécoupe plutôt que de les laisser se marcher dessus.

Le parallélisme est utile ailleurs : pour explorer plusieurs modules indépendants d'un coup, demander explicitement plusieurs subagents explorer en parallèle.

## Carte du projet

`docs/CONVENTIONS.md` recense les patterns récurrents — ordre des gardes d'autorisation, sections repliables, formulaires en modale, migrations, modèles de personnes. Les agents le lisent avant d'explorer ou d'écrire, pour ne pas re-dériver à chaque feature ce qui est déjà établi. Quand un pattern change, ce fichier change avec lui.

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
- **Le périmètre inclut les fichiers de tests que le changement casse.** Un agent qui s'arrête parce qu'un mock est hors périmètre me laisse corriger trois lignes à la main : c'est un aller-retour pour rien.
- **Jamais de `git stash`.** Le travail en cours n'est pas commité ; un `stash` réflexe a déjà failli tout effacer. Pour isoler un problème, lire le diff, pas déplacer l'état.
- Aucun commit ni push automatique.

## Revue des diffs

Je lis chaque diff avant de merger. Un agent ne merge pas à ma place.
