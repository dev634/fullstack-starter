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

# One deploy at a time. The webhook (hooks.json) runs this script directly,
# outside the oneshot systemd unit, so systemd cannot serialize it with the
# timer: on 2026-11-22 the two overlapped, Compose's recreate failed with
# "removal of container … is already in progress", and the new container kept
# its temporary name (<id>_fullstack_starter_web) — anything addressing it by
# name broke. A second run now WAITS for the first (then finds nothing new to
# do) instead of racing it; it does not skip, so a webhook fired during a timer
# run still deploys the image it was fired for. The lock lives next to the
# compose file (both callers run as `deploy`, and a PrivateTmp on either unit
# would hide a /tmp lock from the other).
exec 9>/opt/fullstack-starter/.deploy-pull.lock
if ! flock -w 900 9; then
  echo "[deploy-pull] $(date -Is) another deploy still holds the lock after 15 min — giving up." >&2
  exit 1
fi

echo "[deploy-pull] $(date -Is) pulling latest web image…"
docker compose -f "$COMPOSE" pull web
# `up -d` recreates the web container only when the image digest changed, so
# this whole run is a no-op when nothing new was pushed. Restarting the
# container reruns the entrypoint, which applies pending Prisma migrations.
docker compose -f "$COMPOSE" up -d
docker image prune -f
echo "[deploy-pull] $(date -Is) done."
