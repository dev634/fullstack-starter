# Déployer sur un VPS Hostinger

Ce guide déploie l'app sur un **VPS Hostinger** avec le pipeline déjà en place dans ce repo :
GitHub Actions build une image Docker → la pousse sur **GHCR** (GitHub Container Registry) →
se connecte en SSH au VPS pour tirer l'image et redémarrer la stack (`docker compose`).
Les migrations Prisma (`prisma migrate deploy`) s'exécutent automatiquement au démarrage du
conteneur (voir [docker-entrypoint.sh](../docker-entrypoint.sh)).

Une fois la configuration initiale faite, **chaque push sur `main` redéploie automatiquement**.

## Vue d'ensemble

```
GitHub (push main) → build image Docker → ghcr.io/dev634/fullstack-starter
                                              │
                                              ▼
                                    VPS Hostinger (SSH)
                                    ├── Caddy (reverse proxy + HTTPS auto)
                                    ├── conteneur "web"  (Next.js, port 3000 en local uniquement)
                                    └── conteneur "db"   (PostgreSQL, volume persistant)
```

---

## 1. Créer et préparer le VPS

1. Dans **hPanel** (panneau Hostinger) → **VPS** → commande un plan (2 Go de RAM minimum recommandés).
2. Choisis une image **Ubuntu 22.04 LTS** (ou Debian 12) lors de la création.
3. Note l'**adresse IP** du VPS et récupère l'accès SSH (mot de passe root fourni par email, ou
   configure une clé SSH depuis hPanel → VPS → *SSH Keys*).
4. Connecte-toi pour vérifier l'accès :

   ```bash
   ssh root@TON_IP_VPS
   ```

### (Recommandé) Créer un utilisateur non-root pour le déploiement

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

Génère ensuite une clé SSH **dédiée au déploiement CI** (sur ta machine, pas sur le VPS) :

```bash
ssh-keygen -t ed25519 -C "deploy-ci" -f deploy_ci_key -N ""
ssh-copy-id -i deploy_ci_key.pub deploy@TON_IP_VPS
```

Garde `deploy_ci_key` (la clé privée) — elle ira dans les secrets GitHub à l'étape 4.

---

## 2. Pointer ton domaine vers le VPS

Dans **hPanel → Domaines → DNS / Nameservers** (ou chez ton registrar si le domaine n'est pas
chez Hostinger) :

| Type | Nom | Valeur |
|------|-----|--------|
| A | `@` (ou `app`) | `TON_IP_VPS` |
| A | `www` | `TON_IP_VPS` (optionnel) |

