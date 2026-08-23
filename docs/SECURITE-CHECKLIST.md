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
| Pas d'injection SQL | Accès exclusivement via Prisma (paramétré), aucune concaténation | ✅ |
| En-tête `Content-Disposition` | Nom de fichier PDF slugifié en ASCII (testé) | ✅ |

## V2 — Validation et logique métier

| Exigence | Où | État |
|---|---|---|
| Toute entrée validée par un schéma | Zod sur chaque mutation (`schemas/*.ts`). ⚠️ **Cette ligne était ✅ à tort avant PR #187** : `updateClient` faisait un cast, son schéma était déclaré et importé par aucun fichier. Une déclaration n'est pas un usage — cette ligne se re-vérifie par `grep` du symbole, pas par sa présence dans `schemas/` | ✅ |
| Bornes sur les entrées | Plafonds de texte partagés (`schemas/fields.ts`) ; 1000 lignes par import CSV, 200 par suppression en masse, `MAX_SERIES_SIZE` sur les séries de tâches ; `Infinity` rejeté par les coercitions ; dates réellement validées (une date hors bornes rendait `/projects/export` en 500 **définitivement, pour tous les rôles**) | ✅ |
| Séquençage / anti-course | Scan et cumul matériel en transaction ; compteur monotone pour les réserves | ✅ |
| Anti-automation | Login 5/15 min par email (20/IP) ; reset 3/15 min ; **scan LLM 20/h par utilisateur, 60/h par IP** (budget vérifié avant réservation) | ✅ |

## V3 — Sécurité du front web

