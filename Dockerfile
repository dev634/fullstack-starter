# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:22-alpine AS base
# libc6-compat helps some native deps run on Alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Builder: install all deps, generate Prisma client, build, prune ----
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Generate the Prisma client (output: app/generated/prisma)
RUN npx prisma generate
# Build the Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Drop devDependencies; "prisma" is a runtime dep so the CLI stays for migrations
RUN npm prune --omit=dev

# ---- Runner: minimal production image ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as a non-root user
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# Prisma assets needed to run `migrate deploy` at startup
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/app/generated ./app/generated

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The git commit this image was built from, passed in by CI as a build-arg and
# surfaced by /api/health so you can tell exactly which version is live.
# Declared late so it only busts this tiny layer, not the COPYs above.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