Attends la propagation DNS (`dig ton-domaine.com` doit renvoyer l'IP du VPS).

---

## 3. Bootstrap du VPS (Docker + dossier app + secrets)

Le repo fournit un script qui installe Docker et génère un `.env` de production avec des
secrets forts. Sur le VPS, connecté en `deploy` (ou root) :

```bash
curl -fsSL https://raw.githubusercontent.com/dev634/fullstack-starter/main/scripts/vps-bootstrap.sh \
  -o vps-bootstrap.sh
APP_DIR=/opt/fullstack-starter bash vps-bootstrap.sh
```

Ce script :
1. Installe Docker Engine + le plugin Compose (idempotent).
2. Crée le dossier `/opt/fullstack-starter`.
3. Génère `/opt/fullstack-starter/.env` avec `POSTGRES_PASSWORD` et `AUTH_SECRET` aléatoires forts.

Édite ensuite ce `.env` pour ajouter ton domaine :

```bash
sudo nano /opt/fullstack-starter/.env
```

Ajoute/vérifie ces lignes (le reste est déjà rempli par le script) :

```dotenv
AUTH_TRUST_HOST=true
AUTH_URL=https://ton-domaine.com
```

> ⚠️ Si tu utilises un utilisateur non-root, assure-toi qu'il a les droits sur `/opt/fullstack-starter`
> (`sudo chown -R deploy:deploy /opt/fullstack-starter`) et qu'il est dans le groupe `docker`
> (`sudo usermod -aG docker deploy`, puis reconnecte-toi en SSH).

---

## 4. Reverse proxy + HTTPS (Caddy)

Le conteneur `web` n'écoute que sur `127.0.0.1:3000` (voir `docker-compose.prod.yml`) — il faut
un reverse proxy devant pour le TLS et le nom de domaine. **Caddy** est le plus simple : il
obtient et renouvelle automatiquement les certificats Let's Encrypt.

```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Configure-le :

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
ton-domaine.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

Remplace `ton-domaine.com` par ton vrai domaine. Caddy va automatiquement demander et installer
le certificat HTTPS au premier accès — assure-toi que les ports **80** et **443** sont ouverts
sur le pare-feu Hostinger (hPanel → VPS → *Firewall*) et sur `ufw` si actif :

```bash
sudo ufw allow 80,443/tcp
```

<details>
<summary>Alternative : Nginx + Certbot</summary>

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/fullstack-starter > /dev/null <<'EOF'
server {
    listen 80;
    server_name ton-domaine.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/fullstack-starter /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ton-domaine.com
```
</details>

---

## 5. Configurer les secrets GitHub

Dans le repo GitHub → **Settings → Secrets and variables → Actions**, ajoute :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | IP ou hostname du VPS |
| `VPS_USER` | `deploy` (ou `root`) |
| `VPS_SSH_KEY` | Contenu de la clé privée `deploy_ci_key` générée à l'étape 1 |
| `VPS_APP_DIR` | `/opt/fullstack-starter` |
| `VPS_PORT` | `22` (optionnel, valeur par défaut) |

Aucun secret de registre supplémentaire n'est nécessaire : le push/pull GHCR utilise le
`GITHUB_TOKEN` intégré à Actions.

---

## 6. Premier déploiement

Le workflow [`deploy.yml`](../.github/workflows/deploy.yml) se déclenche sur chaque push vers
`main`. Pour lancer le tout premier déploiement :

```bash
git push origin main
```

Ou, si `main` est déjà à jour et que tu veux juste redéclencher le workflow :

```bash
gh workflow run deploy.yml
```

Suis l'exécution :

```bash
gh run watch
```

Le workflow va :
1. Builder l'image Docker et la pousser sur `ghcr.io/dev634/fullstack-starter:latest`.
2. Copier `docker-compose.prod.yml` sur le VPS (dans `VPS_APP_DIR`).
3. Se connecter en SSH, faire `docker compose pull web` puis `up -d`.
4. Le conteneur applique les migrations Prisma au démarrage, puis sert l'app sur `127.0.0.1:3000`.

---

## 7. Vérifier

```bash
curl -I https://ton-domaine.com          # doit répondre 200/307
ssh deploy@TON_IP_VPS "docker compose -f /opt/fullstack-starter/docker-compose.prod.yml ps"
ssh deploy@TON_IP_VPS "docker compose -f /opt/fullstack-starter/docker-compose.prod.yml logs -f web"
```

Connexion admin (si tu as seedé les données en local avant de migrer, sinon crée un utilisateur
via `npm run db:seed` en pointant `DATABASE_URL` sur la base de prod, ou directement en SQL).

---

## 8. Maintenance courante

| Action | Commande (sur le VPS, dans `VPS_APP_DIR`) |
|---|---|
| Voir les logs | `docker compose -f docker-compose.prod.yml logs -f web` |
| Redémarrer | `docker compose -f docker-compose.prod.yml restart web` |
| Statut des conteneurs | `docker compose -f docker-compose.prod.yml ps` |
| Sauvegarder la DB | `docker compose -f docker-compose.prod.yml exec db pg_dump -U app app > backup.sql` |
| Restaurer la DB | `docker compose -f docker-compose.prod.yml exec -T db psql -U app app < backup.sql` |
| Espace disque images | `docker image prune -f` (déjà fait automatiquement en fin de déploiement) |

### Rollback rapide

Chaque build est aussi taggé avec le SHA du commit (`type=sha` dans le workflow). Pour revenir à
une version précédente sans repasser par Git :

```bash
ssh deploy@TON_IP_VPS
cd /opt/fullstack-starter
docker pull ghcr.io/dev634/fullstack-starter:<sha-du-commit-precedent>
docker tag ghcr.io/dev634/fullstack-starter:<sha> ghcr.io/dev634/fullstack-starter:latest
docker compose -f docker-compose.prod.yml up -d
```

---

## Dépannage

- **`docker compose` échoue avec "permission denied"** → l'utilisateur `deploy` n'est pas dans le
  groupe `docker` (`sudo usermod -aG docker deploy`, puis reconnecte-toi en SSH).
- **Le site répond en HTTP mais pas HTTPS** → vérifie que les ports 80/443 sont ouverts (pare-feu
  Hostinger **et** `ufw`), et que le DNS pointe bien vers le VPS (`dig ton-domaine.com`).
- **Erreur d'auth / redirections en boucle derrière le proxy** → vérifie que `AUTH_TRUST_HOST=true`
  et `AUTH_URL` sont bien dans le `.env` du VPS, et que Caddy/Nginx transmet
  `X-Forwarded-Proto`/`X-Forwarded-Host` (Caddy le fait par défaut ; voir la config Nginx ci-dessus
  pour l'équivalent).
- **Les migrations ne s'appliquent pas** → regarde les logs du conteneur `web` au démarrage
  (`docker compose logs web`), l'étape `prisma migrate deploy` s'exécute avant `npm run start`
  dans `docker-entrypoint.sh`.
- **Le workflow GitHub Actions échoue à l'étape SSH** → vérifie que `VPS_SSH_KEY` contient bien la
  clé **privée** complète (avec les lignes `-----BEGIN...-----`/`-----END...-----`), et que
  `VPS_HOST`/`VPS_USER`/`VPS_PORT` correspondent à ta configuration SSH.
