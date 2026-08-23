# Fullstack Starter with Next.js

Next.js (App Router) + Prisma + PostgreSQL, with credentials auth (Auth.js v5).

## Local development

```bash
cp .env.example .env          # fill in the values
docker compose up -d          # starts Postgres only
npm install
npx prisma migrate dev        # create / apply migrations
npm run db:seed               # optional: seed demo data + admin user
npm run dev
```

Dev accounts (from the seed), all `password123`:
`superadmin@example.com` (`SUPERADMIN`), `admin@example.com` (`ADMIN`),
`editor@example.com` (`EDITOR`), `viewer@example.com` (`VIEWER`, read-only).

`ADMIN` is **not** full access: a job function's hidden rubriques/sections apply
to it, and it cannot lift its own restrictions. `SUPERADMIN` is the only escape
hatch — see `docs/CONVENTIONS.md`, "Modèle d'accès".

## Deploying to production

Step-by-step guide for a Hostinger VPS (or any Ubuntu/Debian VPS): see
[`docs/deploy-hostinger.md`](docs/deploy-hostinger.md).

## CI/CD

> ### ⚠️ The SSH-based deploy described below is gone — read this first
>
> The CI **no longer connects to the VPS**. `deploy.yml` only builds and pushes the
> image to GHCR, then pings an HTTPS webhook; **the VPS pulls the image itself**
> (webhook + systemd timer as a net). The host's network intermittently dropped the
> GitHub runner IP ranges on the non-standard SSH port, which no amount of retrying
> fixed.
>
> Consequences for everything below: the `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` /
> `VPS_APP_DIR` / `VPS_PORT` secrets are **no longer used** (the only deploy secret is
> `DEPLOY_HOOK_TOKEN`), no CI deploy key goes into `authorized_keys`, and
> `docker-compose.prod.yml` is **not** copied to the VPS by the workflow anymore.
>
> **Current procedure: [`deploy/README.md`](deploy/README.md).** Human SSH access to the
> VPS is unaffected ([`docs/SECURITE-SSH.md`](docs/SECURITE-SSH.md)).

Two GitHub Actions workflows:

- **`.github/workflows/ci.yml`** — runs on every PR and push to `main`:
  `npm ci` → `prisma generate` → `lint` → `tsc --noEmit` → `next build`.
- **`.github/workflows/deploy.yml`** — runs on push to `main`: builds a Docker image
  and pushes it to **GHCR** (`ghcr.io/dev634/fullstack-starter`), then triggers the
  VPS-side pull over HTTPS. Database migrations (`prisma migrate deploy`) run
  automatically on container start via `docker-entrypoint.sh`.

### Required GitHub secrets *(obsolete — see the warning above)*

| Secret          | Description                                                        |
| --------------- | ------------------------------------------------------------------ |
| `VPS_HOST`      | VPS IP or hostname                                                 |
| `VPS_USER`      | SSH user                                                           |
| `VPS_SSH_KEY`   | Private SSH key (PEM) authorized on the VPS                        |
| `VPS_APP_DIR`   | Absolute path of the app folder on the VPS (e.g. `/home/deploy/app`) |
| `VPS_PORT`      | SSH port (optional, defaults to `22`)                              |

GHCR authentication (push from CI and pull on the VPS) uses the built-in
`GITHUB_TOKEN`, so no extra registry secret is needed for a **private** image.

### One-time VPS setup

Steps 1–3 below can be automated with the bootstrap script
([`scripts/vps-bootstrap.sh`](scripts/vps-bootstrap.sh)), run once as root:

```bash
APP_DIR=/opt/fullstack-starter bash scripts/vps-bootstrap.sh
```

1. Install Docker Engine + the Compose plugin.
2. Create the app folder (matching `VPS_APP_DIR`) and add the deploy key to
   `~/.ssh/authorized_keys`.
3. Copy `.env.production.example` to `.env` in that folder and fill in real
   values (strong `POSTGRES_PASSWORD`, `AUTH_SECRET` via `npx auth secret`,
   and set `AUTH_TRUST_HOST=true`). The `DATABASE_URL` host must be `db`
   (the compose service name), not `localhost`.
4. Point your existing reverse proxy at `http://127.0.0.1:3000` and make sure
   it forwards `X-Forwarded-Proto` and `X-Forwarded-Host` headers.

The `docker-compose.prod.yml` file itself is copied to the VPS automatically by
the deploy workflow, so it stays in sync with the repo.

After that, every push to `main` redeploys automatically.
