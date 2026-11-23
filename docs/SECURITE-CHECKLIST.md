# Checklist sécurité — OWASP ASVS 5.0

Checklist **vivante**, à l'inverse de `ASVS-2026-08.md` qui est un audit daté
(fait sur ASVS 4.0.3, dont la numérotation des chapitres a entièrement changé
en 5.0). Ici : ce qui est **acquis**, **où c'est appliqué dans le code**, et ce
qui reste à vérifier.

- **Référentiel** : [ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0) (mai 2025), niveau **L2** — l'app manipule des données métier réelles et des données personnelles.
- **Qui la lit** : le `security-auditor` en premier, à chaque feature. Il vérifie d'abord les **régressions** sur les lignes ✅, puis se concentre sur ce que la feature ajoute.
- **Qui la maintient** : le `capitaliseur`, qui signale quand la réalité diverge de ce document.

**Légende** — ✅ acquis et prouvé · ⚠️ à confirmer · ⬜ jamais audité · ➖ non applicable

Le symbole de la colonne **État** donne l'état d'**aujourd'hui**. Un ⚠️ à
l'intérieur de la colonne **Où** ne s'y substitue pas : il raconte un **écart
passé** — une ligne qui a porté ✅ à tort — et se lit comme de l'historique.
Il est conservé parce qu'une ligne déjà fausse une fois est la première à
re-vérifier, et parce que quatre ✅ de ce document se sont révélés faux d'un
coup. Une phrase par écart, pas un récit : le détail vit dans la PR citée.

---

## V1 — Encodage et assainissement

| Exigence | Où | État |
|---|---|---|
| Échappement de sortie | React échappe par défaut ; `lib/email/render.ts` échappe explicitement et rejette les URL non-http(s) | ✅ |
| Pas d'injection SQL | Accès exclusivement via Prisma (paramétré). Une exception : `Prisma.raw` (`repository/tasks.ts::ASSIGNEE_COLUMN`) splice trois identifiants de colonne depuis une table littérale fermée — jamais une valeur d'exécution — et `${projectId}` dans le même tagged-template reste un paramètre lié, pas concaténé. Verrouillé par `tests/prisma-raw-literal-guard.test.ts` : tout `Prisma.raw` dont l'argument n'est pas un littéral de chaîne, ou tout `$queryRawUnsafe`/`$executeRawUnsafe`, fait rougir la suite. Détail : `docs/CONVENTIONS.md` § SQL brut (Prisma.raw) | ✅ |
| En-tête `Content-Disposition` | Nom de fichier PDF slugifié en ASCII (testé) | ✅ |
| Valeurs de la base interpolées dans du CSS | Couleurs de thème et de statut de réserve : Zod `hexColor` à l'écriture, `CHECK` **ancré** en base (`~` est une correspondance non ancrée en PostgreSQL — sans `^…$`, `#000000; background:url(…)` passe), puis `safeHex` juste avant l'interpolation dans le `<style nonce>` (`app/layout.tsx`, `components/ReserveStatusStyleVars.tsx`), lié à ses sites d'appel par `tests/style-color-injection-guard.test.ts`. ⚠️ Ce ✅ a certifié une couche absente du 2026-08-23 au 2026-08-28 : `AppSettings.primaryColor`/`accentColor` n'avaient **aucun** `CHECK`, seules les colonnes de `Project` en portaient un. Réparé par la migration `20260828100000`. Se recompte dans `pg_constraint`, pas en relisant cette ligne | ✅ |

## V2 — Validation et logique métier

