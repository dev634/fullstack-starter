# Déployer sur un VPS Hostinger

> ## ⚠️ Le mécanisme de déploiement a changé — lis ceci d'abord
>
> **La partie « le CI se connecte en SSH au VPS » de ce guide n'est plus d'actualité.**
> Le réseau de Hostinger droppe **par intermittence** les plages d'IP des runners GitHub
> (Azure) sur le port SSH non standard : le HTTPS passe toujours, le SSH sort en
> `Connection timed out` sans que rien ne soit en cause côté VM (fail2ban, ufw et iptables
> vérifiés propres, port en `ACCEPT`). Trois tentatives de fiabilisation (retry, `ssh-keyscan`
> tolérant, forçage IPv4) n'ont pas suffi.
>
> Le déploiement est désormais **pull-based** : le CI se contente de construire et pousser
> l'image sur GHCR, et **le VPS va la chercher lui-même** (webhook HTTPS + timer systemd).
> Plus aucune connexion entrante depuis le CI. **Procédure à jour : [`deploy/README.md`](../deploy/README.md).**
>
> Ce guide reste valable pour **tout le reste** : création du VPS, utilisateur `deploy`,
> Docker, Postgres, Caddy, variables d'environnement, sauvegardes. Ignore simplement les
> étapes qui installent une clé SSH de déploiement pour le CI (`VPS_SSH_KEY`, `ssh-copy-id`
> pour le CI) — elles ne servent plus.

Ce guide déploie l'app sur un **VPS Hostinger** : GitHub Actions build une image Docker →
la pousse sur **GHCR** (GitHub Container Registry) → le VPS la récupère et redémarre la
stack (`docker compose`). Les migrations Prisma (`prisma migrate deploy`) s'exécutent
automatiquement au démarrage du conteneur (voir [docker-entrypoint.sh](../docker-entrypoint.sh)).

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

Le compte créé est un **`SUPERADMIN`**, pas un `ADMIN` : c'est le compte de secours, le seul rôle
que rien ne contraint — ni fonction, ni rubriques masquées, ni périmètre de chantiers — et le seul
qui gère les comptes `ADMIN` et `SUPERADMIN`. Un `ADMIN` reste soumis aux restrictions de sa
fonction : si le premier compte en était un, personne ne pourrait lever une restriction posée par
erreur. Le rôle est écrit **explicitement** : la colonne n'a plus de valeur par défaut (migration
`20261123100000`), un `INSERT` sans rôle échoue au lieu de créer un administrateur en silence.

Relancé sur un e-mail **déjà existant**, le script sert de procédure de secours : il remplace le
mot de passe, remet le compte en `SUPERADMIN`, **révoque toutes ses sessions ouvertes**
(`sessionVersion` incrémenté), y compris celles d'un cookie volé, et **supprime ses liens de
réinitialisation non utilisés** (un lien envoyé avant le secours ne doit pas redonner la main), le
tout en une seule instruction SQL.

**Il refuse un e-mail qui appartient à un login de portail** (`role = 'CLIENT'`) : un compte du
portail est géré depuis son contact, et le promouvoir en `SUPERADMIN` par ici serait une
élévation hors de toute règle de l'application. Dans ce cas rien n'est écrit, le script affiche
l'erreur et sort avec un code non nul.

L'e-mail est normalisé (`trim().toLowerCase()`, exactement comme `lib/normalizeEmail.ts`) avant
l'`INSERT` : la base refuse toute autre forme (contrainte `User_email_normalized_check`), et c'est
sous cette forme que la connexion cherche le compte.

