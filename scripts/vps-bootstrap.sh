#!/usr/bin/env bash
#
# Bootstrap a fresh Hostinger VPS (Ubuntu/Debian) to run fullstack-starter.
#
# What it does (safe to re-run):
#   1. Installs Docker Engine + the Compose plugin
#   2. Creates the app directory
#   3. Generates a .env with strong POSTGRES_PASSWORD and AUTH_SECRET
#
# Usage (as root, or prefix with sudo):
#   APP_DIR=/opt/fullstack-starter bash vps-bootstrap.sh
#
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/opt/fullstack-starter}"
# ────────────────────────────────────────────────────────────────────

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

echo "▶ Bootstrapping VPS for fullstack-starter"
echo "  App directory: $APP_DIR"

# 1. Docker Engine + Compose plugin (idempotent) ─────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Installing Docker via get.docker.com ..."
  curl -fsSL https://get.docker.com | $SUDO sh
else
  echo "✓ Docker already installed ($(docker --version))"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "✗ Docker Compose plugin is missing. Install docker-compose-plugin and re-run." >&2
  exit 1
fi

$SUDO systemctl enable --now docker

# 2. App directory ──────────────────────────────────────────────────
$SUDO mkdir -p "$APP_DIR"

# 3. .env with generated secrets (never overwrite an existing one) ───
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo "✓ $ENV_FILE already exists — leaving it untouched"
else
  echo "▶ Generating $ENV_FILE with fresh secrets ..."
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"      # url-safe (hex only)
  AUTH_SECRET="$(openssl rand -base64 32)"
  $SUDO tee "$ENV_FILE" >/dev/null <<EOF
# --- Postgres (db service) ---
POSTGRES_DB=app
POSTGRES_USER=app
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# --- App (web service) ---
# Host is the compose service name "db", not localhost.
DATABASE_URL=postgresql://app:${POSTGRES_PASSWORD}@db:5432/app?schema=public
AUTH_SECRET=${AUTH_SECRET}
AUTH_TRUST_HOST=true
# AUTH_URL=https://your-domain.com

# Required only if you use the client photo upload feature.
# Get this from your Cloudinary dashboard -> "API Environment variable".
# CLOUDINARY_URL=cloudinary://your_api_key:your_api_secret@your_cloud_name

# Required for password-reset emails to actually be delivered (otherwise
# reset links are only logged to the container's console). Get a key at
# https://resend.com (free tier).
# RESEND_API_KEY=re_your_api_key
# EMAIL_FROM=onboarding@resend.dev

NODE_ENV=production
EOF
  $SUDO chmod 600 "$ENV_FILE"
  echo "✓ .env created (POSTGRES_PASSWORD and AUTH_SECRET generated)"
  echo "  ⚠ Edit $ENV_FILE to set AUTH_URL (your real domain) and, if you use client"
  echo "    photo upload, CLOUDINARY_URL — a typo in AUTH_URL breaks auth redirects silently."
  echo "  ⚠ Set RESEND_API_KEY too if you want password-reset emails actually sent."
fi

echo
echo "✅ Bootstrap complete."
echo "   App dir : $APP_DIR"
echo "   Docker  : $(docker --version)"
echo "   Compose : $(docker compose version | head -n1)"
echo
echo "Next steps:"
echo "  1. GitHub secrets: VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_APP_DIR=$APP_DIR"
echo "  2. Point your reverse proxy at http://127.0.0.1:3000"
echo "  3. Trigger a deploy (push to main) or: gh run rerun <run-id> --failed"
