# Déployer sur un VPS Hostinger

Ce guide déploie l'app sur un **VPS Hostinger** avec le pipeline déjà en place dans ce repo :
GitHub Actions build une image Docker → la pousse sur **GHCR** (GitHub Container Registry) →
se connecte en SSH au VPS pour tirer l'image et redémarrer la stack (`docker compose`).
Les migrations Prisma (`prisma migrate deploy`) s'exécutent automatiquement au démarrage du
conteneur (voir [docker-entrypoint.sh](../docker-entrypoint.sh)).

Une fois la configuration initiale faite, **chaque push sur `main` redéploie automatiquement**.

> 💡 Ce guide inclut les pièges réellement rencontrés lors d'un déploiement sur Hostinger
> (Traefik préinstallé, port SSH non standard, variables d'env manquantes...). Suis-le dans
> l'ordre, chaque étape a son utilité.

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
3. Note l'**adresse IP** du VPS.
4. ⚠️ **Vérifie le port SSH** dans hPanel → VPS → *Overview* / *SSH Access*. Hostinger utilise
   parfois un **port non standard** (ex. `49231`) au lieu du `22` par défaut — note-le, il te
   servira pour **toutes** les commandes `ssh`/`scp` de ce guide et pour le secret GitHub
   `VPS_PORT` à l'étape 5.
5. Connecte-toi pour vérifier l'accès (adapte le `-p` si le port n'est pas 22) :

   ```bash
   ssh -p TON_PORT_SSH root@TON_IP_VPS
   ```

### Créer un utilisateur non-root dédié au déploiement

```bash
adduser deploy
```

Ça va demander un mot de passe puis quelques infos optionnelles (nom, téléphone...) — tu peux
valider chaque question avec **Entrée** pour les laisser vides, puis confirmer avec `Y`.

```bash
usermod -aG sudo deploy
usermod -aG docker deploy   # une fois Docker installé à l'étape 3 — reviens y faire ça si besoin
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

### Générer une clé SSH dédiée au déploiement CI

Toujours connecté en `root` sur le VPS (le plus simple pour utiliser `ssh-copy-id` en boucle
locale) :

```bash
ssh-keygen -t ed25519 -C "deploy-ci" -f ~/deploy_ci_key -N ""
ssh-copy-id -p TON_PORT_SSH -i ~/deploy_ci_key.pub deploy@TON_IP_VPS
```

- À la question `Are you sure you want to continue connecting (yes/no/[fingerprint])?` →
  réponds **`yes`** en toutes lettres.
- Il te demandera ensuite le **mot de passe de l'utilisateur `deploy`** (celui défini avec
  `adduser`) pour installer la clé publique dans son `authorized_keys`.

Affiche et **copie précieusement** le contenu de la clé **privée** — il ira dans le secret GitHub
`VPS_SSH_KEY` à l'étape 5 :

```bash
cat ~/deploy_ci_key
```

Copie **tout le bloc**, y compris les lignes `-----BEGIN OPENSSH PRIVATE KEY-----` et
`-----END OPENSSH PRIVATE KEY-----`.

> Une fois copiée dans GitHub, tu peux supprimer la clé privée du VPS par sécurité
> (`rm ~/deploy_ci_key ~/deploy_ci_key.pub`) — seule la clé **publique**, déjà dans
> `/home/deploy/.ssh/authorized_keys`, doit y rester.

---

## 2. Pointer ton domaine vers le VPS

Dans **hPanel → Domaines → DNS / Nameservers** (ou chez ton registrar si le domaine n'est pas
chez Hostinger) :

| Type | Nom | Valeur |
|------|-----|--------|
| A | `@` (ou `app`) | `TON_IP_VPS` |
| A | `www` | `TON_IP_VPS` (optionnel) |

Attends la propagation DNS avant de continuer :

```cmd
nslookup ton-domaine.com
```
*(doit renvoyer l'IP de ton VPS)*

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

Édite ensuite ce `.env` pour compléter les valeurs propres à ton domaine et tes services externes :

```bash
sudo nano /opt/fullstack-starter/.env
```

Ajoute/vérifie ces lignes (le reste est déjà rempli par le script) :

```dotenv
AUTH_TRUST_HOST=true
AUTH_URL=https://ton-domaine.com