**1. Crée le script sur le VPS :**
```bash
cat > /opt/fullstack-starter/create-admin.js <<'EOF'
require('dotenv/config');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// Same canonical form as lib/normalizeEmail.ts; the database refuses any other.
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
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
  // ON CONFLICT (email) covers both unique indexes: every stored e-mail is
  // normalized (CHECK), so a clash on lower(email) is a clash on email.
  // The WHERE refuses a portal login: the row is then neither inserted nor
  // updated, nothing is returned (rowCount 0) and the DELETE below has no id.
  // `xmax <> 0` tells an UPDATE (existing row) from an INSERT (new row).
  // One statement: the upsert and the purge of the unused reset links commit together.
  const res = await client.query(
    `WITH account AS (
       INSERT INTO "User" (email, password, name, role)
       VALUES ($1, $2, $3, 'SUPERADMIN')
       ON CONFLICT (email) DO UPDATE SET
         password = EXCLUDED.password,
         name = EXCLUDED.name,
         role = 'SUPERADMIN',
         "sessionVersion" = "User"."sessionVersion" + 1
       WHERE "User".role <> 'CLIENT'
       RETURNING id, (xmax <> 0) AS existed
     ), purge AS (
       DELETE FROM "PasswordResetToken"
       WHERE "userId" IN (SELECT id FROM account) AND "usedAt" IS NULL
     )
     SELECT id, existed FROM account`,
    [email, hash, name]
  );
  await client.end();
  if (res.rowCount === 0) {
    console.error('❌ Refusé :', email, 'est un login du portail client. Rien n\'a été modifié.');
    process.exit(1);
  }
  console.log(
    res.rows[0].existed
      ? '✅ Compte existant mis à jour (mot de passe remplacé, sessions révoquées) : ' + email
      : '✅ Compte créé : ' + email
  );
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
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

#### Après une restauration : ce qu'elle ramène, et ce qu'il faut refaire (obligatoire)

Une restauration remet **toutes** les lignes à leur état de la sauvegarde. Rien n'y est
« réparé » : elle ramène aussi ce que des actions de sécurité avaient retiré depuis. Cinq choses
reviennent, et la rotation d'`AUTH_SECRET` n'en couvre qu'**une** (les cookies) :

| Ce qui revient | Couvert par la rotation d'`AUTH_SECRET` ? | À refaire à la main |
|---|---|---|
| **`User.sessionVersion` en arrière** : un cookie révoqué depuis la sauvegarde porte à nouveau la version courante de la base et redevient valide (`lib/sessionGate.ts`) | **Oui, entièrement.** Tout jeton signé avec l'ancien secret est invalide, quelle que soit la version qu'il porte. C'est strictement plus fort qu'un incrément, pas équivalent | Rien si on fait tourner le secret. Repli si la rotation est impossible : le saut de version ci-dessous |
| **L'ancien mot de passe** de tout compte changé depuis la sauvegarde — y compris un mot de passe changé *parce qu'il avait fuité* | **Non.** Un cookie n'est pas un mot de passe : l'attaquant ouvre une session neuve avec celui qu'il connaît | Rendre inutilisable le mot de passe de chaque compte changé depuis la sauvegarde (étape 4) : le titulaire repasse par « Mot de passe oublié » |
| **Les rôles, fonctions (rubriques masquées, périmètre de chantiers) et affectations de chantiers** resserrés depuis : un compte rétrogradé redevient ce qu'il était, une fonction restreinte redevient large | **Non** (le rôle est certes relu en base à chaque requête, mais c'est la base *restaurée* qui est relue) | Rejouer les resserrements (étape 5) |
| **Les comptes supprimés depuis** reviennent, avec leur ancien mot de passe et leur ancien rôle | **Non** | Les supprimer de nouveau (étape 6) |
| **Les liens de réinitialisation** non utilisés qui existaient alors | **Non** | Les supprimer (étape 7) |

**Le moyen de savoir *quoi* refaire n'existe pas dans l'application** : le journal d'activité
(`ActivityLog`, `ProjectActivityLog`) ne trace que les entreprises et les chantiers, jamais un
compte, et `User` n'a ni `updatedAt` ni date de changement de mot de passe. La seule source est
**l'état de la base juste avant la restauration**, qu'il faut donc **capturer avant**
d'écraser quoi que ce soit (étape 1). Si la base d'avant n'est plus lisible (disque perdu), voir
« Sans état d'avant » plus bas.

Les commandes ci-dessous supposent `cd /opt/fullstack-starter` et un `.env` qui porte
`POSTGRES_USER` / `POSTGRES_DB` (le script de sauvegarde les lit de la même façon). Notation :
`PSQL` désigne `docker compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"`.

**1. AVANT de restaurer : capturer l'état courant des comptes, de leurs fonctions et de leurs
affectations** (trois fichiers, lisibles par vous seul — ils contiennent des empreintes de mots de
passe) :

```bash
cd /opt/fullstack-starter && set -a && . ./.env && set +a && umask 077
PSQL='docker compose -f docker-compose.prod.yml exec -T db psql -U '"$POSTGRES_USER"' '"$POSTGRES_DB"
$PSQL -c '\copy (SELECT id, email, password, role, "jobFunctionId", "sessionVersion" FROM "User" ORDER BY id) TO STDOUT WITH CSV HEADER' > avant-user.csv
$PSQL -c '\copy (SELECT id, name, "hiddenSections", "hiddenAreas", "projectScope" FROM "JobFunction" ORDER BY id) TO STDOUT WITH CSV HEADER' > avant-function.csv
$PSQL -c '\copy (SELECT "A" AS project_id, "B" AS user_id FROM "_UserProjects" ORDER BY 1, 2) TO STDOUT WITH CSV HEADER' > avant-assign.csv
wc -l avant-*.csv
```

