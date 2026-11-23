# Conventions observées du projet

Carte des patterns récurrents, pour éviter de les re-dériver à chaque feature.
**C'est une carte, pas une spécification** : elle décrit ce que le code fait
aujourd'hui. Vérifie contre le code avant de t'appuyer dessus, et corrige ce
fichier s'il a dérivé.

## Copie de travail d'un agent — ce qu'il faut y remettre

Les agents travaillent dans une **copie isolée** du dépôt, pour que leurs
états intermédiaires ne soient pas servis en direct par le serveur de
développement de quelqu'un d'autre. Un import retiré avant ses usages a déjà
produit un `ReferenceError` sous les yeux de la personne qui testait.

Mais une copie fraîche n'a **rien de ce que git ignore**, et ce qui manque
est exactement ce qui permet de vérifier :

| absent | ce qui devient impossible |
|---|---|
| `node_modules` | `tsc`, `eslint`, `vitest` |
| `app/generated/prisma` | `tsc` échoue dès l'import du client |
| `.env` | `prisma generate`, toute lecture en base |

Donc, avant la première ligne de code, dans la copie :

```bash
cp <dépôt principal>/.env .env && npm ci && npx prisma generate
```

Ce coût appartient au **lancement**, pas à la feature. Sans lui, l'agent ne
peut lancer aucun contrôle et rend un rapport que rien n'étaye — ce qui est
pire qu'une absence de rapport, parce que ça se lit comme une preuve.

## Modèle d'accès — trois axes orthogonaux, plus la propriété

Ne jamais les croiser en matrice.

| Axe | Ce qu'il décide | Où |
|---|---|---|
| **Rôle** (capability) | ce qu'on a le droit de *faire* (lire / écrire) | `requireCapability` — `lib/access.ts`, `lib/capabilities.ts` |
| **Fonction → sections** | quelles sections d'un projet existent pour toi | `requireSectionAccess` — `lib/sectionAccess.ts` |
| **Fonction → rubriques** | quelles rubriques de l'app existent pour toi | `requireAreaAccess` / `canAccessArea` — `lib/areaAccess.ts` |
| **Fonction → projets** | quels projets tu peux atteindre | `requireProjectAccess` — `lib/access.ts` (contexte résolu par `lib/accessContext.ts`) |
| **Propriété** (rubrique personnelle) | « cette ligne est-elle à moi ? » — l'utilisateur courant *ou* un ADMIN+ | `getLoansActor` — `lib/currentUser.ts` |