# Nécessaire uniquement si tu utilises l'upload de photo client.
# Dashboard Cloudinary → "API Environment variable".
CLOUDINARY_URL=cloudinary://TON_API_KEY:TON_API_SECRET@TON_CLOUD_NAME

# Nécessaire pour que les emails de réinitialisation de mot de passe soient
# réellement envoyés (sinon le lien n'apparaît que dans les logs du conteneur).
# Clé gratuite sur https://resend.com.
RESEND_API_KEY=re_TON_API_KEY
EMAIL_FROM=onboarding@resend.dev
```

> ⚠️ **Relis bien ton domaine avant de sauvegarder** — une simple faute de frappe ici
> (ex. `devad.com` au lieu de `devadn.com`) fait planter les redirections d'authentification
> silencieusement : l'app redirige alors vers le mauvais domaine sans erreur explicite.

> ⚠️ Si tu utilises un utilisateur non-root, assure-toi qu'il a les droits sur `/opt/fullstack-starter`
> (`sudo chown -R deploy:deploy /opt/fullstack-starter`) et qu'il est dans le groupe `docker`
> (`sudo usermod -aG docker deploy`, puis reconnecte-toi en SSH pour que le groupe soit pris en compte).

> 🔁 **Règle importante à retenir pour la suite** : après **toute modification du `.env`**, un
> simple `docker compose restart web` ne suffit PAS — Docker ne relit les variables d'env qu'à la
> **création** du conteneur. Il faut le recréer :
> ```bash
> docker compose -f /opt/fullstack-starter/docker-compose.prod.yml up -d --force-recreate web
> ```
> Vérifie ensuite qu'une variable a bien été prise en compte avec :
> ```bash
> docker exec fullstack_starter_web env | grep NOM_DE_LA_VARIABLE
> ```

---

## 4. Reverse proxy + HTTPS (Caddy)

Le conteneur `web` n'écoute que sur `127.0.0.1:3000` (voir `docker-compose.prod.yml`) — il faut
un reverse proxy devant pour le TLS et le nom de domaine. **Caddy** est le plus simple : il
obtient et renouvelle automatiquement les certificats Let's Encrypt.

### 4.0 Vérifier qu'aucun autre service n'occupe déjà les ports 80/443

**Étape à ne pas sauter** : certains templates Hostinger (notamment les images "Docker")
préinstallent un reverse proxy **Traefik** tournant en conteneur, qui monopolise le port 80.
Vérifie avant d'installer Caddy :

```bash
sudo ss -tlnp | grep -E ':80|:443'
```

- **Rien ne s'affiche** → tu peux passer directement à la section 4.1.
- **Un process `traefik` apparaît** → c'est presque toujours un conteneur (pas un service
  `systemd`), identifiable ainsi :
  ```bash
  docker ps | grep traefik
  ```
  Si le VPS est **dédié à ce projet** (pas d'autres apps installées via le catalogue hPanel), tu
  peux l'arrêter sans risque. Cherche d'abord son dossier de projet pour l'arrêter proprement :
  ```bash
  docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' <nom-du-conteneur>
  cd <chemin-affiché>
  sudo docker compose down
  ```
  Si la commande `inspect` ne renvoie rien, arrête-le directement et empêche-le de redémarrer :
  ```bash
  docker stop <nom-du-conteneur>
  docker update --restart=no <nom-du-conteneur>
  ```
- **Un autre service `nginx`/`apache2` apparaît** (parfois préinstallé aussi) → désactive-le, on
  n'utilise qu'un seul reverse proxy à la fois :
  ```bash
  sudo systemctl stop nginx apache2 2>/dev/null
  sudo systemctl disable nginx apache2 2>/dev/null
  ```

Reconfirme que les ports sont libres avant de continuer :
```bash
sudo ss -tlnp | grep -E ':80|:443'
```
*(ne doit plus rien afficher)*

### 4.1 Installer et configurer Caddy

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

Ouvre les ports **avant** de configurer le domaine (sinon la validation Let's Encrypt échoue) :

```bash
sudo ufw allow 80,443/tcp
```
Vérifie aussi dans **hPanel → VPS → Firewall** que les ports 80 et 443 sont ouverts en entrée
(certains plans Hostinger ont un pare-feu géré séparément d'`ufw`).

Configure le `Caddyfile` — remplace `ton-domaine.com` par ton vrai domaine :

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
ton-domaine.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl restart caddy
```