Faire aussi un `pg_dump` complet de la base d'avant (`scripts/backup-db.sh`) : c'est le seul moyen
de revenir en arrière si la restauration elle-même est la mauvaise opération.

**2. Restaurer** la sauvegarde (commande ci-dessus). Elle suppose une base **vide** : le `pg_dump`
du script n'a pas d'option `--clean`.

**3. Faire tourner `AUTH_SECRET`** : nouvelle valeur dans le `.env` du serveur
(`openssl rand -base64 32`), puis redémarrer le conteneur de l'application. Tout le monde devra se
reconnecter (voir `docs/SECURITE-CHECKLIST.md`, V9). Cette étape ferme les cookies, et seulement
eux.

*Repli, si la rotation est impossible* — il ne couvre que `sessionVersion`, **pas** le secret
éventuellement divulgué :

```bash
$PSQL -c 'UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1000000'
```

**Pourquoi pas `+ 1`** : la barrière compare par **égalité** (le jeton porte la version lue à la
connexion). Une sauvegarde prise à V=0, restaurée alors que la base avait vu deux incréments depuis
(V=2), serait ramenée à V=1 par un `+ 1` : un cookie émis à V=1 puis révoqué redevient valide. Un
saut d'un million passe au-dessus de toute version déjà émise. La colonne est un `INT` (maximum
2 147 483 647) : cette marge ne tient qu'environ **2 000 restaurations**, après quoi le repli ne
sert plus et seule la rotation reste.

**4. Mots de passe changés depuis la sauvegarde** : charger les fichiers d'avant dans des tables
de comparaison, puis rendre inutilisable le mot de passe de tout compte dont l'empreinte diffère.
Le titulaire passe par « Mot de passe oublié » (`/forgot-password`) ; l'empreinte posée n'a pas la
forme d'un hash bcrypt (60 caractères), donc aucune saisie ne peut la satisfaire.

```bash
docker compose -f docker-compose.prod.yml cp avant-user.csv db:/tmp/avant-user.csv
docker compose -f docker-compose.prod.yml cp avant-function.csv db:/tmp/avant-function.csv
docker compose -f docker-compose.prod.yml cp avant-assign.csv db:/tmp/avant-assign.csv
$PSQL <<'SQL'
CREATE TABLE restauration_avant_user ("id" int, "email" text, "password" text, "role" text, "jobFunctionId" int, "sessionVersion" int);
CREATE TABLE restauration_avant_function ("id" int, "name" text, "hiddenSections" text[], "hiddenAreas" text[], "projectScope" text);
CREATE TABLE restauration_avant_assign ("project_id" int, "user_id" int);
\copy restauration_avant_user FROM '/tmp/avant-user.csv' WITH CSV HEADER
\copy restauration_avant_function FROM '/tmp/avant-function.csv' WITH CSV HEADER
\copy restauration_avant_assign FROM '/tmp/avant-assign.csv' WITH CSV HEADER
SQL

# Les comptes concernés, À LIRE avant d'écrire (id seulement, jamais les empreintes) :
$PSQL -c 'SELECT u.id, u.email FROM "User" u JOIN restauration_avant_user a ON a.id = u.id WHERE a.password <> u.password ORDER BY u.id'

# Les rendre inutilisables et révoquer leurs cookies :
$PSQL -c "UPDATE \"User\" u SET password = '!restauration-' || md5(random()::text || u.id::text), \"sessionVersion\" = u.\"sessionVersion\" + 1000000 FROM restauration_avant_user a WHERE a.id = u.id AND a.password <> u.password"
```

Un compte qui existait avant la restauration et pas dans la sauvegarde n'est **plus dans la base** :
son titulaire a perdu son compte, à recréer (par la gestion des comptes), avec un mot de passe neuf.

**5. Rôles, fonctions et affectations resserrés depuis** : comparer, puis rejouer **à la main**
par l'écran de gestion des comptes et des fonctions (les règles d'autorisation de
`lib/accountPolicy.ts` s'y appliquent ; un `UPDATE` SQL les contournerait). Les requêtes de
comparaison :

