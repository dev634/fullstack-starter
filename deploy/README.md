# Déploiement en pull (VPS)

Le CI **construit et pousse** l'image sur GHCR ; le **VPS va la chercher lui-même**
via un timer systemd. Il n'y a **plus de SSH entrant depuis le CI**, ce qui immunise
le déploiement contre le pare-feu réseau de l'hébergeur qui droppait par
intermittence les plages d'IP des runners GitHub (Azure) sur le port SSH non-standard
(le HTTPS/443, lui, a toujours fonctionné).

## Comment ça marche

1. Merge sur `main` → workflow `.github/workflows/deploy.yml` → **build + push** de l'image
   `ghcr.io/dev634/fullstack-starter:latest` sur GHCR. (Plus aucune étape SSH.)
2. Sur le VPS, `fullstack-deploy.timer` déclenche `deploy-pull.sh` toutes les ~3 min :
   `docker compose pull web && up -d`. `up -d` ne recrée le conteneur **que si l'image
   a changé** (sinon no-op). Le redémarrage rejoue les migrations Prisma via l'entrypoint.

Délai typique entre le merge et la mise en ligne : ~3 min.

## Installation (une fois, sur le VPS)

À coller tel quel en SSH sur le VPS. Le login GHCR n'est nécessaire que si le package est privé.

```bash
# 1. Script de déploiement
sudo tee /opt/fullstack-starter/deploy-pull.sh > /dev/null <<'SH'
#!/usr/bin/env bash
set -euo pipefail
COMPOSE="/opt/fullstack-starter/docker-compose.prod.yml"
cd /opt/fullstack-starter
echo "[deploy-pull] $(date -Is) pulling latest web image…"
docker compose -f "$COMPOSE" pull web
docker compose -f "$COMPOSE" up -d
docker image prune -f
echo "[deploy-pull] $(date -Is) done."
SH
sudo chmod +x /opt/fullstack-starter/deploy-pull.sh
sudo chown deploy:deploy /opt/fullstack-starter/deploy-pull.sh

# 2. (SI l'image GHCR est privée) connecter le VPS à GHCR une fois — le login persiste
#    En tant qu'utilisateur `deploy` (celui qui lance docker), avec un PAT scope read:packages :
#    docker login ghcr.io -u dev634
#    (si l'image est publique, saute cette étape)

# 3. Service + timer systemd
sudo tee /etc/systemd/system/fullstack-deploy.service > /dev/null <<'UNIT'
[Unit]
Description=Pull the latest fullstack-starter image from GHCR and redeploy
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
User=deploy
ExecStart=/opt/fullstack-starter/deploy-pull.sh
UNIT

sudo tee /etc/systemd/system/fullstack-deploy.timer > /dev/null <<'UNIT'
[Unit]
Description=Periodically redeploy fullstack-starter from GHCR (pull-based)

[Timer]
OnBootSec=2min
OnUnitActiveSec=3min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now fullstack-deploy.timer

# 4. Déployer tout de suite + vérifier
sudo systemctl start fullstack-deploy.service
journalctl -u fullstack-deploy.service -n 40 --no-pager
systemctl list-timers fullstack-deploy.timer --no-pager
```

## Vérifier que c'est en place

```bash
systemctl status fullstack-deploy.timer     # doit être "active (waiting)"
journalctl -u fullstack-deploy.service -f    # suit les déploiements en direct
```

## Revenir en arrière

`sudo systemctl disable --now fullstack-deploy.timer` désactive le pull.