Vérifie que Caddy tourne et a bien obtenu son certificat :

```bash
sudo systemctl status caddy
sudo journalctl -u caddy --no-pager | tail -20
```

Tu dois voir une ligne `"msg":"certificate obtained successfully"` pour ton domaine. Le warning
`no OCSP stapling` est sans gravité.

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

Dans le repo GitHub → **Settings → Secrets and variables → Actions → Repository secrets**,
clique **New repository secret** pour chacun de ces 5 secrets :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | IP ou hostname du VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | Contenu **complet** de la clé privée `deploy_ci_key` (avec les lignes `BEGIN`/`END`) |
| `VPS_APP_DIR` | `/opt/fullstack-starter` |
| `VPS_PORT` | Le port SSH de ton VPS (ex. `49231` — **pas forcément `22`**, voir étape 1) |

Aucun secret de registre supplémentaire n'est nécessaire : le push/pull GHCR utilise le
`GITHUB_TOKEN` intégré à Actions.

---

## 6. Premier déploiement

Le workflow [`deploy.yml`](../.github/workflows/deploy.yml) se déclenche sur chaque push vers
`main`. Pour lancer le tout premier déploiement :

```bash
git push origin main
```

Ou, si `main` est déjà à jour et que tu veux juste redéclencher le workflow (utile si un run
précédent a échoué avant que les secrets soient prêts) :

```bash
gh run list --workflow=deploy.yml --limit 3
gh run rerun <run-id>
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

```cmd
curl -I https://ton-domaine.com
```
*(doit répondre `200` ou une redirection vers `/login`)*

```bash
docker compose -f /opt/fullstack-starter/docker-compose.prod.yml ps
docker compose -f /opt/fullstack-starter/docker-compose.prod.yml logs -f web
```

> Si le navigateur affiche un site différent de celui attendu (ex. une adresse ressemblant à ton
> domaine mais pas exactement), pense à tester en **navigation privée** — l'autocomplétion de la
> barre d'adresse peut proposer une ancienne faute de frappe stockée dans l'historique.

---

## 8. Créer ton compte administrateur

Le déploiement applique les **migrations** automatiquement, mais **pas le seed** (le script de
seed est en TypeScript et l'image de production n'embarque pas `tsx`/les devDependencies — voir
[docker-entrypoint.sh](../docker-entrypoint.sh)). La base de prod démarre donc **vide**, sans
compte admin.

Crée le tien directement en SQL (contourne complètement Prisma/TypeScript, ne dépend que du
package `pg` déjà présent dans l'image) :

**1. Crée le script sur le VPS :**
```bash
cat > /opt/fullstack-starter/create-admin.js <<'EOF'
require('dotenv/config');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || 'Admin';

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars.');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO "User" (email, password, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, name = EXCLUDED.name`,
    [email, hash, name]
  );
  console.log('✅ Compte prêt :', email);
  await client.end();
})();
EOF
```

**2. Copie-le dans le conteneur :**
```bash
docker cp /opt/fullstack-starter/create-admin.js fullstack_starter_web:/app/create-admin.js
```

**3. Lance-le avec tes identifiants** (remplace email/mot de passe) :
```bash
docker compose -f /opt/fullstack-starter/docker-compose.prod.yml exec \
  -e ADMIN_EMAIL="toi@ton-domaine.com" \
  -e ADMIN_PASSWORD="TonMotDePasseSolide123!" \
  -e ADMIN_NAME="Ton Nom" \
  web node /app/create-admin.js
```

**4. Nettoie ensuite** (le script, et l'historique shell pour ne pas laisser le mot de passe en clair) :
```bash
docker exec fullstack_starter_web rm /app/create-admin.js
rm /opt/fullstack-starter/create-admin.js
history -d $(history | tail -2 | head -1 | awk '{print $1}')
```

Connecte-toi ensuite sur `https://ton-domaine.com/login` avec cet email/mot de passe.

---

## 9. Maintenance courante