```bash
# rôle ou fonction différents d'avant la restauration
$PSQL -c 'SELECT u.id, u.email, a.role AS role_avant, u.role AS role_restaure, a."jobFunctionId" AS fonction_avant, u."jobFunctionId" AS fonction_restauree FROM "User" u JOIN restauration_avant_user a ON a.id = u.id WHERE a.role <> u.role::text OR a."jobFunctionId" IS DISTINCT FROM u."jobFunctionId" ORDER BY u.id'
# rubriques masquées ou périmètre de chantiers différents
$PSQL -c 'SELECT f.id, f.name, a."hiddenSections" AS sections_avant, f."hiddenSections" AS sections_restaurees, a."hiddenAreas" AS rubriques_avant, f."hiddenAreas" AS rubriques_restaurees, a."projectScope" AS portee_avant, f."projectScope" AS portee_restauree FROM "JobFunction" f JOIN restauration_avant_function a ON a.id = f.id WHERE a."hiddenSections" <> f."hiddenSections" OR a."hiddenAreas" <> f."hiddenAreas" OR a."projectScope" <> f."projectScope"::text ORDER BY f.id'
# affectations de chantiers retirées depuis (présentes avant, absentes maintenant)
$PSQL -c 'SELECT a.project_id, a.user_id FROM restauration_avant_assign a WHERE NOT EXISTS (SELECT 1 FROM "_UserProjects" p WHERE p."A" = a.project_id AND p."B" = a.user_id) ORDER BY 1, 2'
```

Ces requêtes **listent** ; elles n'écrivent rien. Une fonction ou un compte créés depuis la
sauvegarde n'y figurent pas non plus (absents de la base restaurée).

**6. Comptes supprimés depuis** : ils reviennent. Les retrouver, puis les supprimer de nouveau par
l'écran de gestion des comptes (la suppression applique les gardes et la cascade de l'application) :

```bash
$PSQL -c 'SELECT u.id, u.email, u.role FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM restauration_avant_user a WHERE a.id = u.id) ORDER BY u.id'
```

Cette liste est **exacte** si la base d'avant était lisible : tout compte présent dans la base
restaurée et absent de l'état d'avant a été supprimé depuis la sauvegarde.

**7. Liens de réinitialisation** non utilisés qui existaient alors :

```bash
$PSQL -c 'DELETE FROM "PasswordResetToken" WHERE "usedAt" IS NULL'
```

**8. Nettoyer** : les tables de comparaison et les fichiers (ils portent des empreintes de mots de
passe), puis vérifier :

```bash
$PSQL -c 'DROP TABLE restauration_avant_user, restauration_avant_function, restauration_avant_assign'
docker compose -f docker-compose.prod.yml exec -T db rm -f /tmp/avant-user.csv /tmp/avant-function.csv /tmp/avant-assign.csv
shred -u avant-user.csv avant-function.csv avant-assign.csv 2>/dev/null || rm -f avant-user.csv avant-function.csv avant-assign.csv
curl -s https://devadn.com/api/health
```

**Sans état d'avant** (base illisible, disque perdu — la restauration est alors la seule source) :
les étapes 4 à 6 ne peuvent pas être calculées. Faire tourner `AUTH_SECRET`, supprimer **tous** les
liens de réinitialisation (étape 7), puis **tenir tout mot de passe pour compromis** : rendre
inutilisable celui de chaque compte (`UPDATE "User" SET password = '!restauration-' ||
md5(random()::text || id::text)`) et faire repasser chacun par « Mot de passe oublié » ; relire à la
main les rôles, fonctions et affectations (écran de gestion des comptes) contre ce que vous savez
avoir resserré ; accepter que les comptes supprimés depuis la sauvegarde soient revenus tant que
vous ne les avez pas retrouvés un à un.

**Limites, énoncées** : la procédure n'a **pas été rejouée sur une vraie restauration** (elle a été
écrite d'après le schéma et les requêtes ont été relues, pas exécutées contre la base de
production) ; elle repose sur un état d'avant capturé *avant* la restauration, qu'aucun script du
dépôt ne prend à votre place ; la comparaison des mots de passe se fait sur les empreintes, donc un
mot de passe changé puis remis à l'identique n'est (justement) pas listé ; `ProjectWorker`
(présence d'un salarié sur un chantier) et les autres tables métier reviennent aussi à l'état de la
sauvegarde, sans enjeu d'autorisation — ce ne sont pas des droits d'accès.

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