**Le quatrième axe est arrivé avec la rubrique Prêts (PR #230)** et ne
ressemble pas aux trois autres : il ne vient pas de la fonction mais de la
**ligne** (`Equipment.ownerId`, `EquipmentLoan.borrowerId`). Le jeton
porte `email`, `role`, `sub` (l'id) et `sessionVersion`, mais la session exposée
au client (`auth()`, `useSession`) ne porte que `{email, role}` (plus les champs
d'affichage d'Auth.js) : jamais d'id numérique ni de version côté application.
L'id du « moi » se résout **en base** par e-mail (`getCurrentUserId`), jamais
depuis le formulaire.
`getLoansActor()` rend `{userId, isAdmin}` d'un coup — la page décide la
visibilité et les actions décident l'autorisation avec la **même** source,
sinon un bouton affiché et une action refusée divergent. Ordre dans une
mutation de ce type : `requireCapability("content.edit")` →
`requireAreaAccess("loans")` → parse Zod → **ligne résolue en base** →
propriétaire ou admin. Hors périmètre ⇒ même message que « inexistant »
(un emprunteur CLIENT rend `invalidId`, pas un message dédié).

**Ordre des gardes dans une mutation, toujours le même :**

```
requireCapability(...)  →  requireAreaAccess(<rubrique>)     ← rubrique d'abord
                        →  requireSectionAccess(<section>)   ← puis section
                        →  parse Zod
                        →  requireProjectAccess(<id résolu>)
```

**Les deux, pas l'un *ou* l'autre.** Ce bloc écrivait « ou » jusqu'à la passe
adverse EDITOR : 41 mutations de contenu de projet n'avaient que la section, et
un EDITOR dont la fonction masque `projects` gardait l'écriture et la
suppression complètes sur un chantier qu'il ne pouvait plus voir (détail plus
bas). Une mutation qui n'appartient à aucune section d'un projet (Administration,
Clients) saute la ligne *section* — jamais la ligne *rubrique*. Même ordre que
sur les routes de lecture ci-dessous : rubrique avant section.

Le `projectId` passé à `requireProjectAccess` doit venir de **la base**, jamais
d'un champ de formulaire (ex. `findCompanyProjectId(companyId)`). Un `projectId`
de FormData ne sert qu'au `revalidatePath`.

**`requireProjectAccess` gèle aussi la corbeille** (lot 2, #245) : après le
périmètre, il refuse un chantier à la corbeille **et** un chantier vivant dont
l'entreprise est à la corbeille (la corbeille d'une entreprise ne cascade pas
sur ses chantiers). « À la corbeille » est défini **une fois**,
`lib/projectTrash.ts::projectTrashState`, et les lectures qui décident si un
chantier s'affiche (hub, pages de section, `/api/assets`, rapports, portail)
l'appellent aussi — sinon la page reste visible pendant que chaque bouton est
refusé. Les deux seules actions qui agissent **sur** un chantier à la corbeille
(`restoreProject`, `permanentlyDeleteProject`) appellent son inverse,
`requireTrashedProjectAccess(id, "restore" | "destroy")`, et un test structurel
interdit tout autre appelant. Côté entreprise, `requireClientAccess` refuse une
entreprise absente ou à la corbeille ; `requireClientAccessWithin(ctx, client)`
est la même règle pour un appelant qui a déjà lu le contexte et la ligne (imports
par e-mail, une ligne par tour de boucle sans relecture).

Les refus de ces gardes sont **typés** (`lib/scopeRefusal.ts` :
`forbidden` / `absent` / `inTrash` / `parentInTrash`). Une action
anti-énumération décide sur la **raison**, jamais sur le texte du message :
`scopeRefusalMessage` replie `forbidden` et `absent` sur le même `invalidId`, et
ne laisse passer les deux raisons de corbeille qu'à qui atteint déjà la ligne.

**Ordre des gardes sur une route de LECTURE** (export, téléchargement,
rapport) — établi par `app/api/assets/[kind]/[id]/route.ts` (livraison gardée
des fichiers de projet, plans et photos de réserves) :

```
requireAppUser()  →  canAccessArea(<rubrique>)      → 403 si refusé
                  →  valider les params de route     → 400 si malformés
                  →  canAccessSection(<section>)     → 403 si refusé
                  →  valider la query string          → 400 si malformée
                  →  résoudre la ligne en base        → 404 si absente
                  →  canReachProject(<projectId résolu>) → 404 si hors périmètre
```

Le statut change de sens par rapport à une mutation : **403 pour un axe
global** (rubrique/section — ne dépend d'aucune ligne, le refuser
n'apprend rien à un attaquant), **404 pour tout ce qui est résolu en base**
(ligne absente et ligne hors projet renvoient exactement la même réponse —
un statut distinct pour les deux permettrait d'énumérer des ids), et **400
pour une entrée malformée**, qui n'est jamais confondu avec un 404 : la
validation précède toute lecture en base, donc elle ne peut ni confirmer ni
infirmer l'existence d'une ligne. La position du 400 sur les params de route
n'est pas libre — le `kind` doit être validé **avant** `canAccessSection`,
puisque c'est lui qui détermine la section à vérifier. Voir aussi
`docs/SECURITE-CHECKLIST.md` (V4/V5) pour la même exigence appliquée aux
routes d'export CSV.

Depuis le passage de ce module en livraison gardée, la page de détail projet
et le rapport PDF de réserves (`.../reserves/report/route.ts`) sont eux aussi
soumis à `canAccessArea("projects")`, ce qui n'était pas le cas avant — les
fichiers/plans/photos n'existent qu'à l'intérieur d'un projet, masquer la
rubrique qui y mène doit donc masquer ce qu'elle contient.

**Page projet : un hub, une route par section** (PR #206 → #213). Le
`page.tsx` du projet ne rend plus les sections en ligne : c'est une grille de
cartes menant à `.../tasks`, `.../reserves`, `.../files`, `.../workforce`,
`.../interventions` (plus `dashboard` et `edit`). Trois invariants, à ne pas
re-dériver :

- `lib/projectSections.ts::PROJECT_SECTION_ROUTES` est **la table** segment de
  route → clé(s) de section, et `buildHubSlots` en déduit l'ordre des cartes.
  Une route peut dépendre de **deux** clés (`workforce` = `subcontractors` +
  `interims`, `tasks` = `tasks` + `materials`) ; les clés, elles, restent
  séparées — une fonction qui n'en masque qu'une laisse voir l'autre moitié.
- Toute page de section passe par `resolveProjectSectionAccess`
  (`lib/projectSectionGuard.ts`) : le seul endroit où vit l'ordre rubrique →
  section → résolution de la ligne, et qui ne rend au composant que les colonnes
  qu'une page de section lit. Sur une **page** (rendu, pas statut HTTP), la
  rubrique masquée se rend en « introuvable » et la section masquée en
  « interdit » — choix de rendu, pas entorse au 403/404 des routes ci-dessus.
- `tests/project-section-authz-coverage.test.ts` découvre ses cibles **par cette
  table** et exige un appel résolu par l'**import** (un homonyme local ne compte
  pas), **avec les clés de la route** depuis #249 — la page `reserves` qui
  appellerait `resolveProjectSectionAccess(params, "tasks")` rougit. C'est ce
  qui lui a fait attraper seul une page créée après lui. Ajouter
  une section = une entrée dans la table + le garde partagé, rien d'autre.

**Ajouter une rubrique de l'app** (le chemin qu'a suivi Prêts, PR #230) touche
six endroits : `lib/appAreas.ts` (`APP_AREA_KEYS`, `APP_AREA_CHILDREN`,
`TOP_LEVEL_APP_AREAS`, `AREA_HREFS`), `PROTECTED_PATHS` (`lib/routeGuard.ts`),
le lien de nav (`app/layout.tsx`, `canAccessArea`), la page
(`blockClientFromApp()` puis `requireAreaOrRedirect("<clé>")`), ses fichiers
d'actions dans `AREA_BY_FILE` (`tests/authz-coverage.test.ts`), et les deux
dictionnaires i18n. Deux tests découvrent leurs cibles par `AREA_HREFS` et
attrapent seuls, depuis #230 : une rubrique **sans entrée proxy**
(`tests/route-guard-area-coverage.test.ts`, page et sous-arbre — `/loans` a
été livré sans, la frontière anonyme/CLIENT ne tenait que par la page) et une
page sans `requireAreaOrRedirect("<clé>")` **avec sa clé** (voir « Tests »).
Ce qu'aucun test n'attrape : un fichier d'actions oublié d'`AREA_BY_FILE` —
liste à la main, même défaut qu'`OWNED_BY_SECTION` plus bas.

Hors périmètre ⇒ **« introuvable », jamais « interdit »** (anti-énumération).

**Les lectures sont gardées comme les mutations** (passe adverse, PR #187). Ce
n'était pas le cas : `getClient` / `getProject` / `getProjectsForClient`
n'avaient que `requireCapability`, et quatre surfaces de lecture n'avaient
aucun filtre de périmètre — les deux corbeilles, les deux journaux d'activité,
le tableau de bord d'un chantier (alors que la page de détail voisine, elle,
était gardée) et `getBreadcrumb` (qui rendait la chaîne de noms d'un dossier de
n'importe quel projet). Trois conséquences pour toute nouvelle lecture :

- une **vue voisine** d'un écran gardé porte les mêmes gardes que lui —
  rubrique *et* sections masquées, pas seulement l'accès projet ;
- une lecture **auxiliaire** (fil d'Ariane, compteur, agrégat) reçoit le
  `projectId` et recroise, elle ne se contente pas de l'id qu'on lui passe ;
- une lecture **transverse** (corbeille, journal) filtre sur le périmètre dans
  la requête, jamais au rendu.

Bypass : les fonctions masquent pour tous sauf **SUPERADMIN** sur `hiddenAreas`
(un ADMIN y est soumis, sinon masquer l'Administration ne servirait à rien).

**Les mutations de contenu d'un projet sont gardées par la rubrique, comme ses
lectures** (passe adverse EDITOR, lot C1, #1). Ce n'était pas le cas : les
lectures (page projet, tableau de bord, rapport PDF, `/api/assets`,
`getClient`/`getProject`) avaient été fermées derrière `canAccessArea("projects")`,
mais une trentaine — en réalité **41** à l'époque, **45 dans 12 fichiers** au
2026-09-19 (`actions/materialCategories` compris ; recompte par `functionsIn`,
voir `docs/SECURITE-CHECKLIST.md` V8), **47 dans 13** à `0e10b1b` (compte exact
`OWNED_ACTIONS_EXPECTED` du test, vert) — de mutations dans `actions/tasks`,
`actions/taskGroups`, `actions/taskCategories`, `actions/taskAssignee`,
`actions/projectMaterials`, `actions/materialCategories`, `actions/projectFiles`,
`actions/reserves`, `actions/interventions`, `actions/interims`,
`actions/subcontractors` et `actions/deliveryNoteScan` n'avaient que
`requireSectionAccess`, jamais
`requireAreaAccess("projects")`. Conséquence : un EDITOR dont la fonction
masque `projects` ne pouvait plus rien *voir* du chantier, mais gardait
l'écriture et la suppression complètes dessus — `addTask`/`deleteTask`/
`deleteMaterial`/`deleteReserve` (entre autres) suppriment réellement, et
`editTask` renvoie la ligne qu'il modifie, donc c'est aussi une lecture.
Corrigé en ajoutant `requireAreaAccess("projects")` juste après
`requireCapability`, avant `requireSectionAccess` (même ordre que la route de
lecture gardée : rubrique avant section). `tests/authz-coverage.test.ts`
vérifiait déjà que ces fichiers appellent `requireSectionAccess` — il ne
vérifiait **pas** `requireAreaAccess`, ce qui verrouillait le trou ; un
second test, sur la même liste `OWNED_BY_SECTION`, ferme cet angle mort.

**Personne ne modifie la contrainte qui le contraint — ni ne devient un compte
qu'elle ne contraint pas.** ⚠️ Cette section a affirmé « deux leviers », puis
« trois… les trois sont fermés » ; la checklist V8 en a publié « six »
(`9aed83f`). Trois comptes faux, tous par le bas. Le dernier l'était par sa
**méthode** : il ne lisait que les écritures de `User.jobFunctionId` et de la
fonction elle-même, pas celles du **rôle** ni du **mot de passe** — c'est-à-dire
pas les écritures qui permettent de *devenir* un compte non contraint.

**Recompte à `96b041b` (2026-11-22).** Méthode : partir des **écritures**, pas
des actions qu'on connaît. `git grep -nE
"(prisma|tx)\.(user|jobFunction|passwordResetToken)\.(create|update|upsert|delete)"`
hors tests et `prisma/seed.ts` rend 15 sites (`repository/users.ts` ×8,
`repository/jobFunctions.ts` ×6, `repository/contacts.ts` ×1) ; on remonte à
chaque action exportée qui les appelle et on lit ce qu'un non-SUPERADMIN peut en
faire. Cascades lues dans `prisma/schema.prisma` : `User.jobFunctionId` est
`SetNull`, et aucune FK ne supprime un `User` par cascade. Exclus, avec leur
raison : `reorderJobFunctions` (position seule), `addJobFunction` (une fonction
neuve ne contraint personne), `login` / `requestPasswordReset` /
`resetPassword` (le lien part dans la boîte du compte, jamais vers l'appelant),
changer son **propre** rôle (vers le haut, le rang l'a toujours refusé ; vers
le bas, ça ne lève rien).

*Auto-élévation* — un ADMIN dont la fonction masque des rubriques
(`hiddenAreas`, le seul axe auquel un ADMIN est soumis) s'en affranchit.
**Dix leviers connus, tous fermés à `0e10b1b`** (en prod le 2026-11-23) — la
table de `96b041b` plus les deux relais du lot 5a, **pas** un recompte depuis les
écritures : ce qui fait foi désormais, c'est la découverte outillée ci-dessous
(13 actions, chacune sous sa règle ou exemptée avec sa raison). La table a
porté « huit, sept fermés » à `96b041b` sans compter `createPortalLogin` — la
même section l'écartait des chemins vers un compte ADMIN+ parce qu'il « ne crée
qu'un CLIENT », sans se demander ce qu'un CLIENT voit : il **lit par le portail**
les chantiers auxquels il est lié — deux relais de plus (9, 10), trouvés par le
lot 5a. Quatrième compte faux, encore par le bas, encore par une **exclusion**
dont la raison n'avait pas été éprouvée.

| # | levier | action | état |
|---|---|---|---|
| 1 | éditer sa propre fonction | `saveFunctionConfig` (alors `setFunctionAreas`, fusionnée avec `setFunctionSections` / `setFunctionScope` en une écriture par #247) | fermé (lot C1) |
| 2 | repointer son compte vers une autre fonction, ou aucune | `updateUser` | fermé (lot C1) |
| 3 | supprimer sa propre fonction (`SetNull`) | `deleteJobFunction` | fermé (lot C1) |
| 4 | créer un ADMIN sans fonction et s'y connecter | `addUser` | fermé, lot 1 (`canAssignRole`) |
| 5 | promouvoir ADMIN un compte qu'on contrôle (un EDITOR qu'on vient de créer) | `updateUser` | fermé, lot 1 (`canAssignRole`) — absent du compte « six » |
| 6 | fixer le mot de passe d'un autre ADMIN non restreint, et s'y connecter | `updateUser` | fermé, lot 1 (`canManageAccount`) — absent du compte « six » |
| 7 | lever les restrictions de la fonction portée par un autre ADMIN (utile combiné au 6) | les 4 actions d'écriture de `actions/jobFunctions` | fermé, lot 1 (`refuseIfHeldByAdmin`) |
| 8 | **compte relais** : un compte moins restreint que soi, créé (`addUser`) ou repris (`updateUser` : fonction vidée ou allégée, mot de passe fixé), supprimé ou réaffecté, pour voir par lui | `addUser`, `updateUser`, `deleteUser`, `setUserProjectAssignments` | fermé, lot 5a (#248, `mayManageAccountWithFunction`) — accepté ouvert le 2026-11-22, refermé le lendemain |
| 9 | **reprendre un login de portail** : fixer le mot de passe d'un compte CLIENT et lire par le portail les chantiers qu'on vous masque | `updateUser` | fermé, lot 5a : `updateUser` refuse toute cible CLIENT et tout rôle CLIENT demandé ; un login se gère depuis son contact |
| 10 | **créer un login de portail** (ou lier un contact à des chantiers) et lire par lui | `createPortalLogin`, `editContact` | fermé, lot 5a : `mayProvisionPortalLogin` refuse qui masque une rubrique visible du portail (`PORTAL_EXPOSED_AREAS` = `projects`) ; `editContact` ne touche les liens de chantiers qu'avec la rubrique `projects` |

*Hors table, parce que l'acteur n'y fait rien* : un compte rétrogradé gardait
par son cookie le rôle qu'on venait de lui retirer (H1). Fermé par le lot 3
(`2f8fbb6`, rôle du jeton comparé à la ligne, `lib/sessionGate.ts`). Le lot 3
n'ouvre aucun levier : `sessionVersion` ne s'écrit que dans les deux écrivains
d'identifiants (§ « Révocation des sessions »), sous les gardes déjà en place
(`updateUser`, lien de réinitialisation à usage unique), et la session exposée
au client ne la porte pas.

**La règle qui ferme 8 à 10** (`lib/accountPolicy.ts`, pure, lue par les actions
**et** par les écrans) : un compte n'est géré que si sa fonction, **avant et
après** l'écriture, masque au moins les rubriques de l'acteur
(`mayManageAccountWithFunction`, une rubrique parente couvrant ses
sous-parties — `coversHiddenAreas`) ; une fonction portée par des comptes ne
rend visible rien de ce qu'elle cachait à l'acteur (`mayChangeHeldFunction`,
règle **monotone**). Les rubriques d'administration, gardées par des capacités
verrouillées ≥ ADMIN, ne comptent pas : un ADMIN qui ne masque qu'elles n'est
pas « restreint » (`relevantHiddenAreas`). Vérification et écriture vivent dans
**une** transaction qui verrouille la ligne `JobFunction` (`SELECT … FOR
UPDATE`), dans **tout** écrivain, toujours dans le même ordre — fonction(s)
actuelle et cible, puis compte — sinon deux écritures croisées s'interbloquent.
Les écrans reçoivent les verrous calculés côté serveur (`heldFunctionLocks`,
`unmanageableAccountIds`, `assignableFunctionIds`) : ils ne recalculent pas la
règle, ils l'affichent.

*Comptes ADMIN+* — règle décidée le 2026-11-22 : **tout ce qui touche un compte
ADMIN ou SUPERADMIN passe par un SUPERADMIN**. Chemins par lesquels un
non-SUPERADMIN atteignait un tel compte : **9 actions exportées, toutes fermées
à `96b041b`** — `addUser` (créer), `updateUser` (promouvoir, modifier, mot de
passe ; seule exception, un ADMIN sur son **propre** nom et son propre mot de
passe), `deleteUser`, `setUserProjectAssignments`, `deleteContact` (supprimait
le compte lié **quel que soit son rôle** ; `repository/contacts.ts::remove` ne
supprime plus qu'un compte encore `CLIENT`) et les quatre écritures de
`actions/jobFunctions` sur une fonction portée par un ADMIN+. `createPortalLogin`
n'y figure pas — il ne crée qu'un `CLIENT` et refuse un contact déjà lié — mais
il créait ce compte **sans les rubriques de la gestion des comptes** (F3) :
il exige désormais `admin.users` **et** `clients.contacts`.

Source unique : `lib/accountPolicy.ts`, pure, lue par `actions/users` **et** par
l'écran (`UsersManager`) — sinon l'écran propose ce que l'action refuse. Toute
nouvelle écriture sur `User` ou sur une `JobFunction` passe par elle, et ce
recompte se refait **depuis les écritures**, jamais en complétant la table.
Sortie de secours SUPERADMIN et garde du dernier SUPERADMIN intactes.
**Ces actions sont découvertes par leurs écritures** depuis le lot 5a :
`tests/account-writers-coverage.test.ts` (helpers dans
`tests/helpers/accountWriterScan.ts`) parse les fonctions exportées de
`repository/*.ts` qui écrivent `user`, `jobFunction` ou `passwordResetToken`
par un client nommé `prisma` ou `tx`, remonte aux actions qui les atteignent
par chemin de module **et** par binding, et exige **la** règle de chaque action
(`REQUIRED_RULE`), résolue jusqu'à `lib/accountPolicy`. Tailles exactes, vertes
à `0e10b1b` : 13 écrivains, 13 actions (7 sous la règle, 6 exemptées — chaque
exemption porte sa raison, sa condition de disparition, et des **affirmations
relues dans le code parsé**, jamais dans un commentaire). **12 écrivains à
`2f8fbb6`** (lot 3 : `updatePassword` et `markResetTokenUsed` fusionnés en
`resetPasswordWithToken`) — recompté par le `repositoryWriters` du test sur les
fichiers suivis de `repository/`, 13 actions par son `accountActionsIn` sur
ceux d'`actions/`. Angles morts déclarés
par le test lui-même : une écriture par relation imbriquée, du SQL brut, un
écrivain passé en valeur, un client Prisma nommé autrement que `prisma`/`tx` —
c'est pourquoi `repository/users.ts` nomme `tx` son paramètre de transaction.
Une nouvelle écriture de compte qui tombe dans un de ces angles est invisible :
la nommer `prisma`/`tx`, ou étendre le scan. ⚠️ **Angle mort non déclaré,
sondé le 2026-11-23 à `2f8fbb6`** : la liste des méthodes d'écriture est écrite
à la main (`WRITE_METHODS`, `USER_WRITE_METHODS`) et ne connaît ni
`updateManyAndReturn` ni `createManyAndReturn`, que le client Prisma 7 généré
expose sur `User` — un `tx.user.updateManyAndReturn({ data: { password } })`
n'est vu par **aucun** des deux scans (relais, révocation). Aucune occurrence
dans le code à ce commit. Même liste manuelle, même trou, dans
`tests/helpers/partialWriteScan.ts` et `tests/read-named-functions.test.ts`.
Tâche ouverte : énumérer les **lectures** connues et tenir pour écriture tout
le reste.

**Logins CLIENT orphelins** (lot 5a) : la destruction définitive d'une
entreprise supprime aussi les logins CLIENT de ses contacts
(`repository/clients.ts::permanentlyRemove`, filtré sur `role: "CLIENT"`) — ils
restaient actifs et invisibles.

**E-mail d'un compte** (`lib/normalizeEmail.ts`) : une seule forme canonique
(trim + minuscules) à **chaque** écriture et **chaque** lecture de
`User.email`, toutes dans `repository/users.ts` (`sessionAccountWhere`), et une
égalité **exacte**. Jamais `mode: "insensitive"` : Prisma le compile en `ILIKE`
sans échapper `%` ni `_`, et `jean_dupont@…` résolvait `jean.dupont@…` (sondé,
non-régression dans `tests-integration/email-lookup-wildcards.test.ts`). **La
garantie en base est sur `main` depuis `2f8fbb6`** (lot 3, #251, migration
`20261123100000`) : `CHECK "User_email_normalized_check"` (stocké = normalisé)
et index unique `"User_email_lower_key"` sur `lower(email)`. Elle vaut en
production à partir du premier déploiement qui contient ce commit (lu le
2026-11-23 à 18:35 UTC : la sonde affichait encore `2347b47`, donc pas encore).
La migration réécrit les lignes ASCII et **refuse** (RAISE, ids seuls) une
ligne non ASCII à réécrire ou une collision : `lower()`/`btrim` de PostgreSQL et
`toLowerCase()`/`trim()` de JS ne sont pas la même fonction (29 points de code
pour la casse, 1 caractère contre 16 pour le trim, détail en tête du fichier).
Une normalisation ou une mesure faite **en SQL** sur cette colonne reprend la
classe écrite dans la migration, jamais `btrim` : le premier pré-vol de prod,
écrit avec `btrim`, ne pouvait pas voir une tabulation.

**Révocation des sessions** (lot 3, #251, `2f8fbb6`). Le jeton porte le `role`
et la `sessionVersion` lus à la connexion (`auth.config.ts`, seul endroit où
ils sont posés) ; `lib/sessionGate.ts` les compare à la ligne à chaque
relecture et annule le jeton sur écart. **Toute écriture de `User.password` ou
de `User.role` sur une ligne existante porte `sessionVersion: { increment: 1 }`
dans le même `data`** : forme et monotonie imposées par
`tests/account-writers-coverage.test.ts`, condition (mot de passe ou rôle
changé, pas un nom seul) par `tests-integration/session-version-bump.test.ts`.
Le compteur ne fait que croître : réécrire une valeur déjà émise (un retour à 0,
une restauration de sauvegarde) ressuscite les cookies révoqués depuis — après
une restauration, procédure de `docs/deploy-hostinger.md` §10, jamais un `+ 1`.
Changer **ses propres** identifiants coupe sa propre session : l'écran des
comptes fait passer l'écriture qui révoque en dernier et valide avant tout
envoi (`UsersManager`), puis `updateUser` déconnecte avec la raison
(`/login?raison=identifiants-modifies`). Un nouvel écran qui enchaîne plusieurs
actions sur son propre compte suit le même ordre.
*Compte, à `2f8fbb6`* — méthode : `userWriteSites` du test sur les fichiers
suivis hors `tests/`, `docs/` et code généré, recoupé par `git grep` des appels
`<client>.user.<écriture>` : 11 appels, dont 3 suppressions (hors domaine, sans
données) et **8 écritures à données** — 4 `upsert` du seed (`update: {}`), le
`create`, `setUserProjects` (relation seule) et **2 écrivains d'identifiants**,
`repository/users.ts::updateProfile` et `::resetPasswordWithToken`. Hors de
tout scan : le script SQL `create-admin.js` de `docs/deploy-hostinger.md` §8,
qui incrémente lui-même.

**Atteindre une entreprise n'est pas l'emporter** (lot 1, F1). `requireClientAccess`
répond « puis-je atteindre cette entreprise » — au moins un chantier **vivant**
dans mon périmètre : c'est la garde des lectures et de la fiche. Posée sur la
destruction, elle laissait un compte limité à un seul chantier détruire
l'entreprise entière et, par cascade, les chantiers des autres. Une action qui emporte l'entreprise
**entière** (corbeille, en masse comprise, restauration, destruction) exige
`requireFullClientAccess` / `fullyAccessibleClientIds` (`lib/access.ts`) : **tous**
ses chantiers, corbeille comprise, dans le périmètre. La règle n'est écrite
qu'une fois, `repository/clients.ts::fullyInScopeWhere`, lue aussi par la liste
de la corbeille, par le bouton de la fiche et par les cases de suppression de
la grille. Et l'étape
irréversible vérifie l'antichambre : `restoreClient`, `permanentlyDeleteClient`
et `permanentlyDeleteProject` refusent une ligne qui n'est pas à la corbeille,
même réponse qu'une ligne absente — l'écran ne les proposait que depuis la
corbeille, l'appel direct détruisait une ligne vivante.

**La destruction définitive est gardée sur tout ce qu'elle emporte** (lot 5b,
#249). La cascade d'un chantier emporte fichiers, réserves, tâches, matériel… :
`permanentlyDeleteProject` exige **toutes** les sections de chantier
(`lib/sectionAccess.ts::requireEverySectionAccess`), et
`permanentlyDeleteClient` exige en plus les rubriques `projects` et
`clients.contacts`. La mise à la corbeille, réversible, garde sa garde
d'origine. Les boutons « Supprimer définitivement » lisent la même règle
(`lib/destroyAccess.ts`, prop `canDestroy`) : on ne propose pas ce que le
serveur refuse. Une nouvelle destruction en cascade se garde **à partir du
schéma** (`onDelete: Cascade` lus dans `prisma/schema.prisma`), pas à partir
de l'écran qui l'appelle.

`LOCKED_CAPABILITIES` (`lib/capabilities.ts`) = `settings.manage`,
`functions.manage`, `users.manage` : **non délégables par la matrice de rôles**,
puisqu'elles configurent le modèle d'accès lui-même. Une capacité qui donne le
pouvoir de changer les capacités rejoint cette liste.

`tests/authz-coverage.test.ts` échoue si une fonction exportée de
`actions/{clients,projects,contacts,portal,equipment,equipmentLoans}` (six
fichiers d'`AREA_BY_FILE`, inchangés à `0e10b1b`) saute `requireAreaAccess` —
**lectures comprises depuis PR #187** — ou ne refuse pas sur son résultat.
Depuis #249, **avec l'argument** que la table assigne au fichier, et une entrée
peut en porter plusieurs : `actions/portal/portal.ts` exige `admin.users` **et**
`clients.contacts`, `permanentlyDeleteClient` a sa propre entrée (`overrides`)
à trois rubriques. Il portait auparavant un `READS = new Set([...])`
qui en exemptait trois : l'exemption *était* le trou. Aucune exemption ne se
rajoute ici sans porter sa raison et la condition de sa disparition.

## Tests — le piège récurrent

Un mock de `getAccessContext` doit porter **tous** les champs du contexte
(`email`, `role`, `hiddenSections`, `hiddenAreas`, `projectIds`). Un champ
manquant ne casse rien tant que personne ne le lit — puis casse une série
entière de tests le jour où une garde le consulte. Trois séries de tests ont
déjà été cassées comme ça.

Quand un mock remplace tout un module (`vi.mock("@/repository/x")`), il doit
exporter **toutes** les fonctions que le code appelle, y compris celles
appelées indirectement.

**`OWNED_BY_SECTION` (`tests/authz-coverage.test.ts`) est une liste écrite à
la main.** Les deux tests qui exigent `requireSectionAccess` puis
`requireAreaAccess("projects")` sur les actions d'un projet ne voient que les
fichiers qu'elle nomme : un nouveau fichier sous `actions/` dont les lignes se
lisent par un `projectId` n'est vérifié par **personne** tant qu'il n'y est
pas. `actions/materialCategories` (PR #228) y a manqué pendant toute
l'implémentation, ses trois actions sans aucune preuve de garde, jusqu'à ce
que reviewer et security-auditor le remontent chacun de leur côté. Tant que la
liste n'est pas dérivée de `prisma/schema.prisma` (modèles à `projectId` →
repositories qui les écrivent → actions qui les importent), **une feature qui
crée un fichier d'actions de projet l'ajoute à cette liste et le prouve par
sonde** (garde retirée → rouge).

**Une garde exigée par son nom seul certifie le mauvais domaine.** Le test des
pages de rubrique (`tests/authz-coverage.test.ts`, PR #230) exigeait « un
appel à `requireAreaOrRedirect` » : `requireAreaOrRedirect("projects")` collé
dans `app/loans/page.tsx` restait vert tout en gardant la mauvaise rubrique.
Il lit l'**argument** depuis, sondé rouge → vert. ✅ **Les six autres
vérifications par nom seul** inventoriées à `9f718ec` (`AREA_BY_FILE`,
`AREA_BY_ROUTE`, `OWNED_BY_SECTION` côté rubrique, `/api/assets` et rapport de
réserves, page de détail projet, clé de section des pages de chantier) **sont
fermées par #249** : un seul mécanisme, `areaViolationsIn` / `areasNamedIn`
(`tests/authz-coverage.test.ts`), qui résout l'import, compare l'argument à la
table, accepte plusieurs valeurs par entrée — la valeur « documentation »
d'`actions/portal/portal.ts` est désormais lue — et, pour les gardes qui
**rendent** un refus (`requireAreaAccess`, `requireSectionAccess`), exige
qu'on refuse sur leur résultat avant tout effet. Les sondes de forme (garde
dans une fermeture jamais appelée, après l'écriture, résultat ignoré, throw
avalé, branche conditionnelle, `finally`, import par espace de noms…) sont
écrites dans le test : une nouvelle forme qui passe s'y ajoute, avec sa sonde.

## Validation — primitives partagées, à réutiliser

Ne pas réinventer un plafond ni une détection : ces deux modules existent, et
c'est leur duplication partielle qui a produit les défauts de PR #187.

- **Plafonds de texte** : `schemas/fields.ts` (`MAX_NAME_LENGTH`,
  `MAX_NOTE_LENGTH`, `MAX_CODE_LENGTH`, `MAX_EMAIL_LENGTH`…). Un palier **par
  usage**, pas un nombre par champ. Avant, aucun `z.string().min(1)` de l'app
  n'avait de borne haute : une série de tâches amplifiait une requête de 200 Ko
  en ~40 Mo écrits en base.
- **Miroir des `CHECK` sur un libellé** : `CONTROL_CHAR` (`schemas/fields.ts`)
  est la seule regex qui reproduit le `!~ '[[:cntrl:]]'` des migrations
  (`Project.reserve*Label`, `ProjectMaterialCategory.name`) — C1 compris,
  parce que Postgres sous UTF-8 les refuse et que la classe JS `\x7f` s'y
  arrêtait (PR #228, sondé sur la base). Un nouveau `CHECK` de ce type se
  pose avec `.trim().min(1).max(MAX_NAME_LENGTH).refine(CONTROL_CHAR)` en
  face, copié de `schemas/materialCategory.ts` ; les trois clauses doivent
  être là, et le test paramétré (`\t`, `U+0085`, `U+2028`) avec.
  ✅ **Refermé et instrumenté** (vérifié à `369c495`). La divergence a été
  payée trois fois (réserves #187, catégories #228, équipements #230 — ce
  dernier redéclarait un `/[\x00-\x1f\x7f]/` ASCII face à deux `CHECK … !~
  '[[:cntrl:]]'`) ; `schemas/equipment.ts` **importe** désormais la constante
  partagée, et `tests/schema-control-char.test.ts` bannit la **forme** — tout
  littéral regex mentionnant un point de code de contrôle est refusé hors de
  `schemas/fields.ts`, quel que soit son nom ou son échappement — avec
  l'exigence positive symétrique (le nom `CONTROL_CHAR` doit être lié par un
  import de `@/schemas/fields`). Domaine découvert en parcourant `schemas/`.
  Ne pas rouvrir ce chantier : il est fait.
- **`CONTROL_CHAR` ne couvre pas les marques bidi, et c'est délibéré.** Deux
  classes voisines cohabitent, à ne pas confondre :
  `CONTROL_CHAR` (`schemas/fields.ts` — C0, DEL, C1, plus les deux séparateurs
  de ligne U+2028/U+2029 ; écrits en points de code, jamais collés en clair)
  **refuse** en validation, et son contenu est dicté par le `[[:cntrl:]]` des
  `CHECK` — l'élargir aux marques bidi (U+202A–U+202E, U+2066–U+2069)
  désaccorderait la porte du filet et obligerait à reprendre *tous* les
  consommateurs et leurs contraintes. `CONTROL_AND_BIDI_CHARS`
  (`lib/materialName.ts`, global) **retire** ces marques d'une chaîne scannée,
  côté serveur, et ne miroite aucun `CHECK`. Donc : ne jamais affirmer qu'un
  U+202E est rejeté par `CONTROL_CHAR` (il passe) ; un besoin bidi sur un
  nouveau champ se traite par un instrument à lui, pas en élargissant la
  classe des contrôles.
- **Vrai type d'un fichier** : `lib/fileSignature.ts`
  (`detectRasterImageMediaType`, `looksLikeDangerousMarkup`, `looksLikePdf`) —
  magic bytes, extrait du scan de bulletin plutôt que dupliqué. ⚠️ Ce point
  affirmait « les quatre chemins d'upload » — il y en a **cinq** :
  `uploadReservePlan` (`lib/cloudinary.ts`) validait un plan sur `file.type`
  **ou** l'extension du nom, sans jamais lire un octet (passe adverse EDITOR,
  lot C1, #3). Un HTML ou un SVG nommé `plan.pdf` passait et repartait
  uploadé en `resource_type: "image"` (nécessaire pour que Cloudinary
  rastérise le PDF — préservé). Fermé par `looksLikePdf`, qui cherche la
  signature `%PDF-` dans les 1024 premiers octets (tolérance du format lui-même,
  pas une largesse ajoutée ici). Les chemins d'upload y passent tous — **six**
  au 2026-09-20 (`9f718ec`, les `export async function upload*` de
  `lib/cloudinary.ts` : client photo, logo, fichier de projet, plan et photo
  de réserve, **photo d'équipement** depuis PR #230 ; le scan de bulletin lit
  aussi les magic bytes mais n'uploade pas). Ce compte a déjà été faux une
  fois (« quatre ») : il se recompte, il ne se recopie pas.
  **HEIC/AVIF/BMP/TIFF sont explicitement couverts** par la détection : le
  HEIC est le format par défaut des iPhone, et les réserves se photographient
  au téléphone. Resserrer cette détection sans le vérifier casse le chemin le
  plus utilisé. ⚠️ Exception délibérée (PR #230, décision B) : la photo
  d'équipement les **refuse** avec un message explicite, parce qu'elle part
  vers un stockage public après `stripArchivedPhotoMetadata`
  (`lib/imageMetadata.ts`), qui ne ré-encode que JPEG/PNG/WebP/GIF ; la
  délégation à Cloudinary a été prouvée sur JPEG (`angle: "exif"` obligatoire,
  sans lui ni rotation ni strip) mais **pas sur un HEIC réel** — voir l'en-tête
  d'`uploadEquipmentPhoto` pour lever l'exception le jour où un fichier
  d'iPhone est disponible.
- Une coercition écrite à la main (`Number(v)` puis `refine`) laisse passer
  `Infinity` ; une date non validée laisse écrire `+275760-09-12`, que Prisma
  relit en `Invalid Date` et qui a rendu `/projects/export` en 500 **pour tout
  le monde, définitivement**. Une donnée d'entrée qui casse une lecture globale
  se corrige **des deux côtés** : validation à l'entrée, et lecture tolérante à
  une ligne déjà corrompue en base.
- **Dates** (lot 4, #247) : une seule primitive, `schemas/fields.ts` —
  `requiredDateField` / `optionalDateField` (`AAAA-MM-JJ` stricte, date réelle,
  années `MIN_DATE_YEAR`–`MAX_DATE_YEAR` = 1900–2100) et `requiredDateTimeField`
  (instant ISO zoné, interventions), à la place de quatre copies de
  `Date.parse`. Une règle inter-champs (« fin ≥ début ») ne juge que **deux
  valeurs déjà valides** : Zod 4 exécute le `refine` d'un objet même quand un
  de ses champs a échoué, avec la valeur brute — sans ce garde, une date
  invalide affichait en plus une fausse erreur d'ordre
  (`schemas/project.ts::endNotBeforeStart`).
- **Mise à jour partielle** (lot 5b, #249) : absent = inchangé, vide = effacé.
  Les schémas de mise à jour n'ont **aucun** `.default()` (un `type` absent
  revenait en « AUTRE » par-dessus la vraie valeur) ; un champ effaçable passe
  par `clearable(inner)` / `clearableDateField`, qui rend `undefined` (omis),
  `null` (vidé) ou la valeur ; les dépôts transmettent `undefined` tel quel, et
  les conversions sans repli destructeur vivent dans
  `lib/partialWrite.ts::dateColumn` et `lib/taskQuantity.ts::quantityTargetPatch`.
  Une borne envoyée seule (une date de fin, une quantité) se compare à l'autre
  **lue en base dans la transaction qui écrit, sous `FOR UPDATE`**
  (`repository/projects.ts::update`, `repository/projectMaterials.ts::update`,
  paramètre `accept`) — sans le verrou, la concurrence viole l'invariant dès le
  premier tour (sondé). Verrou structurel : `tests/repository-partial-write.test.ts`
  (`tests/helpers/partialWriteScan.ts`) interdit `?? null`, `|| null` et
  `?? <défaut>` dans le `data` d'une mise à jour.
- **Import / export CSV** (`lib/csv.ts`, lot 4) : octets décodés en UTF-8
  strict, repli Windows-1252 ; séparateur détecté (`;` ou `,`) et il **dicte les
  conventions** — `;` = virgule décimale, espaces de milliers, `JJ/MM/AAAA` ;
  `,` = point décimal, virgule seulement en milliers groupés par 3, date à
  barres **refusée** (ambiguë). Une valeur incomprise est rendue telle quelle
  pour que le schéma la refuse, jamais normalisée vers une valeur fausse
  (`15,000` valait 15). L'export pose `;` en français, `,` en anglais, avec le
  BOM ; `unescapeCsvCell` est la réciproque **exacte** de `csvCell` (apostrophe
  anti-formule). Plafonds `MAX_IMPORT_BYTES` (8 Mio, sur `file.size`, avant
  lecture), `MAX_IMPORT_COLUMNS` (40) et `MAX_IMPORT_ROWS` (1000), refusés
  **avant** de construire les lignes — calcul de chacun en commentaire. Tout
  import passe par `readCsvUpload` ; tout export par `csvResponse`. Ouvert, en
  liste d'attente : Excel FR retire les zéros de tête (`0612345678`, `01000`)
  et convertit `2026-01` en date — le corriger change l'export vu par tous.

## Migrations

Les règles générales (nommage à vérifier contre le dernier timestamp, ajouter →
backfill → supprimer et son domaine de validité, index sur chaque FK) sont dans
le brief `~/.claude/agents/db-specialist.md` — pas recopiées ici. Propre à ce dépôt :

- Nom : `AAAAMMJJHHMMSS_description`.
- Générer le SQL avec
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
  puis relire : le diff doit contenir *exactement* le changement voulu.
- La prod applique les migrations **au démarrage du conteneur**
  (`docker-entrypoint.sh`) — une migration mergée part automatiquement.
- **Un fichier de migration est une seule transaction**, ici (Prisma 7 sur
  PostgreSQL 16) : prouvé au lot 3 par un échec forcé sur base jetable (une
  ligne qui déclenche le `RAISE` de `20261123100000` → `P0001`, ni colonne, ni
  `CHECK`, ni index appliqués, migration marquée en échec, reprise par
  `prisma migrate resolve --rolled-back` — PR #251). C'est ce qui permet
  « normaliser puis contraindre » dans le même fichier. Un changement d'outil
  ou de moteur se reprouve de la même façon avant de s'y fier.
- **Un index unique partiel ou d'expression** (`CREATE UNIQUE INDEX … WHERE …`,
  `… ON "User" (lower("email"))`) n'existe pas
  pour Prisma : `migrate diff` ne le voit pas, il vit **seulement** dans le SQL
  de la migration — se vérifie dans `pg_indexes`, pas dans `schema.prisma`
  (`EquipmentLoan_equipmentId_open_key`, « un prêt ouvert par équipement » ;
  `User_email_lower_key`, lot 3).
- **Sur un P2002, `meta.target` est vide** avec le driver que l'app utilise
  (`@prisma/adapter-pg`, `lib/prisma.ts`) — sondé sur la base locale, PR #230 :
  les colonnes sont sous `meta.driverAdapterError.cause.constraint.fields`,
  non documenté, et le nom de l'index seulement dans `…originalMessage`. Les
  quatre `catch` P2002 du dépôt (`repository/{clients,jobFunctions,users,
  equipmentLoans}.ts`) traitent donc tout P2002 de leur table comme **le seul
  unique qu'elle porte** — vrai aujourd'hui, faux le jour où une de ces
  tables gagne une seconde contrainte unique : ce jour-là, lire la structure
  de l'adaptateur (et l'épingler par un test), sinon un doublon sur la
  nouvelle contrainte sera annoncé comme un doublon sur l'ancienne.
  `User` porte **deux** uniques depuis le lot 3 (`User_email_key` et
  `User_email_lower_key`), tous deux sur l'e-mail : l'hypothèse tient encore
  pour cette table, par ce seul fait.

## SQL brut (Prisma.raw)

`Prisma.raw` splice son argument dans la requête **non interprété** — aucune
paramétrisation, aucun échappement, à la différence de `$queryRaw`/`$executeRaw`
(tagged-template) dont les `${…}` sont de vrais paramètres liés. C'est le seul
endroit du dépôt où une valeur peut atteindre du SQL sans passer par un bind :
la barre à tenir est donc plus haute que « la valeur n'est pas contrôlée par
l'utilisateur aujourd'hui ».

Un seul point d'usage : `repository/tasks.ts::ASSIGNEE_COLUMN`, qui choisit
entre les trois colonnes d'assignation (`assignedInterimId`/
`assignedCompanyId`/`assignedWorkerId`) pour les CTE de progression par
intérimaire/entreprise/travailleur. Sûr uniquement parce que l'argument de
chaque `Prisma.raw` est un **littéral de chaîne fixé dans le code**, tiré
d'une table fermée à trois entrées codée en dur juste au-dessus — jamais une
valeur lue en base ni un paramètre d'appel ; `${projectId}`, dans le même
tagged-template, reste lui un paramètre lié normal.

**La barre pour un second usage** : uniquement une table fermée de littéraux
de chaîne écrits dans le code, jamais une valeur qui *se trouve* ne pas être
contrôlée par l'utilisateur aujourd'hui — cette dernière propriété ne survit
pas à un refactoring qui fait remonter la valeur un niveau plus haut.
`$queryRawUnsafe`/`$executeRawUnsafe` sont interdits sans exception : leur
paramétrage optionnel n'est pas la protection qu'il paraît être sur une
requête déjà construite par concaténation.

Verrouillé par `tests/prisma-raw-literal-guard.test.ts` : tout `Prisma.raw`
dont l'argument n'est pas un littéral de chaîne (variable, template avec
substitution, concaténation, argument absent) fait rougir la suite, de même
que tout appel à `$queryRawUnsafe`/`$executeRawUnsafe` — domaine découvert en
parcourant le dépôt entier (à l'exclusion du code non applicatif), jamais par
une liste de fichiers.

## Couleurs dynamiques et CSP

`proxy.ts` pose `style-src 'self' 'nonce-…'`, **sans `unsafe-inline`**. Un nonce
n'autorise qu'un **élément** `<style>`, jamais un **attribut** `style` ; et
Tailwind ne génère aucune classe depuis une valeur connue seulement à
l'exécution. Toute couleur qui vient de la base passe donc par une **variable
CSS** :

- `app/layout.tsx` → `--primary` / `--accent` (thème global, `AppSettings`).
- `components/ReserveStatusStyleVars.tsx` → `--reserve-open`,
  `--reserve-resolved` et leurs `-text` pré-calculés, rendu **une fois** par page
  de projet (`:root` est sûr : une page ne rend jamais deux projets). Les classes
  `.reserve-pill-*` / `.reserve-pin-*` d'`app/globals.css` sont les seules à lire
  ces variables.
- `lib/chartColors.ts` → hex pour les SVG + classes Tailwind **littérales**
  jumelles pour les pastilles DOM, écrites en toutes lettres pour que le scanner
  statique les voie. Le commentaire en tête portait déjà la contrainte CSP.
- `lib/color.ts::safeHex` — la garde d'injection elle-même, partagée par les deux
  sites ci-dessus depuis la PR #200, où elle était encore écrite trois fois. Une
  quatrième copie du même prédicat subsiste dans `ColorPickerInput` : ce n'est pas
  un puits d'injection (repli d'affichage du sélecteur natif), mais elle périmera
  en silence le jour où la borne bougera. `tests/style-color-injection-guard.test.ts`
  interdit qu'elle disparaisse d'un puits sans que la suite rougisse.
- `lib/color.ts::contrastTextColor` (luminance WCAG) — même fonction pour le HTML,
  pour le PDF (`lib/reservesReport.ts`) et, depuis la PR #200, pour le bouton des
  e-mails transactionnels (`lib/email/render.ts`), pour que les trois ne divergent
  pas. Le bouton codait `#ffffff` en dur : 3,68:1 sur le bleu livré par défaut, là
  où AA en demande 4,5 — et 1,32:1 si l'admin choisit un jaune vif.
  ⚠️ Cette ligne a annoncé cet appelant pendant des semaines **avant qu'il
  existe** : le rendu d'e-mail n'importait rien de `lib/color`. Une déclaration
  n'est pas un usage, y compris dans cette carte-ci — ce qui y est écrit se
  vérifie par `grep`, jamais par la mémoire de qui l'a rédigé.

Le mode d'échec d'un attribut `style` n'est pas franc : sur un composant
**client**, React réapplique la propriété par le CSSOM après hydratation — donc
« ça marche après un clic » et pas au chargement ; sur un composant **serveur**,
rien ne s'affiche jamais. Il reste **6 attributs `style` dans 4 fichiers**
(`ClientAvatar` ×2 — dont un `<Image>`, qui reporte l'attribut sur le `<img>`
rendu —, positions des pastilles de `ReservesSection` ×2, transformes dnd-kit de
`SectionOrderForm` et `JobFunctionsManager`), tous des composants client :
violations en console plus un état pré-hydratation faux. Ne pas en ajouter.

Ce compte-là a déjà été faux deux fois. « 8 dans 5 » l'est resté après le passage
de l'aperçu d'`AppSettingsForm` au CSSOM (`6049e5b`) ; un recomptage ultérieur a
annoncé « 10 dans 6 » parce qu'il parsait bien l'AST mais retenait aussi les props
React *nommées* `style` (`<ReserveStatusBadge style={…} />`). Il se recompte, il
ne se recopie pas — et parser ne suffit pas : il faut ne garder que les balises
**intrinsèques** (initiale minuscule), plus les composants qui reportent
l'attribut au DOM comme `next/image`.

Une couleur interpolée dans un `<style>` est validée **trois fois** : Zod à
l'écriture (`hexColor`), `CHECK` **ancré** en base, et `safeHex` juste avant
l'interpolation (`app/layout.tsx` et `ReserveStatusStyleVars`). Les ancres du
`CHECK` portent la sécurité : `~` en PostgreSQL est une correspondance **non
ancrée**, sans `^…$` la valeur `#000000; background:url(https://evil/)` passe.
Les quatre contraintes vivent dans `20260823090000` (colonnes de `Project`) et
`20260828100000` (`AppSettings.primaryColor` / `accentColor`), à la forme
identique — caractère pour caractère — à `hexColor` et à `safeHex`.

⚠️ Le commentaire d'en-tête de `20260823090000` annonce encore que ces couleurs
atterrissent « dans un `<style>` **et dans un attribut `style`** » — c'est-à-dire
le mécanisme que la CSP interdit, et qui *était* le bug de la PR #196. Il n'est
pas corrigeable : Prisma stocke une somme de contrôle de chaque migration
appliquée, donc éditer le fichier ferait échouer le prochain `migrate deploy`,
c'est-à-dire le démarrage du conteneur en production. Une migration appliquée
est un artefact daté — ce qu'elle affirme ne fait pas foi, la référence est
ici et dans `schema.prisma`.

⚠️ Cette phrase a été **fausse pour la moitié des couleurs qu'elle décrit**, du
2026-08-23 au 2026-08-28. Le `CHECK` n'existait que sur les colonnes de
`Project` ; `AppSettings.primaryColor` et `accentColor` — précisément celles
qu'`app/layout.tsx` écrit dans le `:root` — n'avaient **aucune** contrainte, et
la ligne correspondante de `docs/SECURITE-CHECKLIST.md` portait un ✅. Elle et
l'affirmation sur l'appelant e-mail plus haut viennent du **même** commit,
`f9b204a`, dont l'objet était justement de retirer un acquis faux de la
documentation. Une couche annoncée mais absente coûte plus cher que pas de
couche du tout : on croit en avoir trois, on en a une, et personne ne la compte
en la retirant. Ça se vérifie en base (`pg_constraint`), pas en relisant ce
paragraphe.

## Sections repliables (page projet)

`components/CollapsibleSection.tsx` rend `{open && children}` : **quand la
section est repliée, ses enfants ne sont pas montés du tout.** Conséquence pour
tout état dérivé d'un signal : le composant enfant peut se monter **après** que
le signal a été émis — il doit donc lire le signal *à son montage*, pas
seulement à son changement. Ignorer ça produit une feature qui compile, passe
les tests, et ne marche pas.

Le composant accepte soit `open` **et** `onOpenChange` (mode contrôlé), soit
aucun des deux — le type l'impose. En mode non contrôlé une section démarre
toujours **fermée**, partout : les cinq sections du tableau de bord d'un
projet comme celles de la page client.

C'est pourquoi **chaque section porte un `badge`** : fermée, c'est la seule
chose qu'on voie d'elle, et une section repliée qui n'affiche rien se rouvre
systématiquement — on n'a alors ajouté qu'un clic.

⚠️ Et c'est pourquoi un rapport PDF ne peut pas s'obtenir par `window.print()` :
une section fermée n'est pas montée, donc absente du DOM imprimé. Le bouton
qui le faisait a vécu du 2026-07-18 à la PR #225 — le rapport n'a **jamais**
contenu autre chose que des en-têtes, sans que personne le remarque : un
défaut de **sortie** ne se voit pas à l'écran, il faut ouvrir l'artefact
produit.

## Rapports PDF

Tous générés **côté serveur** avec `pdfkit`, indépendamment de ce qui est
déplié dans le navigateur : `lib/reservesReport.ts` (le premier), puis
`lib/dashboardReport.ts` (quatre rapports de section + le rapport complet,
PR #225). Les mécaniques communes (A4, polices, en-tête de marque, tuiles,
pagination) sont dans `lib/pdfReport.ts` — un nouveau rapport les consomme,
il ne les re-dérive pas. Six routes `…/report/route.ts`, dans l'ordre des
gardes de lecture ci-dessus (le rapport complet saute la ligne *section* et
ne dessine que celles que l'appelant peut voir), toutes en
`Cache-Control: no-store`.

`pdfkit` lit ses métriques de police (`.afm`) dans son propre paquet à
l'exécution : il est gardé **hors du bundle** (`serverExternalPackages`,
`next.config.ts`) et doit donc exister dans `node_modules` de l'image — c'est-
à-dire figurer dans `dependencies`. Il était en `devDependencies` (ajouté pour
`scripts/build-docs-pdf.mjs`) quand l'app s'est mise à l'importer : le
rapport de réserves a répondu 500 en prod pendant six semaines, tout au vert,
parce que `npm prune --omit=dev` (Dockerfile) l'ôtait de l'image.
`tests/runtime-dependencies.test.ts` refuse désormais cette forme pour tout
paquet importé par le code embarqué.

## Formulaires (modales)

- `components/ModalShell.tsx` **démonte ses enfants à la fermeture**
  (`if (!open) return null`). Tout état conservé dans le composant parent (ref,
  state) **survit** au démontage du formulaire et se désynchronise du DOM
  remonté. Ne jamais déduire ce qui a été soumis depuis une ref alimentée par
  un `onChange`.
- La source fiable de ce qui a été créé est **ce que l'action serveur renvoie**
  (`data`), pas ce que le client croit avoir envoyé.
- Pattern de succès : `useActionState`, comparaison `state !== lastHandledState`
  pendant le rendu pour l'état **local** (légal), et **effet** pour tout appel de
  callback venant des props — appeler une callback de prop pendant le rendu
  déclenche « Cannot update a component while rendering a different component »
  et un double appel en StrictMode.
- **Champs contrôlés** sous `<form action>` (React 19 vide les autres au retour
  de l'action, refus compris) : les fenêtres de tâche, d'intervention, de
  contact et de matériel le sont depuis les lots 4 et 5b ; champ compact à
  libellé et erreur : `components/FormInput.tsx`. Chaque forme d'erreur rendue
  par l'action (`error`, `zodError`) a son rendu, sous le champ quand elle en
  nomme un.
- **Un `<select>` d'édition dont les options sont filtrées perd la valeur
  stockée qu'il ne liste pas** — il soumet la première option. Deux réponses
  dans ce dépôt, à copier : `components/AssigneePicker.tsx` garde l'affectation
  devenue invisible comme option désactivée au libellé neutre (la nommer
  fuirait ce que la section masquée cache) ; `forms/EditMaterialForm.tsx`
  (`linkIsListed`) affiche en lecture seule un lien vers une tâche de série,
  absente de la liste, et n'envoie pas `link` (absent = inchangé). Le second
  déliait le matériel à chaque enregistrement jusqu'à #249.

## Modèles de personnes

`Contact`, `Interim`, `SubcontractorPerson` portent tous un `jobFunctionId`
(FK vers `JobFunction`, `onDelete: SetNull`) — plus aucun `role` en texte libre.
Le `<select>` partagé est `forms/JobFunctionOptions.tsx` ; les options viennent
de `repository/jobFunctions.findAllOptions()` qui ne projette que `{id, name}`
(ne jamais sérialiser la ligne complète vers le client : elle porte la posture
d'accès). L'écran d'admin, lui, a besoin de la ligne complète (`findAll`).

Ajouter un axe similaire à un nouveau modèle = **copier ce miroir**, pas
réinventer.

### Travailleurs d'un projet (`ProjectWorker`) — présence, pas accès

`ProjectWorker` rattache un **compte salarié** (`User`) à un projet. Deux
tables coexistent et ne se confondent jamais :

| Table | Question | Capacité qui écrit |
|---|---|---|
| `Project.assignedUsers` (relation implicite `_UserProjects`) | axe d'**accès** : quels projets l'utilisateur peut *atteindre* (consulté seulement si `JobFunction.projectScope = ASSIGNED`) | `users.manage` — **verrouillée** |
| `ProjectWorker` | axe de **présence** : qui travaille sur le chantier | `content.edit` |

Réutiliser la relation d'accès pour la présence croiserait les axes que ce
dépôt interdit de croiser, **et** donnerait une écriture de configuration
d'accès à quiconque détient `content.edit` sur la page Personnel : rattacher
un salarié lui ouvrirait le projet. Le raisonnement complet (y compris le
`onDelete` des deux côtés) est en tête du modèle dans `prisma/schema.prisma`
— ne pas le re-dériver.

Invariants portés par l'**application**, pas par la FK (une FK prouve qu'une
ligne existe, jamais de quel genre elle est). Les deux leviers sont fermés :
ne pas en rouvrir un seul.

- Un `User.role = CLIENT` n'est jamais un salarié : `attachWorker` refuse au
  rattachement, et `updateUser` refuse de basculer vers `CLIENT` un compte
  déjà rattaché (`hasAnyAttachment`).
- `assignedWorkerId` (tâche / série / catégorie) pointe une ligne du **même**
  projet — résolue en base et comparée, comme `assignedInterimId`.

**Il n'existe pas de clé de section « workers ».** Les sept clés de
`PROJECT_SECTION_ROUTES` sont inchangées : `interims` garde *à la fois* les
intérimaires et les travailleurs (sélecteur, compteur, agrégat d'avancement,
rapport PDF). Conséquence assumée, à ne pas « corriger » sans décision : un
administrateur qui décoche « Intérimaires » pour une fonction masque aussi les
salariés. Les deux écrans d'admin le disent
(`t.jobFunctions.sections.interimsAndWorkersLabel`) ; le titre de la page
Personnel, lui, reste « Intérimaires ».