| Action | Commande (sur le VPS, dans `VPS_APP_DIR`) |
|---|---|
| Voir les logs | `docker compose -f docker-compose.prod.yml logs -f web` |
| Redémarrer (sans changement de `.env`) | `docker compose -f docker-compose.prod.yml restart web` |
| Recréer (après changement de `.env`) | `docker compose -f docker-compose.prod.yml up -d --force-recreate web` |
| Statut des conteneurs | `docker compose -f docker-compose.prod.yml ps` |
| Sauvegarder la DB | `docker compose -f docker-compose.prod.yml exec db pg_dump -U app app > backup.sql` |
| Restaurer la DB | `docker compose -f docker-compose.prod.yml exec -T db psql -U app app < backup.sql` |
| Espace disque images | `docker image prune -f` (déjà fait automatiquement en fin de déploiement) |

### Rollback rapide

Chaque build est aussi taggé avec le SHA du commit (`type=sha` dans le workflow). Pour revenir à
une version précédente sans repasser par Git :

```bash
ssh -p TON_PORT_SSH deploy@TON_IP_VPS
cd /opt/fullstack-starter
docker pull ghcr.io/dev634/fullstack-starter:<sha-du-commit-precedent>
docker tag ghcr.io/dev634/fullstack-starter:<sha> ghcr.io/dev634/fullstack-starter:latest
docker compose -f docker-compose.prod.yml up -d
```

---

## 10. Sauvegardes automatiques, monitoring et suivi d'erreurs

### Sauvegardes automatiques de la DB

Le repo fournit [`scripts/backup-db.sh`](../scripts/backup-db.sh) : il fait un `pg_dump` compressé
dans `VPS_APP_DIR/backups/` et supprime automatiquement les sauvegardes de plus de 7 jours.

Installe-le en cron sur le VPS (tous les jours à 3h du matin) :

```bash
curl -fsSL https://raw.githubusercontent.com/dev634/fullstack-starter/main/scripts/backup-db.sh \
  -o /opt/fullstack-starter/backup-db.sh
chmod +x /opt/fullstack-starter/backup-db.sh
crontab -l 2>/dev/null | { cat; echo "0 3 * * * APP_DIR=/opt/fullstack-starter /opt/fullstack-starter/backup-db.sh >> /opt/fullstack-starter/backup.log 2>&1"; } | crontab -
```

Pour restaurer une sauvegarde compressée :

```bash
gunzip -c /opt/fullstack-starter/backups/app-20260101-030000.sql.gz \
  | docker compose -f /opt/fullstack-starter/docker-compose.prod.yml exec -T db psql -U app app
```

### Health-check + monitoring externe

L'app expose `GET /api/health` (public, pas besoin d'être connecté) — renvoie `200` avec
`{"status":"ok","db":"ok"}` si la base répond, `503` sinon. Utile pour :

```bash
curl https://ton-domaine.com/api/health
```

