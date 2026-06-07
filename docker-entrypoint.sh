#!/bin/sh
set -e

echo "→ Applying database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "→ Starting the application..."
exec "$@"
