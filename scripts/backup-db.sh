#!/usr/bin/env bash
#
# Nightly backup of the fullstack-starter Postgres database. Meant to run
# via cron on the VPS, in the same directory as docker-compose.prod.yml.
#
# One-off usage:
#   APP_DIR=/opt/fullstack-starter bash backup-db.sh
#
# Cron (see docs/deploy-hostinger.md for the full setup):
#   0 3 * * * APP_DIR=/opt/fullstack-starter /opt/fullstack-starter/backup-db.sh >> /opt/fullstack-starter/backup.log 2>&1
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fullstack-starter}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Read POSTGRES_USER/POSTGRES_DB from .env so this script never needs
# editing when credentials change.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$OUT_FILE"
echo "✓ Backup written to $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Rotate: drop backups older than RETENTION_DAYS.
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
echo "✓ Rotated backups older than $RETENTION_DAYS day(s)"