Branche un moniteur externe gratuit (ex. [UptimeRobot](https://uptimerobot.com)) sur cette URL
pour être alerté par email/SMS si le site tombe, plutôt que de le découvrir par hasard.

### Suivi d'erreurs (Sentry, optionnel)

Le code intègre déjà le SDK `@sentry/nextjs`, désactivé par défaut (aucune erreur si la clé est
absente). Pour l'activer :

1. Crée un compte gratuit sur [sentry.io](https://sentry.io) et un projet Next.js.
2. Copie le DSN fourni.
3. Ajoute-le au `.env` du VPS :
   ```dotenv
   SENTRY_DSN=https://ta_cle@o0.ingest.sentry.io/0
   ```
4. Recrée le conteneur (`up -d --force-recreate web`, voir l'encart de la section 3).

Seules les erreurs serveur réellement non gérées (bugs, panne DB, etc.) sont remontées — les
erreurs métier déjà gérées par les actions (email en doublon, validation...) ne le sont pas,
puisqu'elles ne remontent jamais jusqu'à ce niveau.

---

## Dépannage

- **`docker compose` échoue avec "permission denied"** → l'utilisateur `deploy` n'est pas dans le
  groupe `docker` (`sudo usermod -aG docker deploy`, puis reconnecte-toi en SSH).
- **`curl` renvoie `Recv failure: Connection was reset` en HTTPS** → Caddy n'a probablement pas pu
  obtenir son certificat (port 80/443 bloqué par le pare-feu, ou occupé par un autre service — voir
  section 4.0), ou n'est pas démarré. Vérifie `sudo systemctl status caddy` et les logs
  `sudo journalctl -u caddy --no-pager | tail -40`.
- **Le navigateur affiche la page "Congratulations! Caddy is ready"** → le `Caddyfile` est encore
  celui par défaut (`:80 { root * /usr/share/caddy ... }`), pas celui de la section 4.1. Vérifie
  avec `sudo cat /etc/caddy/Caddyfile` et corrige-le.
- **Le port 80 est occupé par un process `traefik` au démarrage du VPS** → c'est un conteneur
  préinstallé par le template Hostinger (catalogue d'apps hPanel), pas un service `systemd` — voir
  la procédure d'arrêt en section 4.0. `systemctl stop traefik` ne fonctionnera pas puisque ce
  n'est pas un service système.
- **L'app redirige vers un domaine légèrement différent de celui attendu (ex. `devad.com` au lieu
  de `devadn.com`)** → coquille dans `AUTH_URL` du `.env` du VPS. Corrige-la, puis **recrée** le
  conteneur (`up -d --force-recreate web`, pas `restart` — voir l'encart de la section 3).
- **Une variable d'environnement modifiée dans `.env` ne semble pas prise en compte** → confirme
  toujours avec `docker exec fullstack_starter_web env | grep NOM_VAR` après un
  `up -d --force-recreate web`. Un simple `restart` réutilise l'environnement figé à la création
  du conteneur.
- **Erreur `Must supply api_key` lors de l'ajout d'une photo client** → la variable
  `CLOUDINARY_URL` est absente ou vide dans le `.env` du VPS (elle n'est pas générée automatiquement
  par le script de bootstrap). Ajoute-la (section 3) puis recrée le conteneur.
- **Les liens de réinitialisation de mot de passe n'arrivent jamais par email** → `RESEND_API_KEY`
  n'est pas configurée : le lien est simplement journalisé dans les logs du conteneur
  (`docker compose logs web`) au lieu d'être envoyé. Ajoute la clé (section 3) puis recrée le
  conteneur.
- **Erreur `Cannot find module './app/generated/prisma/client'`** lors d'un script `node` manuel →
  le client Prisma généré par ce projet est du **TypeScript source** (générateur `prisma-client`),
  pas du JS compilé ; il ne peut pas être `require()`-é directement par `node` en dehors du build
  Next.js. Pour un script ponctuel (ex. créer un compte), utilise `pg` directement en SQL brut
  (voir section 8) plutôt que d'importer le client Prisma généré.
- **`prisma db seed` échoue avec `spawn tsx ENOENT`** → normal en production : `tsx` est une
  dépendance de dev, absente de l'image (`npm prune --omit=dev` dans le [Dockerfile](../Dockerfile)).
  Le seed ne peut pas tourner tel quel dans le conteneur ; crée ton compte admin via la procédure de
  la section 8.
- **Le site répond en HTTP mais pas HTTPS** → vérifie que les ports 80/443 sont ouverts (pare-feu
  Hostinger **et** `ufw`), et que le DNS pointe bien vers le VPS (`nslookup ton-domaine.com`).
- **Erreur d'auth / redirections en boucle derrière le proxy** → vérifie que `AUTH_TRUST_HOST=true`
  et `AUTH_URL` sont bien dans le `.env` du VPS (sans faute de frappe), et que Caddy/Nginx transmet
  `X-Forwarded-Proto`/`X-Forwarded-Host` (Caddy le fait par défaut ; voir la config Nginx ci-dessus
  pour l'équivalent).
- **Les migrations ne s'appliquent pas** → regarde les logs du conteneur `web` au démarrage
  (`docker compose logs web`), l'étape `prisma migrate deploy` s'exécute avant `npm run start`
  dans `docker-entrypoint.sh`.
- **Le workflow GitHub Actions échoue à l'étape SSH** → vérifie que `VPS_SSH_KEY` contient bien la
  clé **privée** complète (avec les lignes `-----BEGIN...-----`/`-----END...-----`), et que
  `VPS_HOST`/`VPS_USER`/`VPS_PORT` correspondent à ta configuration SSH (le port n'est pas toujours
  `22` sur Hostinger — voir étape 1).