| Exigence | Où | État |
|---|---|---|
| Toute entrée validée par un schéma | Zod sur chaque mutation (`schemas/*.ts`). ⚠️ **Cette ligne était ✅ à tort avant PR #187** : `updateClient` faisait un cast, son schéma était déclaré et importé par aucun fichier. Une déclaration n'est pas un usage — cette ligne se re-vérifie par `grep` du symbole, pas par sa présence dans `schemas/` | ✅ |
| Bornes sur les entrées | Plafonds de texte partagés (`schemas/fields.ts`, téléphone 80 depuis #247 — chaque exemple de son commentaire est compté et testé) ; imports CSV (`lib/csv.ts`) : 8 Mio vérifiés sur `file.size` **avant lecture**, 40 colonnes et 1000 lignes refusées **avant de construire les lignes** ; 200 par suppression en masse, `MAX_SERIES_SIZE` sur les séries de tâches ; `Infinity` rejeté par les coercitions ; dates `AAAA-MM-JJ` réelles, années 1900–2100, début ≤ fin d'un chantier (une date hors bornes rendait `/projects/export` en 500 **définitivement, pour tous les rôles**). ⚠️ **Ce ✅ couvrait un déni de service** jusqu'à #247 : le plafond de lignes n'était compté qu'après la construction d'un objet par ligne portant toutes les colonnes de l'en-tête — 265 Ko à 100 000 colonnes montaient à 1,75 Go ; le fichier est désormais refusé en 0,3 s. En prod à `0e10b1b` (sonde de version, 2026-11-23) | ✅ |
| Écriture partielle : absent ≠ vide | Un champ omis d'une mise à jour ne s'efface plus (#249) : plus aucun `.default()` dans les schémas de mise à jour, champs effaçables par `clearable` / `clearableDateField` (absent = inchangé, vide = effacé), dépôts qui transmettent `undefined` tel quel ; une borne de date envoyée seule se compare à l'autre **lue en base sous `FOR UPDATE`** ; `parseAssignee` refuse le malformé au lieu de le lire « aucune affectation ». Verrou : `tests/repository-partial-write.test.ts` interdit `?? null`, `\|\| null` et `?? <défaut>` dans le `data` d'une mise à jour, domaine découvert et compté exactement (à `0e10b1b` : 16 fichiers de `repository/` et 43 appels, 13 fichiers d'actions et 19 appels). En prod à `0e10b1b` | ✅ |
| Séquençage / anti-course | Scan et cumul matériel en transaction ; compteur monotone pour les réserves ; configuration d'une fonction écrite en une seule transaction validée (`saveFunctionConfig`, #247, à la place de trois actions parallèles) ; règle du compte relais vérifiée et écrite dans la transaction qui verrouille la fonction puis le compte (`SELECT … FOR UPDATE`, toujours dans cet ordre — #248 ; sonde : sans le verrou, le test de concurrence rougit 3 fois sur 3). Le test de **non-interblocage** n'a pas pu être rougi par sonde (fenêtre trop étroite) : c'est un test de non-régression, l'ordre des verrous se prouve à la lecture | ✅ |
| Anti-automation | Login 5/15 min par email (20/IP) ; reset 3/15 min ; **scan LLM 20/h par utilisateur, 60/h par IP** (budget vérifié avant réservation) | ✅ |

## V3 — Sécurité du front web

| Exigence | Où | État |
|---|---|---|
| CSP sans `unsafe-inline` | CSP à nonce, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'` | ✅ |
| Anti-clickjacking | `X-Frame-Options: DENY` + `frame-ancestors` | ✅ |
| `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP | vérifiés live | ✅ |
| Violations CSP `style-src` en console | **6 attributs `style` résiduels dans 4 fichiers**, tous des composants client (recomptés le 2026-08-28 en parsant l'AST, balises intrinsèques + `next/image` seulement) : violations en console et état pré-hydratation faux. ⚠️ Ce n'est du « bruit » que par accident — sur un Server Component le même attribut ne rend **rien du tout**, et c'est ainsi que toute la PR #196 avait été écrite. Mécanisme correct, liste des 6 et méthode de recomptage : `docs/CONVENTIONS.md` § Couleurs dynamiques et CSP | ⚠️ |

## V4 — API et services web

| Exigence | Où | État |
|---|---|---|
| Autorisation sur chaque handler | Proxy protège `/api/**` ; `/api/auth` et `/api/health` publics par exception (`lib/routeGuard.ts`). Les rubriques de l'app (`/`, `/clients`, `/projects`, `/loans`, `/admin`, `/portail`) sont dans `PROTECTED_PATHS`, et `tests/route-guard-area-coverage.test.ts` l'exige pour chaque entrée d'`AREA_HREFS` (page et sous-arbre). ⚠️ **`/loans` a été implémenté sans entrée proxy** (PR #230, trouvé en revue avant merge) : anonyme et CLIENT n'étaient arrêtés que par la page elle-même — la défense en profondeur de la ligne « Frontière portail CLIENT » n'existait pas pour cette rubrique. Le test découvre par la table depuis `9f718ec`, en prod le 2026-09-20 | ✅ |
| CSRF | Aucun handler mutant : tout passe par des Server Actions (vérification d'origine Next.js) | ✅ |
| **Routes d'export/téléchargement gardées ET bornées** | `canAccessArea` sur les 3 exports CSV + `take` borné ; `GET /api/assets/[kind]/[id]` (téléchargement/affichage des fichiers de projet, plans et photos de réserves) rejoue le même ordre de gardes (identité → rubrique → section → résolution en base → accès projet) — voir `docs/CONVENTIONS.md` | ✅ |

## V5 — Manipulation de fichiers

| Exigence | Où | État |
|---|---|---|
| Type de fichier vérifié serveur | **Magic bytes + extension sur les six chemins d'upload** (`lib/fileSignature.ts`, extrait du scan plutôt que dupliqué), HEIC/AVIF/BMP/TIFF compris — sauf la photo d'équipement (PR #230), qui les **refuse** avec un message explicite parce qu'elle part vers une URL publique après retrait EXIF/GPS et que ce retrait n'est prouvé que sur JPEG/PNG/WebP/GIF (`docs/CONVENTIONS.md`, « Vrai type d'un fichier »). Compte refait le 2026-09-20 à `9f718ec` sur les `export async function upload*` de `lib/cloudinary.ts` : « cinq » était vrai jusqu'à #230. Avant PR #187 : aucun chemin ne lisait un octet, et le blocage des contenus dangereux n'existait que sur deux chemins sur quatre — les deux non couverts partant en URL Cloudinary publique. ⚠️ **Cette ligne comptait « quatre » à tort** : `uploadReservePlan` (plan de réserve, `lib/cloudinary.ts`) était resté sur `file.type`/l'extension seuls, sans lire un octet — trouvé par la passe adverse EDITOR (lot C1, #3), fermé par `looksLikePdf` (signature `%PDF-`, tolérance des 1024 premiers octets prévue par le format) | ✅ |
| SSRF sur récupération distante | Allowlist `res.cloudinary.com` + timeout + plafond de taille | ✅ |
| **URL Cloudinary publiques — nouveaux uploads** | `deliveryType` gardé (`AUTHENTICATED`) dès la création pour ProjectFile/ReservePlan/ReservePhoto ; livrés uniquement par `GET /api/assets/[kind]/[id]`, qui signe l'URL côté serveur et re-vérifie l'accès à chaque requête (jamais l'URL Cloudinary brute vers le client) | ✅ |
| **URL Cloudinary publiques — données existantes avant cette migration** | les lignes créées avant ce changement restent en `deliveryType = 'UPLOAD'` et leur asset Cloudinary reste joignable par son ancienne URL publique, sans aucune garde, **jusqu'à ce que `scripts/retype-existing-guarded-assets.mjs --execute` ait tourné avec zéro échec** (idempotent, ré-exécutable). Il se lance **depuis le conteneur applicatif**, `docker exec fullstack_starter_web node scripts/retype-existing-guarded-assets.mjs` (sans flag = dry-run) — procédure complète, reprise après interruption et avertissement sur les liens déjà partagés dans [`deploy/README.md`](../deploy/README.md). Le nombre de lignes encore concernées est exposé en clair (compteur agrégé) sur `GET /api/health` (`pendingGuardedAssets`), justement pour que ce point ne reste pas silencieusement faux. **Lu le 2026-11-23 sur la production (`version` `0e10b1b`) : `pendingGuardedAssets: 0`** — plus aucune ligne en `UPLOAD`. Ce compteur lit la base, pas Cloudinary : il prouve que le script a marqué chaque ligne, l'état de l'asset distant s'en déduit (le script ne met la ligne à jour qu'après la bascule distante, voir son en-tête) | ✅ (était ⚠️ tant que le compteur n'était pas à 0) |

## V6 — Authentification

| Exigence | Où | État |
|---|---|---|
| Hachage des mots de passe | bcrypt coût 10 (`service/auth.ts`) | ✅ |
| Anti-énumération de comptes | `DUMMY_HASH` égalise le temps de réponse ; reset toujours générique | ✅ |
| Tokens de récupération hachés | SHA-256 stocké, usage unique, expirant, 32 octets (`lib/resetToken.ts`) | ✅ |
| Pas d'empoisonnement du lien | `AUTH_URL` requis en prod, l'en-tête `Host` n'est jamais suivi | ✅ |

## V7 — Gestion de session

| Exigence | Où | État |
|---|---|---|
| Cookies durcis | `__Host-` / `__Secure-`, HttpOnly, Secure, SameSite=Lax | ✅ |
| Déconnexion invalidante | **Non : la déconnexion n'invalide rien côté serveur.** Les sessions sont des JWT sans état serveur (`auth.config.ts`, `strategy: "jwt"`) : `signOut` efface le cookie **du navigateur qui se déconnecte**, et c'est tout. Une copie du jeton (autre appareil, cookie exfiltré) reste valide tant que le compte existe — et chaque requête qui l'utilise la ré-émet pour 30 jours de plus, elle n'expire donc que 30 jours après son dernier usage (en-tête de `lib/sessionGate.ts`) ; seule la suppression du compte l'annule (V9). ⚠️ **Cette ligne portait ✅ « `signOut` Auth.js » à tort**, reprise de `ASVS-2026-08.md` (V3.3.1), sans que le mécanisme ait été lu (corrigé le 2026-11-23, à `0e10b1b`) | ⚠️ |

## V8 — Autorisation

| Exigence | Où | État |
|---|---|---|
| Contrôle **côté serveur**, centralisé | 3 axes : `requireCapability`, `requireSectionAccess`/`requireAreaAccess`, `requireProjectAccess` — plus, depuis PR #230 (`9f718ec`), la **propriété** d'une ligne pour la rubrique Prêts : `lib/currentUser.ts::getLoansActor` résout l'id du « moi » **en base** par l'e-mail de session (la session ne porte pas d'id), et chaque mutation d'`actions/equipment` et `actions/equipmentLoans` résout la ligne puis exige propriétaire ou ADMIN+ ; hors périmètre ⇒ même message qu'inexistant, emprunteur CLIENT compris. Décision A : l'emprunteur peut clore son propre prêt (`updateMany` sur `returnedAt IS NULL`, idempotent), pas l'éditer ni le supprimer | ✅ |
| **Mutations de contenu d'un projet gardées par la rubrique `projects`**, pas seulement leur section | Les **47** actions exportées des **13** fichiers d'`OWNED_BY_SECTION` (`tests/authz-coverage.test.ts` : tâches, groupes, catégories de tâches, affectation, matériel, catégories de matériel, scan de bulletin, interventions, sous-traitants, intérimaires, travailleurs, fichiers, réserves) appellent `requireAreaAccess("projects")`, puis `requireSectionAccess` **avec la section de leur fichier** (`SECTION_BY_FILE`), puis `requireProjectAccess` (46 sur 47 : `scanDeliveryNote` exempté, raison et condition de disparition dans le test) — et **refusent sur chaque résultat** avant tout effet. Compte exact affirmé par le test (`OWNED_ACTIONS_EXPECTED`), vert à `0e10b1b`. Depuis #249, chaque garde est exigée **par son argument**, résolue par import, et le refus sous sept formes qui passaient jusque-là (throw avalé, branche conditionnelle, `finally`, écriture dans la branche de refus, effets hors des trois couches, import par espace de noms ou relatif, export par `export { }` / `default` / ré-export). ⚠️ Écarts passés, une phrase chacun : ces mutations n'avaient que leur section avant la passe adverse EDITOR (lot C1, #1) ; le compte « 41 », publié sans son commit, a périmé le jour même (`updateReserveStatusStyle`, `3255e2b`) ; jusqu'à #249 `requireAreaAccess` n'était exigé que **par son nom** — `requireAreaAccess("loans")` collé dans une action de projet passait. Reste écrite à la main : la liste `OWNED_BY_SECTION` elle-même (ligne « Test structurel » ci-dessous) | ✅ |
| Filtrage **dans la requête**, pas au rendu | listes, page projet, tableau de bord, exports, PDF. ⚠️ **Cette ligne portait ✅ alors qu'elle était fausse** : jusqu'à PR #187, les deux corbeilles, les deux journaux d'activité, le tableau de bord d'un chantier, le tableau de bord d'accueil et `getBreadcrumb` ne filtraient sur aucun périmètre. Une ligne de cette checklist ne vaut que par l'énumération des surfaces qu'elle couvre — « tableau de bord » au singulier en cachait deux non gardés | ✅ |
| Corbeille gelée | Le contenu d'un chantier à la corbeille — **ou d'un chantier vivant dont l'entreprise est à la corbeille** (la mise à la corbeille d'une entreprise ne cascade pas) — ne se modifie plus par appel direct : `requireProjectAccess` lit l'état de corbeille après le périmètre, sa définition est écrite une fois (`lib/projectTrash.ts::projectTrashState`) et vaut aussi pour les lectures (pages, `/api/assets`, rapports, portail) ; son inverse `requireTrashedProjectAccess` n'est appelé que par la restauration et la destruction (test structurel). `requireClientAccess` refuse une entreprise absente ou à la corbeille. ⚠️ Avant #245, la corbeille ne gelait que l'écran. En prod à `0e10b1b` | ✅ |
| Pas d'auto-élévation | **Un ADMIN dont la fonction masque des rubriques ne peut ni lever ses restrictions, ni devenir — ou se faire — un compte qu'elles ne lient pas.** Leviers recensés **depuis les écritures** sur `User`, `JobFunction` et les jetons (méthode et table : `docs/CONVENTIONS.md`, « Personne ne modifie la contrainte… »), tous fermés : éditer, repointer ou supprimer sa propre fonction (lot C1) ; créer ou promouvoir un ADMIN, fixer le mot de passe d'un autre ADMIN, lever la fonction d'un autre ADMIN (lot 1, #242) ; le **compte relais** — créer ou reprendre un compte moins restreint, y compris un login de portail CLIENT (lot 5a, #248). Règle unique, `lib/accountPolicy.ts` : un compte n'est géré que si sa fonction, avant **et** après, masque au moins les rubriques de l'acteur (`mayManageAccountWithFunction`) ; une fonction portée ne rend visible rien de ce qu'elle cachait (`mayChangeHeldFunction`) ; pas de login de portail pour qui masque `projects` (`mayProvisionPortalLogin`) ; aucun rôle ne passe vers CLIENT ni n'en sort. Vérification et écriture dans la transaction qui verrouille la fonction (V2, « anti-course »). Sortie de secours SUPERADMIN ; `LOCKED_CAPABILITIES` non délégables. Verrou : `tests/account-writers-coverage.test.ts` **découvre** les écrivains de comptes (13) et les actions qui les atteignent (13) par leurs écritures, tailles exactes, et exige la règle par action, résolue par binding — vert à `0e10b1b`. En prod à `0e10b1b` (2026-11-23). ⚠️ Ce compte a été publié faux quatre fois, toujours par le bas : « deux », « trois », « six » (la méthode ne lisait pas les écritures du rôle ni du mot de passe), puis « huit, sept fermés » à `96b041b`, qui ne comptait pas `createPortalLogin`, écarté ailleurs parce qu'il « ne crée qu'un CLIENT » — or un CLIENT lit par le portail les chantiers auxquels il est lié : c'était un relais de plus, fermé par #248 avec la prise de contrôle d'un login de portail par `updateUser`. Les noms `setFunctionAreas` / `setFunctionSections` / `setFunctionScope` des versions précédentes de cette ligne n'existent plus : remplacés par `saveFunctionConfig` (#247) | ✅ |
| Anti-IDOR | l'id qui autorise est **résolu en base**, jamais lu dans un formulaire | ✅ |
| Anti-énumération | hors périmètre ⇒ « introuvable », jamais « interdit » ; les refus de périmètre sont typés (`lib/scopeRefusal.ts`) et `forbidden` / `absent` rendent le même message — les deux raisons de corbeille ne sortent que vers qui atteint déjà la ligne (#245) | ✅ |
| Énumération d'e-mail d'entreprise par `addClient` | L'unicité de `Client.email` fait répondre « une entreprise avec cet email existe déjà » : qui peut créer une entreprise apprend si un e-mail est déjà en base, même hors de son périmètre | ⚠️ **risque accepté par l'humain le 2026-11-22** (arbitrage du lot 2, #245) — à rouvrir si l'e-mail d'entreprise devient une donnée confidentielle ou si la création s'ouvre à des comptes externes |
| Frontière portail CLIENT | proxy **et** `blockClientFromApp()` (défense en profondeur) | ✅ |
| Test structurel de couverture | `tests/authz-coverage.test.ts` échoue si une action exportée saute sa garde, **lectures comprises depuis PR #187** ; depuis #249, chaque garde attendue est exigée **par son argument** (rubrique, section), résolue par import, et le refus sur son résultat — y compris `AREA_BY_FILE` (plusieurs rubriques par fichier : `createPortalLogin` en exige deux), les exports CSV, les sept routes de rapport découvertes par leur dossier, `/api/assets`, les pages de rubrique ; `tests/project-section-authz-coverage.test.ts` exige la clé de **la** route. Découverts plutôt que nommés : les écrivains de comptes, par leurs écritures (`tests/account-writers-coverage.test.ts`) ; les mises à jour partielles, par leurs appels (V2) ; hors `OWNED_BY_SECTION`, les fichiers d'actions qui importent une garde de corbeille de `lib/access` (4 fichiers, 21 actions, comptés exactement) — cette dernière découverte part de l'import de la garde, elle ne voit donc pas un fichier qui n'en importe aucune. ⚠️ Toujours **écrites à la main** : `OWNED_BY_SECTION` (13 fichiers, dont `SECTION_BY_FILE` est vérifié égal) et `AREA_BY_FILE` — un fichier d'actions neuf qu'aucune des deux ne nomme n'est vérifié par aucune d'elles (`docs/CONVENTIONS.md`, « Tests »). ⚠️ Écart passé : un `READS = new Set([...])` en exemptait trois lectures et *était* le trou ; jusqu'à #249, six vérifications n'exigeaient la garde que par son nom. Toute exemption porte sa raison et la condition de sa disparition | ✅ |

## V9 — Jetons autoportants (JWT)

> Chapitre **nouveau en 5.0**, directement pertinent : les sessions sont des JWT.

| Exigence | Où | État |
|---|---|---|
| Algorithme et signature vérifiés | délégué à Auth.js v5 | ⚠️ à confirmer explicitement |
| Durée de vie et rotation | valeurs par défaut Auth.js — jamais examinées | ⬜ |
| Révocation | **Suppression d'un compte** : la session est annulée dès la requête suivante — `lib/sessionGate.ts` ré-interroge la ligne `User` à chaque relecture du jeton et, si elle n'existe plus, l'annule (échec fermé). Couvert par `tests/session-gate.test.ts`, `tests/session-reader-refusal.test.ts` (sonde par lecteur de session) et `tests-integration/session-gate.test.ts`. Fenêtre résiduelle : une suppression survenue pendant une requête déjà en cours ; un SUPERADMIN supprimé termine la sienne. **Changement de rôle** : le rôle du jeton n'est jamais relu — ouvert (H1, PR à part). **Changement de mot de passe** : ne coupe pas les sessions ouvertes — ouvert. **Désactivation** : n'existe pas dans l'application. **Suppression : prouvé par passe adverse** (2026-11-22, `50078ff`, build de production, vrai flux de connexion) : un EDITOR et un **SUPERADMIN** supprimés pendant que leur session était ouverte n'obtiennent, dès la requête suivante, rien de plus qu'un anonyme — « Non autorisé » sur une action de chaque famille, 401 sur les sept routes de rapport, les exports et `/api/assets`, redirection vers `/login` sur les pages, `/api/auth/session` à `null` ; un compte recréé avec le même e-mail ne réactive pas l'ancien cookie. Le cookie mort n'est pas effacé (le proxy le re-signe) sans rien ouvrir. **Le changement de mot de passe reste ouvert, prouvé par la même passe** : l'ancien cookie d'un ADMIN agit encore après `updateUser(password=…)`. Ligne ⚠️ tant que rôle et mot de passe ne révoquent pas | ⚠️ |

## V11 — Cryptographie · V12 — Communications · V13 — Configuration

| Exigence | Où | État |
|---|---|---|
| Entropie des tokens | `crypto.randomBytes` | ✅ |
| Secrets hors dépôt | `.env` serveur, `AUTH_SECRET` jamais commité | ✅ |
| TLS + HSTS | Caddy, `max-age=31536000 ; includeSubDomains` | ✅ |
| App non exposée directement | écoute `127.0.0.1:3000` | ✅ |
| Pas de divulgation de version | `poweredByHeader: false`, en-tête `Server` retiré | ✅ |
| Dépendances | `npm audit`, Snyk en CI, Actions épinglées sur SHA | ✅ |
| **fail2ban** lisant le bon backend (`systemd`) | serveur — jamais confirmé appliqué | ⚠️ |
| **ufw** activé | serveur — jamais confirmé appliqué | ⚠️ |

## V14 — Protection des données · V16 — Journalisation et erreurs

| Exigence | Où | État |
|---|---|---|
| Pas de champ sensible vers le client | `select` explicite ; `findAllOptions` pour les dropdowns (ne sérialise pas la posture d'accès). ⚠️ **Cette ligne était ✅ à tort avant PR #196** : `repository/projects.ts::findById` faisait `include: { client: true }` et deux pages passaient le résultat tel quel à un composant client — toute la ligne entreprise (e-mail, téléphone, adresse) partait dans la charge RSC, donc dans le HTML, sur des pages gardées par la rubrique `projects` et non `clients`. Resserrer le **type de la prop** ne protège rien (TypeScript est structurel) : cette ligne se re-vérifie sur les `include`/`select` des repositories, jamais sur les types des composants. Prêts (PR #230) : l'annuaire des emprunteurs (`repository/users.ts::findBorrowerOptions`) projette `{id, name}` hors CLIENT et n'est chargé que pour qui peut prêter ; `EQUIPMENT_LIST_SELECT` resserré à ce que la page lit ; la photo d'équipement est **publique par choix** (vignette d'outil, comme le logo et la photo d'entreprise) mais passe par `lib/imageMetadata.ts::stripArchivedPhotoMetadata` avant upload — orientation appliquée, EXIF/GPS retirés, vérifié sur l'asset publié ⚠️ **Cette ligne était aussi ✅ à tort jusqu'à #245** : `deleteUser` renvoyait au navigateur la ligne supprimée, **hash bcrypt compris** ; les écritures de `repository/users.ts` ont désormais un `select` minimal, et les actions de contacts et d'entreprises ne renvoient plus de lignes complètes. Une action **mutante** expose ce qu'elle renvoie au même titre qu'une lecture : 44 actions de contenu renvoient encore leur ligne en `data`, sans champ sensible (chiffre publié par #245, non recompté ici ; laissé en liste d'attente) | ✅ |
| `Cache-Control: no-store` sur les PDF | `…/reserves/report/route.ts`, les cinq `…/dashboard/report/**/route.ts` (PR #225) et `/api/assets/[kind]/[id]` — sept routes, recomptées par grep le 2026-09-12 | ✅ |
| Aucun secret journalisé, messages d’erreur génériques | `getErrorMessage` ; les erreurs de SDK tiers ne sont plus relayées (garde `isAppError` au site d’appel) | ✅ |
| Rétention / purge des données personnelles (RGPD) | aucune politique implémentée | ⬜ |

## V15 — Codage sécurisé et architecture

| Exigence | Où | État |
|---|---|---|
| Contrôle d'accès résolu en un seul endroit | `lib/accessContext.ts` | ✅ |
| Authentification non dupliquée | Auth.js + `lib/authorizeCredentials.ts` | ✅ |

## ➖ Non applicable — et pourquoi

- **V10 OAuth / OIDC** — authentification par identifiants uniquement, aucun fournisseur externe.
- **V17 WebRTC** — pas de temps réel audio/vidéo.

---

## Volet LLM — scan de bulletin de livraison

> **Audité le 2026-08-08**, écarts techniques corrigés. `lib/deliveryNoteScan.ts`
> envoie une **image fournie par l'utilisateur** à Claude Sonnet 5. L'ASVS ne
> couvre pas cette surface ; référentiel : *OWASP Top 10 for LLM Applications*.
>
> ⚠️ **Il n'y a pas de repli runtime vers OpenAI** — contrairement à ce que
> laissaient croire un commentaire du code et une version antérieure de ce
> document. `activeProvider()` lit `OCR_PROVIDER` : c'est un **aiguillage par
> variable d'environnement**, choisi au démarrage.

| Risque | Où | État |
|---|---|---|
| **Injection de prompt indirecte** | instruction dans un `system` prompt, placée avant l'image, avec mention explicite que le texte visible est une donnée ; forme verrouillée par `tool_choice` ; chaînes sanitisées côté serveur (caractères de contrôle et marques bidi retirés, troncature réelle) | ✅ |
| **Validation de la sortie** | schéma Zod sur les deux chemins fournisseur ; les 3 `as` sur des valeurs réseau ont été supprimés | ✅ |
| **Confusion de données** | l'id qui autorise **est** celui sur lequel on écrit ; `updateMany` scopé projet ; `clientId` résolu en base, retiré du formulaire | ✅ |
| **Coût / déni de service** | 20 scans/h par utilisateur, 60/h par IP — budget vérifié **avant** réservation, puis réservé avant l'appel payant (un utilisateur bloqué ne réalimente plus sa propre fenêtre) ; `timeout: 60s`, `maxRetries: 1` ; tableau borné à 200 lignes, chaînes à 200 caractères, quantité plafonnée | ✅ |
| **Bombe de décompression** | `limitInputPixels: 40_000_000` explicite sur les deux traitements sharp — la borne de 10 Mo porte sur les octets compressés, pas sur les pixels décodés : un PNG de 748 Ko atteignait 349 Mo de RSS | ✅ |
| **Vrai type d'image** | magic bytes (JPEG/PNG/GIF/WEBP) croisés avec l'extension ; le `media_type` en est dérivé | ✅ |
| **Réduction avant envoi** | longue arête 1568 px, JPEG 85, **EXIF/GPS/ICC/XMP supprimés**, orientation appliquée avant nettoyage ; échec propre **sans repli sur l'original**. ⚠️ **Ne jamais ajouter `.withMetadata()`** — `lib/deliveryNoteScan.ts::reduceImageForModel`, prouvé par `tests/delivery-note-scan-resize.test.ts` | ✅ |
| **Archive nettoyée** | l'original archivé est débarrassé de ses EXIF (dont GPS) **à résolution inchangée** — décision métier du 2026-08-08 : ces métadonnées reliaient une personne à un lieu et une heure, pour une valeur probante nulle. Nettoyage **avant** toute écriture en base : un échec ne laisse rien derrière lui | ✅ |
| **Dégradation ligne à ligne** | une ligne sans marque ni référence (« Frais de port »), ou à quantité 0 (reliquat), est **écartée** — elle ne fait plus échouer le bulletin entier. Le `.refine()` reste sur le schéma d'écriture | ✅ |
| **Messages d'erreur** | le module ne lève que des **codes stables**, traduits par l'action via le dictionnaire ; le détail technique (variable d'environnement, `APIError` fournisseur) ne va qu'au `console.error` serveur | ✅ |
| **Traçabilité** | log serveur structuré `{userEmail, projectId, provider, model, bytes, bytesSent, itemCount, durationMs, outcome}`, sans le contenu de l'image ni la sortie du modèle | ✅ |
| **Fuite via Sentry** | `recordInputs`/`recordOutputs` figés à `false` sur les intégrations IA — relever `tracesSampleRate` n'enverra pas les bulletins à un troisième tiers | ✅ |
| **`projectId` absent du log au scan** | la modale n'envoie pas encore le `projectId` à l'étape scan ; le champ est lu défensivement et vaut `null` | ⚠️ |
| **Bibliothèques natives de sharp** | sharp embarque ~20 bibliothèques natives de décodage (libvips, libpng, libwebp, libheif…) — terrain historique des CVE de parsing d'image, et **`npm audit` ne les couvre pas**. À suivre comme une dépendance de sécurité à part entière | ⚠️ |
| **Ce qui quitte le serveur** | l'image est désormais réduite et sans métadonnées, mais **le contenu du bulletin part toujours** : raison sociale, adresses, n° de BL, **noms et signatures manuscrites** — vers un serveur hors UE. DPA, base légale, information des personnes, rétention côté fournisseur | ⬜ **décision humaine** |
| **Second sous-traitant** | `openai` est déjà en dépendance de production : **une variable d'environnement sur le VPS** suffit pour rerouter tous les bulletins, sans redéploiement donc sans revue de diff. Le log rend désormais la bascule visible | ⬜ **décision humaine** |

---

## Quand rejouer

- **À chaque feature** : le `security-auditor` vérifie les régressions sur les ✅ touchés par le diff.
- **Passe adverse (`beta-tester`)** : quand un axe d'autorisation change, avant une mise en production sensible, sinon toutes les ~10 features. Elle ne remplace pas l'audit et ne lit pas un diff : elle attaque les points d'entrée serveur de toute l'app. Premier passage (PR #187) : 22 défauts, dont quatre ✅ de ce document qui étaient faux. **Un ✅ ici n'est acquis que jusqu'à la prochaine passe adverse.**
- **Passe complète** : à chaque changement d'architecture (nouvelle surface d'auth, nouveau tiers, nouveau type de donnée), ou tous les 6 mois.
- **À la sortie d'une révision ASVS** : re-mapper. Le passage 4.0.3 → 5.0 a renuméroté tous les chapitres et ajouté V9 (jetons autoportants), qui nous concerne directement.
