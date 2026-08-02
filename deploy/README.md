# Déploiement en pull (VPS)

Le CI **construit et pousse** l'image sur GHCR ; le **VPS va la chercher lui-même**.
Il n'y a **aucun SSH entrant depuis le CI** — ce qui immunise le déploiement contre le
pare-feu réseau de l'hébergeur qui droppait par intermittence les plages d'IP des runners
GitHub (Azure) sur le port SSH non-standard (le HTTPS/443, lui, a toujours fonctionné).

Deux déclencheurs, complémentaires :

1. **Webhook (instantané)** — après le push, le CI fait un `curl` HTTPS vers `/deploy-hook`
   sur le VPS (via Caddy, port 443). Déploiement en quelques secondes.
2. **Timer systemd (filet de sécurité, ~15 min)** — au cas où un webhook est raté. Le
   `pull` est un no-op quand l'image n'a pas changé, donc ça ne coûte rien.

Les deux appellent le même `deploy-pull.sh` (`docker compose pull web && up -d`, qui ne
recrée le conteneur que si l'image a changé ; le redémarrage rejoue les migrations Prisma).

---

## Installation sur le VPS (une fois)

### Étape 1 — script + timer (la base)

```bash
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

sudo tee /etc/systemd/system/fullstack-deploy.service > /dev/null <<'UNIT'
[Unit]
Description=Pull latest fullstack-starter image and redeploy
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
Description=Safety-net redeploy from GHCR (pull-based)
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now fullstack-deploy.timer
sudo systemctl start fullstack-deploy.service      # déploie tout de suite
journalctl -u fullstack-deploy.service -n 40 --no-pager
```

*(Si le `pull` échoue sur une erreur d'auth → l'image GHCR est privée : `docker login ghcr.io -u dev634` sur le VPS avec un PAT `read:packages`, puis relance le `start`.)*

### Étape 2 — webhook (déploiement instantané)

```bash
# a. l'outil webhook (paquet Debian/Ubuntu)
sudo apt-get update && sudo apt-get install -y webhook

# b. la config du hook
sudo mkdir -p /opt/fullstack-starter/webhook
sudo tee /opt/fullstack-starter/webhook/hooks.json > /dev/null <<'JSON'
[
  {
    "id": "deploy",
    "execute-command": "/opt/fullstack-starter/deploy-pull.sh",
    "command-working-directory": "/opt/fullstack-starter",
    "response-message": "deploy triggered",
    "include-command-output-in-response": true,
    "include-command-output-in-response-on-error": true,
    "trigger-rule": {
      "match": {
        "type": "value",
        "value": "{{ getenv "DEPLOY_HOOK_TOKEN" }}",
        "parameter": { "source": "header", "name": "X-Deploy-Token" }
      }
    }
  }
]
JSON

# c. un secret partagé — généré ici, à recopier en secret GitHub (voir étape 3)
SECRET=$(openssl rand -hex 32)
echo "DEPLOY_HOOK_TOKEN=$SECRET" | sudo tee /etc/fullstack-deploy.env > /dev/null
sudo chmod 600 /etc/fullstack-deploy.env
echo ">>> Copie ce token dans le secret GitHub 'DEPLOY_HOOK_TOKEN' : $SECRET"

# d. le service webhook (écoute sur 127.0.0.1:9000, Caddy le fronte)
sudo tee /etc/systemd/system/deploy-webhook.service > /dev/null <<'UNIT'
[Unit]
Description=Deploy webhook receiver (pull-based deploy over HTTPS)
After=network-online.target
Wants=network-online.target
[Service]
User=deploy
EnvironmentFile=/etc/fullstack-deploy.env
ExecStart=/usr/bin/webhook -hooks /opt/fullstack-starter/webhook/hooks.json -template -ip 127.0.0.1 -port 9000 -verbose
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now deploy-webhook.service

# e. la route Caddy — ajoute CE bloc DANS le site devadn.com de /etc/caddy/Caddyfile :
#      handle /deploy-hook {
#          rewrite * /hooks/deploy
#          reverse_proxy 127.0.0.1:9000
#      }
#    puis :
sudo systemctl reload caddy
```

### Étape 3 — secret GitHub

Dépôt → **Settings → Secrets and variables → Actions → New repository secret** :
- Nom : `DEPLOY_HOOK_TOKEN`
- Valeur : le token affiché à l'étape 2c.

Le workflow (`.github/workflows/deploy.yml`) l'envoie dans l'en-tête `X-Deploy-Token` ; le
récepteur ne déclenche que si ça correspond. Sans le secret, le ping échoue silencieusement
(`continue-on-error`) et le déploiement passe quand même par le timer.

---

## Vérifier / tester

```bash
# le webhook répond (depuis le VPS ou n'importe où, avec le bon token) :
curl -fsS -X POST -H "X-Deploy-Token: LE_TOKEN" https://devadn.com/deploy-hook

# les services tournent :
systemctl status deploy-webhook.service      # active (running)
systemctl status fullstack-deploy.timer      # active (waiting)

# ce qu'a fait le dernier déploiement :
journalctl -u fullstack-deploy.service -n 40 --no-pager
journalctl -u deploy-webhook.service -n 40 --no-pager
```

## Sécurité

- Le récepteur écoute sur **127.0.0.1** uniquement — seul Caddy (TLS) l'atteint.
- Il n'exécute qu'**une commande figée** (`deploy-pull.sh`) — pas d'injection possible.
- Déclenchement gated par un **token aléatoire** en en-tête, sur HTTPS.
- Tourne en tant que `deploy` (accès docker), pas root.
