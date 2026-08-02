#!/usr/bin/env bash
# Pull-based deploy. Fetches the latest 'web' image from GHCR and recreates the
# stack if (and only if) the image changed. Run periodically by
# fullstack-deploy.timer.
#
# Why this exists: the provider's edge network intermittently drops GitHub's
# Azure runner IPs on the non-standard SSH port, so CI could not reliably SSH
# in to deploy (HTTPS/443 always worked; SSH timed out). The VPS updating
# itself removes the inbound-SSH dependency entirely.
set -euo pipefail

COMPOSE="/opt/fullstack-starter/docker-compose.prod.yml"
cd /opt/fullstack-starter

echo "[deploy-pull] $(date -Is) pulling latest web image…"
docker compose -f "$COMPOSE" pull web
# `up -d` recreates the web container only when the image digest changed, so
# this whole run is a no-op when nothing new was pushed. Restarting the
# container reruns the entrypoint, which applies pending Prisma migrations.
docker compose -f "$COMPOSE" up -d
docker image prune -f
echo "[deploy-pull] $(date -Is) done."