| Exigence | Où | État |
|---|---|---|
| CSP sans `unsafe-inline` | CSP à nonce, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'` | ✅ |
| Anti-clickjacking | `X-Frame-Options: DENY` + `frame-ancestors` | ✅ |
| `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP | vérifiés live | ✅ |
| Violations CSP `style-src` en console | styles inline résiduels — bruit connu, **non traité** | ⚠️ |

## V4 — API et services web

| Exigence | Où | État |
|---|---|---|
| Autorisation sur chaque handler | Proxy protège `/api/**` ; `/api/auth` et `/api/health` publics par exception (`lib/routeGuard.ts`) | ✅ |
| CSRF | Aucun handler mutant : tout passe par des Server Actions (vérification d'origine Next.js) | ✅ |
| **Routes d'export/téléchargement gardées ET bornées** | `canAccessArea` sur les 3 exports CSV + `take` borné ; `GET /api/assets/[kind]/[id]` (téléchargement/affichage des fichiers de projet, plans et photos de réserves) rejoue le même ordre de gardes (identité → rubrique → section → résolution en base → accès projet) — voir `docs/CONVENTIONS.md` | ✅ |

## V5 — Manipulation de fichiers

| Exigence | Où | État |
|---|---|---|
| Type de fichier vérifié serveur | **Magic bytes + extension sur les cinq chemins d'upload** (`lib/fileSignature.ts`, extrait du scan plutôt que dupliqué), HEIC/AVIF/BMP/TIFF compris. Avant PR #187 : aucun chemin ne lisait un octet, et le blocage des contenus dangereux n'existait que sur deux chemins sur quatre — les deux non couverts partant en URL Cloudinary publique. ⚠️ **Cette ligne comptait « quatre » à tort** : `uploadReservePlan` (plan de réserve, `lib/cloudinary.ts`) était resté sur `file.type`/l'extension seuls, sans lire un octet — trouvé par la passe adverse EDITOR (lot C1, #3), fermé par `looksLikePdf` (signature `%PDF-`, tolérance des 1024 premiers octets prévue par le format) | ✅ |
| SSRF sur récupération distante | Allowlist `res.cloudinary.com` + timeout + plafond de taille | ✅ |
| **URL Cloudinary publiques — nouveaux uploads** | `deliveryType` gardé (`AUTHENTICATED`) dès la création pour ProjectFile/ReservePlan/ReservePhoto ; livrés uniquement par `GET /api/assets/[kind]/[id]`, qui signe l'URL côté serveur et re-vérifie l'accès à chaque requête (jamais l'URL Cloudinary brute vers le client) | ✅ |
| **URL Cloudinary publiques — données existantes avant cette migration** | les lignes créées avant ce changement restent en `deliveryType = 'UPLOAD'` et leur asset Cloudinary reste joignable par son ancienne URL publique, sans aucune garde, **jusqu'à ce que `scripts/retype-existing-guarded-assets.mjs --execute` ait tourné avec zéro échec** (idempotent, ré-exécutable). Il se lance **depuis le conteneur applicatif**, `docker exec fullstack_starter_web node scripts/retype-existing-guarded-assets.mjs` (sans flag = dry-run) — procédure complète, reprise après interruption et avertissement sur les liens déjà partagés dans [`deploy/README.md`](../deploy/README.md). Le nombre de lignes encore concernées est exposé en clair (compteur agrégé) sur `GET /api/health` (`pendingGuardedAssets`), justement pour que ce point ne reste pas silencieusement faux | ⚠️ **écart connu, tant que le script de bascule n'a pas terminé avec zéro échec** |

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
| Déconnexion invalidante | `signOut` Auth.js | ✅ |

## V8 — Autorisation

| Exigence | Où | État |
|---|---|---|
| Contrôle **côté serveur**, centralisé | 3 axes : `requireCapability`, `requireSectionAccess`/`requireAreaAccess`, `requireProjectAccess` | ✅ |
| **Mutations de contenu d'un projet gardées par la rubrique `projects`**, pas seulement leur section | Les 41 actions exportées de `actions/{tasks,taskGroups,taskCategories,taskAssignee,projectMaterials,projectFiles,reserves,interventions,interims,subcontractors,deliveryNoteScan}` appellent désormais `requireAreaAccess("projects")`, entre `requireCapability` et `requireSectionAccess`. ⚠️ **N'était pas le cas avant la passe adverse EDITOR (lot C1, #1)** : les lectures avaient été fermées (page projet, tableau de bord, rapport PDF, `/api/assets`) mais ces mutations non — un EDITOR dont la fonction masquait `projects` ne pouvait plus rien *voir* du chantier tout en gardant l'écriture et la suppression complètes dessus (`addTask`/`deleteTask`/`deleteMaterial`/`deleteReserve`, entre autres, suppriment réellement). `tests/authz-coverage.test.ts` vérifiait déjà `requireSectionAccess` sur ces fichiers ; un second test sur la même liste vérifie maintenant `requireAreaAccess`, pour que le trou ne se rouvre pas silencieusement | ✅ |
| Filtrage **dans la requête**, pas au rendu | listes, page projet, tableau de bord, exports, PDF. ⚠️ **Cette ligne portait ✅ alors qu'elle était fausse** : jusqu'à PR #187, les deux corbeilles, les deux journaux d'activité, le tableau de bord d'un chantier, le tableau de bord d'accueil et `getBreadcrumb` ne filtraient sur aucun périmètre. Une ligne de cette checklist ne vaut que par l'énumération des surfaces qu'elle couvre — « tableau de bord » au singulier en cachait deux non gardés | ✅ |
| Pas d'auto-élévation | Un ADMIN ne peut ni éditer la fonction qui le contraint (`setFunctionAreas`) ni repointer son propre compte vers une autre (`updateUser`) ni **supprimer sa propre fonction** (`deleteJobFunction`) — les **trois** leviers, sortie de secours SUPERADMIN. ⚠️ **Cette ligne affirmait « les deux leviers » à tort** : `deleteJobFunction` restait ouvert (`onDelete: SetNull` sur `User.jobFunctionId` vide la contrainte aussi sûrement que l'éditer), trouvé par la passe adverse EDITOR (lot C1, #2) — énumérer *tous* les chemins qui détachent un utilisateur de sa fonction ou vident les restrictions d'une fonction (suppression simple, en masse, import) est désormais la méthode, pas seulement les deux déjà connus. `LOCKED_CAPABILITIES` (`settings.manage`, `functions.manage`, `users.manage`) non délégables par la matrice | ✅ |
| Anti-IDOR | l'id qui autorise est **résolu en base**, jamais lu dans un formulaire | ✅ |
| Anti-énumération | hors périmètre ⇒ « introuvable », jamais « interdit » | ✅ |
| Frontière portail CLIENT | proxy **et** `blockClientFromApp()` (défense en profondeur) | ✅ |
| Test structurel de couverture | `tests/authz-coverage.test.ts` échoue si une action exportée saute sa garde, **lectures comprises depuis PR #187**. Il portait un `READS = new Set([...])` qui en exemptait trois : l'exemption avait l'air d'une décision motivée et *était* le trou. Toute exemption ajoutée ici doit porter sa raison et la condition de sa disparition | ✅ |

## V9 — Jetons autoportants (JWT)

> Chapitre **nouveau en 5.0**, directement pertinent : les sessions sont des JWT.

| Exigence | Où | État |
|---|---|---|
| Algorithme et signature vérifiés | délégué à Auth.js v5 | ⚠️ à confirmer explicitement |
| Durée de vie et rotation | valeurs par défaut Auth.js — jamais examinées | ⬜ |
| Révocation | un JWT reste valide jusqu'à expiration : quel impact si un compte est désactivé ? | ⬜ |

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
| Pas de champ sensible vers le client | `select` explicite ; `findAllOptions` pour les dropdowns (ne sérialise pas la posture d'accès) | ✅ |
| `Cache-Control: no-store` sur les PDF | ✅ |
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
