# Conventions du projet

## Où sont les règles

Ma **méthode de travail** — le pipeline de sous-agents, la répartition des
modèles, les règles de code (mobile first, DRY, SOLID, TypeScript strict), les
contraintes d'exécution et les pièges déjà payés — vit dans `~/.claude/CLAUDE.md`
et dans `~/.claude/agents/`. Elle s'applique à tous mes projets, ce dépôt inclus.
Une seule source : ne la recopie pas ici.

Ce fichier ne porte que ce qui est **propre à ce projet**. La carte du codebase
— patterns récurrents, pièges maison, ordre des gardes d'autorisation — est dans
**`docs/CONVENTIONS.md`**, que les agents lisent avant d'explorer ou d'écrire.

## Stack

Next.js (App Router) · TypeScript strict · Tailwind CSS · Node.js · PostgreSQL via Prisma · Docker · Caddy

## Déploiement

**Pull-based, aucun SSH entrant depuis le CI.** Merger sur `main` construit et
pousse l'image sur GHCR ; le VPS la récupère lui-même — webhook HTTPS immédiat,
plus un timer systemd en filet. Tout est dans `deploy/` (voir `deploy/README.md`).

Le conteneur applique les migrations Prisma en attente à son démarrage : une
migration mergée part donc automatiquement en production.

**Savoir ce qui tourne en prod**, sans SSH :

```bash
curl -s https://devadn.com/api/health
```

Le champ `version` est le commit court dont l'image a été construite.

## Spécificités à connaître

- **Modèle d'accès à trois axes orthogonaux** (rôle / fonction / projets) — ne
  jamais les croiser en matrice. Détail et ordre des gardes dans
  `docs/CONVENTIONS.md`.
- Les migrations sont écrites à la main puis appliquées par moi en local ; la
  prod les rejoue seule au déploiement.
