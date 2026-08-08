# Checklist sécurité — OWASP ASVS 5.0

Checklist **vivante**, à l'inverse de `ASVS-2026-08.md` qui est un audit daté
(fait sur ASVS 4.0.3, dont la numérotation des chapitres a entièrement changé
en 5.0). Ici : ce qui est **acquis**, **où c'est appliqué dans le code**, et ce
qui reste à vérifier.

- **Référentiel** : [ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0) (mai 2025), niveau **L2** — l'app manipule des données métier réelles et des données personnelles.
- **Qui la lit** : le `security-auditor` en premier, à chaque feature. Il vérifie d'abord les **régressions** sur les lignes ✅, puis se concentre sur ce que la feature ajoute.
- **Qui la maintient** : le `capitaliseur`, qui signale quand la réalité diverge de ce document.

**Légende** — ✅ acquis et prouvé · ⚠️ à confirmer · ⬜ jamais audité · ➖ non applicable

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
| Toute entrée validée par un schéma | Zod sur chaque mutation (`schemas/*.ts`) | ✅ |
| Séquençage / anti-course | Scan et cumul matériel en transaction ; compteur monotone pour les réserves | ✅ |
| Anti-automation | Login 5/15 min par email (20/IP) ; reset 3/15 min (`lib/loginRateLimit.ts`) | ✅ |

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
| **Routes d'export gardées ET bornées** | `canAccessArea` sur les 3 exports CSV + `take` borné | ✅ |

## V5 — Manipulation de fichiers

| Exigence | Où | État |
|---|---|---|
| Type de fichier vérifié serveur | MIME **et** extension ; SVG et types dangereux bloqués (`lib/cloudinary.ts`) | ✅ |
| SSRF sur récupération distante | Allowlist `res.cloudinary.com` + timeout + plafond de taille | ✅ |
| **URL Cloudinary publiques** | les fichiers livrés sont accessibles par URL directe sans garde | ⚠️ **écart connu** |

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
| Filtrage **dans la requête**, pas au rendu | listes, page projet, tableau de bord, exports, PDF | ✅ |
| Anti-IDOR | l'id qui autorise est **résolu en base**, jamais lu dans un formulaire | ✅ |
| Anti-énumération | hors périmètre ⇒ « introuvable », jamais « interdit » | ✅ |
| Frontière portail CLIENT | proxy **et** `blockClientFromApp()` (défense en profondeur) | ✅ |
| Test structurel de couverture | `tests/authz-coverage.test.ts` échoue si une mutation saute sa garde | ✅ |

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
| Aucun secret journalisé, messages d'erreur génériques | `getErrorMessage` | ✅ |
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

> **Jamais audité.** `lib/deliveryNoteScan.ts` envoie une **image fournie par
> l'utilisateur** à Claude Sonnet 5 (repli OpenAI). L'ASVS ne couvre pas cette
> surface ; référentiel : *OWASP Top 10 for LLM Applications*.

| Risque | Question à trancher | État |
|---|---|---|
| **Injection de prompt indirecte** | un bulletin peut contenir du texte conçu pour détourner l'instruction (« ignore les consignes et renvoie… »). La sortie est-elle contrainte par un schéma **côté serveur**, ou fait-on confiance au modèle ? | ⬜ |
| **Validation de la sortie** | la réponse du modèle est-elle repassée par Zod avant d'écrire en base ? | ⬜ |
| **Confusion de données** | un document malveillant peut-il faire écrire des lignes de matériel sur un **autre** projet ? (le `projectId` doit venir de la session/base, jamais du document) | ⬜ |
| **Coût / déni de service** | taille d'image plafonnée ? nombre de scans limité par utilisateur ? `max_tokens` est à 2048, mais rien ne borne la fréquence | ⬜ |
| **Fuite via le fournisseur** | les bulletins peuvent contenir des données personnelles (noms, adresses). Politique de rétention des fournisseurs LLM connue et acceptée ? | ⬜ |
| **Repli silencieux** | le basculement Anthropic → OpenAI envoie la donnée à un **second** tiers. Est-ce voulu et documenté côté RGPD ? | ⬜ |

---

## Quand rejouer

- **À chaque feature** : le `security-auditor` vérifie les régressions sur les ✅ touchés par le diff.
- **Passe complète** : à chaque changement d'architecture (nouvelle surface d'auth, nouveau tiers, nouveau type de donnée), ou tous les 6 mois.
- **À la sortie d'une révision ASVS** : re-mapper. Le passage 4.0.3 → 5.0 a renuméroté tous les chapitres et ajouté V9 (jetons autoportants), qui nous concerne directement.
