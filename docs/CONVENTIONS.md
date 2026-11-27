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
`editTask` renvoyait alors la ligne qu'il modifiait — une lecture aussi. Plus
depuis la branche `fix/retours-actions` : `editTask` ne renvoie plus qu'un
état (`type`, `message`, les erreurs de champ), et aucune action ne renvoie de
ligne (§ « Ce qu'une Server Action renvoie »). Corrigé en ajoutant `requireAreaAccess("projects")` juste après
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
**Fermé** (branche `fix/suites-lot3`) : les quatre scans tirent leurs méthodes d'une
source unique, `tests/helpers/prismaMethods.ts`, qui énumère les **8 lectures** du
client (`findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`,
`findMany`, `count`, `aggregate`, `groupBy`) et tient pour écriture toute autre
méthode appelée sur `prisma`/`tx` — une méthode inconnue est rouge (échec fermé).
Sondé : `updateManyAndReturn` sans bump, `createManyAndReturn`, une méthode inventée
rougissent, `findMany` n'est pas compté. Limite restante (dans les blocs « REMAINING
LIMITS ») : sur un récepteur autre que `prisma`/`tx`, seules les écritures connues sont
reconnues.

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
et index unique `"User_email_lower_key"` sur `lower(email)`. En production
depuis le déploiement de `2f8fbb6` (sonde lue le 2026-11-23 : `2347b47` à 18:35
UTC, `2f8fbb6` à 18:48). **Lu dans la base de prod** le 2026-11-23 à 18:40 UTC
(lecture seule, par SSH) : `_prisma_migrations` porte la migration finie et non
annulée, `pg_constraint` porte `User_email_normalized_check`, `pg_indexes` porte
`User_email_lower_key`, la colonne `sessionVersion` est `integer NOT NULL
DEFAULT 0`, `role` n'a plus de défaut, et les 2 comptes sont à la version 0, e-mails
normalisés. Le journal du conteneur montre « Applying migration
`20261123100000_user_session_version_and_email_ci` », puis « All migrations have
been successfully applied ».
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
fichiers d'`AREA_BY_FILE`, inchangés à `0e10b1b` ; huit depuis
`fix/retours-actions`, avec `lib/loaders/{clientLoader,projectLoader}`, les deux
lectures sorties des actions) saute `requireAreaAccess` —
**lectures comprises depuis PR #187** — ou ne refuse pas sur son résultat.
Depuis #249, **avec l'argument** que la table assigne au fichier, et une entrée
peut en porter plusieurs : `actions/portal/portal.ts` exige `admin.users` **et**
`clients.contacts`, `permanentlyDeleteClient` a sa propre entrée (`overrides`)
à trois rubriques. Il portait auparavant un `READS = new Set([...])`
qui en exemptait trois : l'exemption *était* le trou. Aucune exemption ne se
rajoute ici sans porter sa raison et la condition de sa disparition.

## Ce qu'une Server Action renvoie

Tout export d'un fichier `"use server"` est enregistré dans le manifeste du
build, invocable depuis le navigateur par son id, et **ce qu'il renvoie est
sérialisé vers le navigateur**, que l'écran le lise ou non. Resserrer le type de
la prop qui le reçoit ne retire rien (TypeScript est structurel). Donc :

- une action renvoie un **état** — `type`, `message`, les erreurs de champ —
  fait de littéraux, du dictionnaire, de son entrée (`...prevState`,
  `parsed.data.x`) et des refus de garde (`...roleCheck.error`) ; jamais une
  ligne de dépôt, même enveloppée (`res.data`) ;
- `data` n'existe que pour un lecteur réel, en **littéral de champs nommés** :
  `{ id: user.id }` (`addUser`), `{ categoryId: task.categoryId }` (`addTask`,
  `addTaskSeries`). Seules ces actions portent le champ dans leur type
  (`AddUserActionState`, `CreatedTaskActionState`) : un lecteur ailleurs est une
  erreur de compilation ;
- une **lecture** dont les seuls appelants sont des Server Components n'est pas
  une action : `getClient` et `getProject` vivent dans `lib/loaders/`, gardes
  comprises, et `tests/authz-coverage.test.ts` y exige les mêmes gardes qu'aux
  actions (rôle, rubrique par argument) ;
- un dépôt ne rend que ce que lit un appelant de l'application (`select: { id:
  true }` au minimum) ; un test qui a besoin d'une colonne relit la base
  (`findUniqueOrThrow` + `select`), il n'élargit pas le `select` de production.

**L'instrument** : `tests/server-action-return-guard.test.ts`
(`tests/helpers/actionReturnScan.ts`), en **échec fermé**. Ce qu'une action peut
renvoyer est une liste FERMÉE (`CLOSED_LIST`, chaque entrée avec sa raison ; une
entrée qu'aucun retour n'utilise plus rougit), tout le reste est rouge — y compris
un export qui n'est pas un littéral de fonction (`export const f = withGuard(…)`).
Liaisons résolues par le vérificateur TypeScript, écritures suivies
(affectations, déstructurations, mutations, alias, helpers locaux). Domaine
découvert par la directive parsée, de `.ts` à `.cjs` (seuls `app/generated`,
`node_modules`, `.next`, `.claude` et `.git` sont sautés), à tailles exactes
recoupées par la table d'exports du compilateur — pas par le manifeste, que la CI
ne construit qu'après les tests. À `f308d51` : 24 fichiers, 91 actions (égales une
à une aux 91 entrées du manifeste), **aucune exception** — la seule qu'il y ait eue
(le `...error` d'`addClient`, objet levé par le service, épinglé à `f685ef9`) a
disparu quand l'action a parsé elle-même son formulaire. Limites déclarées en tête du
helper : le test d'une conditionnelle, une valeur rangée dans une autre puis
écrite par elle, une fonction importée qui écrit dans son argument, et ce qu'un
`throw` du `try` porte jusqu'à `getErrorMessage` (qui ne relaie plus que le
`.message` d'une forme de l'application, § « Erreurs vers l'écran »). **Ajouter une
source à la liste fermée est une décision** : sa raison dit ce que la source
rend, et l'instrument la croit sans lire son corps.

## Erreurs vers l'écran, téléversements et compensation (fix/televersements)

**`getErrorMessage` ne relaie plus qu'une forme de l'application** (`lib/helpers.ts`).
Ordre : `repositoryError` → repli ; `instanceof Error` → repli **et cause journalisée** ; code i18n
(avec dictionnaire) → traduction ; objet non-`Error` à `type` et `message` chaînes → son `message` ;
tout le reste → repli, journalisé. Avant, le dernier `return` relayait le `.message` de **tout**
objet : « Must supply api_key » (SDK Cloudinary, qui signe de façon **synchrone** dans l'exécuteur
du `new Promise`) arrivait à l'écran, comme l'aurait fait un message Prisma. Pour qu'un texte
destiné à l'utilisateur franchisse la frontière, on lève `{ type: "error", message }` (ou un code
i18n), **jamais** `new Error(texte)` — les trois de `importProjects` l'ont été. Recensement par
l'AST à `c8230a3` (`ts.isNewExpression` sur `Error|TypeError|RangeError|SyntaxError|EvalError|URIError|AggregateError`,
dans les fichiers suivis de `actions/`, `lib/`, `service/`, `repository/`, hors code généré ; 131 fichiers) :
**4** — `actions/projects/projects.ts` ×3 (texte utilisateur, converties), `lib/csv.ts::csvHeaderOf`
(programmeur, au chargement du module). **Depuis, 4 de plus, jamais relayées** : `lib/email.ts` ×2 (échec d'envoi,
journalisé par l'appelant qui l'avale) et `lib/cloudinaryDelivery.ts` ×2 (réponse de téléversement non comprise,
attrapée par `uploadBuffer`) levaient `{ type: "error", message: <anglais> }`, que l'ensemble fermé de
`getErrorMessage` aurait relayé tel quel : ce sont des `Error` natives, qui reçoivent le repli. Les autres `throw` sont des objets (`{type,message}` ×46,
`repositoryError` ×198, codes `i18n`, `scanError`/`refusal` à `code`…).

**Un seul envoi vers Cloudinary** : `lib/cloudinary.ts::uploadBuffer`. Il attrape l'exception
synchrone du SDK, la journalise (`Cloudinary upload refused before sending:` + cause) et rejette en
`{ type: "error", message, i18n: "uploadFailed" }` ; il attrape aussi la conversion de la réponse
(`toResult`), qui s'exécute dans un callback du SDK où un `throw` tuerait le processus.

**Une seule lecture du compte-rendu de `destroy`** : `lib/cloudinary.ts::destroyAndReport`, pour le logo, la
photo d'entreprise, la photo d'équipement et tout actif gardé (le logo n'en lisait aucune, les trois autres la
lisaient chacune à sa façon). Tout ce qui n'est pas « ok » est journalisé **avec le `public_id`** ; « not found »
est la réponse attendue pour un actif déjà parti, **sauf** pour un actif que ce processus vient d'envoyer
(compensation : `justUploaded`) — il ne peut pas être absent, « not found » y veut dire **non confirmé** et se
journalise comme tel. Les lignes de `lib/uploadCompensation.ts` (« compensation skipped … kept », « compensation
failed ») portent le `public_id` aussi (`UploadCompensation.publicId`).
**Une erreur rendue par le callback de Cloudinary** est journalisée avec son `message` et son `http_code`
(`Cloudinary upload failed:`) : une clé ou un secret faux se diagnostique sur cette ligne, l'utilisateur ne voit que
« Échec de l'envoi ». **Une réponse non conforme après l'envoi** (`toResult` lève) alors qu'un `public_id` est
lisible : l'actif existe chez Cloudinary (et, pour les publics, est joignable) — il est détruit, par le `type` et le
`resource_type` de la réponse telle qu'elle est venue, **avant** le refus.
**`getErrorMessage` relaie un ensemble FERMÉ de formes** (`RELAYED_ERROR_TYPES`, `lib/helpers.ts`) : `error`,
`zodError`, `databaseError`. Recensement des `type: "…"` littéraux d'`actions/`, `lib/`, `service/`,
`repository/` et `schemas/` (grep des littéraux, états `success` exclus) : `error`, `zodError`, `databaseError`,
`repositoryError` (toujours le repli), `duplicate` (texte anglais ; les quatre actions qui l'attendent le traduisent
avant d'arriver ici), `unmatchedScanMaterial` et `guardRefused` (aucun `message`). Un `duplicate` qui arrive jusqu'à
`getErrorMessage` reçoit le repli, jamais son texte anglais.
**F7 — `updateSettings` et `uploadLogo` n'écrivent plus les colonnes l'un de l'autre** : le formulaire de marque
(`upsert`) écrit le nom et les couleurs et **jamais** le logo (omis = inchangé) ; le téléversement et le retrait du
logo (`updateLogo`) n'écrivent que `logoUrl`, `logoPublicId` et l'auteur. Chacun recopiait avant les colonnes de
l'autre, lues un instant plus tôt : le dernier à valider défaisait l'autre avec une copie périmée.

**Une seule compensation** : `lib/uploadCompensation.ts`. Seule l'**écriture** est enveloppée
(`writeWithCompensation`), jamais l'action : un échec après une écriture réussie ne détruit rien. Destruction
sans condition seulement si l'échec **prouve** que l'écriture n'a pas eu lieu (`writeRefused` : seul
le doublon d'e-mail d'entreprise le prouve, les dépôts enveloppant toute panne en `repositoryError`) ;
sinon seulement si **aucune ligne ne référence** l'asset (`is…Referenced` dans les dépôts), et si
cette lecture échoue aussi, l'asset est **gardé** et le cas journalisé. La destruction passe le `type` et le
`resource_type` **lus dans la réponse du téléversement** (`destroyUploadedAsset`) et lit le compte-rendu
(`destroy` ne lève rien sur un `type` erroné). Une destruction qui échoue ne masque jamais le refus d'origine.
Appelants : logo, fichier de projet, plan et photo de réserve, archive du bulletin, photo d'équipement
(`writeWithCompensation`) ; photo d'entreprise : `updateClient` passe par `writeWithCompensation`, `addClient`
garde la forme `try/catch` + `discardAfterFailedWrite` (même décision) parce qu'il **lit** `.message` du résultat de
l'écriture pour son retour, et que `tests/server-action-return-guard.test.ts` ne suit pas un retour lu à travers
un callback ; le jour où le garde le suit, `addClient` rejoint les autres.
**Le bulletin de livraison (`applyDeliveryNoteScan`) écrit dans cet ordre** : (1) tout ce qui est bon marché et en
lecture : le contrôle du fichier (signature, taille : aucun décodage), les `materialId` contre le chantier
(`repository/projectMaterials.ts::findIdsInProject`, une requête `select id` sans jointure ; même verdict que
`applyScanItems` — un id qui ne correspond à aucune ligne du chantier est refusé — **avant** tout décodage : une liste
forgée ne dépense pas de temps de décodeur), et **le dossier « Bulletins de livraisons »** (une lecture qui lève doit
lever **avant** qu'un fichier soit envoyé : sinon l'archive restait orpheline chez Cloudinary) ; (2) le décodage,
le plafond de sortie et l'envoi de l'archive — tout ce qui coûte ou peut échouer sans toucher une ligne ; (3) **une
seule transaction** pour les matériaux et la ligne `ProjectFile` : `applyScanItems(projectId, items, supplier,
archive?: Omit<FileData, "projectId">)` écrit la ligne d'archive avec `createWithin(tx, …)` (`repository/projectFiles.ts`) à la suite des
matériaux. Si la transaction échoue, rien n'est appliqué, l'archive qu'on vient d'envoyer est compensée et
« Réessaie » est vrai **quand la transaction a réellement échoué**. **Un accusé de commit perdu** (hypothèse : la
transaction réussit, le pilote lève quand même) est tranché ainsi : la ligne d'archive est écrite dans la même
transaction, donc, quand l'écriture échoue et qu'une archive existe, **une ligne qui référence l'archive
(`isPublicIdReferenced`) PROUVE le commit** — l'action répond succès et garde l'archive (une ligne illisible garde
l'archive et rend l'erreur). **Sans archive** (pas de photo, ou une archive hors stockage), **rien ne le prouve** : l'erreur
est rendue telle quelle, et un nouvel essai pourrait doubler le stock dans ce seul cas — risque non fermé, écrit ici. **Le seul succès partiel qui reste** : la sortie
nettoyée dépasse encore `STORAGE_MAX_FILE_BYTES` après la réduction à 25 Mpx ; les matériaux sont appliqués **sans**
archive, et l'action renvoie `type: "warning"` (« Matériaux appliqués. L'archive du bulletin dépassait la taille de
stockage (10 Mo) et n'a pas été enregistrée. »). **Un état à part, pas `"success"` avec un autre texte** : la modale
ferme sur tout `"success"` et personne ne lisait le message ; `ApplyDeliveryScanActionState.type` vaut
`"error" | "success" | "warning" | "zodError" | null`, et l'interface teste `"warning"`.
**Le scan (`scanDeliveryNote`) décode AVANT de réserver l'unité du quota horaire** (20 par heure) :
`prepareDeliveryNoteImage` (validation, puis `reduceImageForModel`) précède la réservation, qui précède l'appel payant
(`extractDeliveryNoteItems(prepared)`). Un refus du décodeur (`imageInProgress`, `imageQuota`, `imageBusy`,
`imageUnavailable`) n'est pas un scan : un double clic ne coûte plus une unité.

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
  **Photo d'entreprise (publique), état à `1fed10d`** : JPEG, PNG, WebP et
  GIF sont ré-encodés dans leur format, orientation appliquée puis métadonnées
  retirées (`stripArchivedPhotoMetadata`) ; **AVIF et TIFF sont convertis en
  JPEG nettoyé** (`convertToStrippedJpeg`, mêmes plafonds) ; **HEIC et BMP
  partent tels quels**. BMP : le format n'a pas de bloc EXIF/GPS (en-tête de
  fichier, en-tête DIB, pixels), il n'y a rien à retirer. ⚠️ **HEIC ouvert** :
  sharp ne le décode pas, son GPS peut rester lisible sur l'URL publique tant
  qu'un vrai HEIC d'iPhone n'a pas été déposé sur un compte Cloudinary de test
  puis passé à `exiftool` sur la `secure_url`. Un GIF ou un WebP animé est
  réduit à sa première image (choix délibéré : un avatar).
  **Coût d'un décodage sharp, ce qui le borne** (`lib/imageMetadata.ts`,
  `lib/imageDecodeBridge.ts`, `scripts/image-decode-child.mjs` ; quatre chemins
  applicatifs : photo d'entreprise, photo d'équipement, archive du bulletin,
  image du bulletin pour le modèle) :
  - **ce qui borne une tâche, c'est la mort d'un processus** : aucun code de
    l'application n'importe sharp, et `next-server` ne le charge pas non plus
    par son optimiseur d'images (`images.unoptimized: true`, `next.config.ts` ;
    `/_next/image` répond 404, vérifié sous `next start`). Tout appel
    (`metadata()` compris) s'exécute dans un **processus enfant** lancé depuis
    `scripts/image-decode-child.mjs`
    (JS ESM simple, copié dans l'image par le Dockerfile, chemin résolu depuis
    `process.cwd()`), et ce processus reçoit **`SIGKILL` à l'échéance de
    `DECODE_DEADLINE_SECONDS = 20`**, en temps réel. Le délai couvre tous les
    appels sharp de la tâche, de la requête à un enfant **prêt** jusqu'au
    résultat. Pourquoi un processus et pas un délai dans sharp : un appel natif
    ne s'interrompt pas depuis JS. Un JPEG progressif de 3 529 balayages
    (525 Ko) est absorbé tout entier par `jpeg_start_decompress`, avant toute
    vérification du délai ; un TIFF de 100 pages × 4 000 étiquettes (4,8 Mo)
    passe 28 s dans `metadata()` (Windows, en processus) ; chaque amplificateur
    fermé en JS a été suivi d'un autre. À l'échéance, la tâche est refusée
    `corruptedImage` (aucun code nouveau côté utilisateur), une ligne de journal
    dit l'opération et la durée (jamais le contenu), et la tâche suivante
    relance un enfant. Un enfant qui meurt (mémoire, signal, plantage natif)
    refuse de même la tâche en cours (code ou signal journalisé) et est relancé
    paresseusement. **Le démarrage de l'enfant** (lancement + import de sharp)
    a son propre délai de 30 s et une poignée de main « prêt » : s'il échoue, la
    tâche est refusée et le décodage ne se replie **jamais** dans le processus
    serveur. `SHARP_TIMEOUT_SECONDS` et `.timeout()` n'existent plus : une
    borne, une constante ;
  - **une borne mémoire sur Linux** : le kill borne la durée, pas le pic, et
    le conteneur n'a pas de limite mémoire (Postgres sur le même hôte). Un PNG
    d'un pixel de 1,5 Mo portant 40 chunks `zTXt` qui se décompressent chacun en
    40 Mo montait l'enfant à 5,8 Go (Windows) et réussissait. L'enfant est donc
    lancé par `/bin/sh` (`buildChildLaunch`, arguments **positionnels**, jamais
    interpolés dans le texte du shell) avec `ulimit -d` à
    `CHILD_DATA_LIMIT_MB = 1536`. **La limite porte sur la mémoire virtuelle**
    (`VmData` : tas et mappages anonymes privés), pas sur le RSS : l'AVIF 12 bits
    au budget mesure 884 Mo de `VmData` pour 703 Mo de RSS, le WebP 40 Mpx 721 Mo
    pour 414 Mo, le GIF 6000×6600 700 Mo pour 604 Mo. La marge réelle est donc
    1 536 / 884 ≈ 1,74, pas « 2 fois le RSS ». `RLIMIT_DATA` s'applique en
    production (noyau 6.8.0 sans `ignore_rlimit_data` ; sous `ulimit -d 102400`,
    `Buffer.alloc(3e8)` est refusé dans le conteneur). **Les fichiers core** : une bombe arrêtée par la limite meurt en SIGABRT (échec de
    `g_malloc`, ou OOM fatal de V8) là où l'OOM killer envoyait un SIGKILL sans
    core. **Le lanceur ne touche JAMAIS à `RLIMIT_CORE`** : quand `core_pattern` est
    un pipe (c'est le cas sur le VPS : `|/usr/share/apport/apport …`), le noyau
    (`fs/coredump.c`) ignore `RLIMIT_CORE` sauf la valeur **1 octet**, qui veut dire
    « pas de dump » ; sous `ulimit -c 0`, un `abort()` a écrit un core de 261 Mo
    (prouvé), avec `--ulimit core=1:1` aucun, et un `-c 0` posé sous cette limite à 1
    en réécrit un (busybox ne sait d'ailleurs pas poser 1 octet : il compte par blocs
    de 512). La garde vit au **niveau du conteneur** (`ulimits: core: 1:1` du service
    `web`, `docker-compose.prod.yml`, à reporter sur le VPS au déploiement : le déploiement ne recopie pas ce fichier, reporté sur le VPS le 2026-11-27 avant le merge de #256 ; vérifié par SSH le 2026-11-28 à `0b2e320` : `docker inspect` rend `core` 1:1, et `Max core file size 1 1` dans `next-server` comme dans l'enfant — `deploy/README.md`) et
    l'enfant en **hérite** sans changement (test Linux : `/proc/self/limits` du parent
    et de l'enfant). Observé sur le VPS : un `abort()` dans un conteneur jetable de
    l'image de production affiche « core dumped », `/var/crash` et
    `/var/lib/apport/coredump` restent vides (apport abandonne aujourd'hui les crashs
    de conteneur), mais le noyau lui transmet quand même tout le core : jusqu'à 1,5 Go
    d'E/S par bombe, sur le disque que Postgres partage. Enfin `oom_score_adj = 1000` : à court de mémoire, l'hôte tue l'enfant avant
    `next-server` ou Postgres (au mieux : un échec est ignoré). **Fermé par
    défaut** : si `ulimit -d` échoue, pas d'`exec` (code 97), l'enfant n'est jamais
    prêt, la tâche est refusée et une ligne est journalisée. Sous Windows et macOS
    (développement) l'enfant est lancé directement, **sans borne mémoire** : seul
    le délai s'applique. Observé sur alpine/busybox et sur debian/dash (uid 1001) :
    « Max data size » à 1 610 612 736 octets, « Max core file size » **inchangé** (1 sous `--ulimit core=1:1`), `oom_score_adj` à 1000, code 97 si
    la limite est invalide, une allocation répétée s'arrête sous la limite ; la
    bombe à 120 chunks s'arrête d'elle-même (`GLib-ERROR`, SIGABRT, 6,9 s) sous
    1 Go. Les tests Linux de `tests/image-decode-launcher.test.ts` et celui
    de la bombe de `tests/image-decode-bridge.test.ts` ne tournent que sous Linux ;
  - **la sortie est bornée, par l'enfant, avant l'envoi** : un PNG de 160 Ko
    (12000×3333, lignes identiques, filtre Up) ressortait de sharp en 114,6 Mo en
    3,5 s (sharp écrit son PNG sans filtrage), et les photos d'entreprise et
    d'équipement l'envoient ensuite à Cloudinary. La requête `encode` porte
    `maxOutputBytes` ; l'enfant refuse (`outputTooLarge`) une sortie qui le dépasse
    **avant** de l'envoyer ; une seule constante, dans le parent,
    `MAX_ENCODED_OUTPUT_BYTES = 32 Mio`, soit plus de 2 fois la plus grosse sortie
    légitime mesurée (JPEG 40 Mpx de 10 Mo réencodé à q95 : 12,5 à 13,1 Mo ; PNG
    entrelacé 40 Mpx : 4,0 Mo ; WebP bruité : 9,4 Mo). **`png({ adaptiveFiltering:
    true })` n'est PAS appliqué** (mesuré, Windows, une passe de sharp, fichiers
    d'entrée au plafond) : PNG entrelacé 40 Mpx 4,03 Mo en 0,55 s sans, 0,39 Mo en
    1,17 s avec (2,1 fois la durée, au-dessus des 2 fois acceptées) ; PNG de la
    sonde (lignes identiques) 120,2 Mo en 1,94 s sans, 0,16 Mo en 0,77 s avec ; image
    synthétique de 12 Mpx 27,8 Mo en 0,64 s sans, 5,6 Mo en 0,63 s avec. Le plafond de
    sortie couvre le cas sans ce réglage ;
  - **l'état du décodeur est lisible sans accès privilégié** : `/api/health`
    expose `imageDecoder: "ready" | "failed" | "idle"` (le résultat du dernier
    démarrage de l'enfant, un état et rien d'autre : ni pid, ni message, ni chemin ;
    les champs existants sont inchangés). `failed` veut dire que **le dernier démarrage
    de l'enfant a échoué et qu'un nouvel essai est programmé** ; les envois de photos
    sont refusés en attendant. Après un échec, le pont réessaie **seul, en arrière-plan,
    avec une attente croissante** (30 s, 60 s, 120 s, … 15 minutes au plus ;
    `retryDelayMs`, timers `unref`) ; la sonde ne déclenche jamais rien, elle lit ; un
    succès repasse l'état à `ready`. L'enfant est démarré une fois au lancement du
    serveur (`instrumentation.ts`, runtime `nodejs`, hors de la phase
    `phase-production-build`, sans attendre ni jamais lever) : observé sous `next
    start`, la sonde rend `ready` dès le démarrage, et `failed` (serveur toujours
    debout) quand le script enfant est absent. `register()` n'est **pas** appelé pendant
    `next build` (un `console.error` temporaire, retiré : rien dans la sortie du build,
    une ligne sous `next start`) ; la garde est de la défense en profondeur ;
  - **les chunks de texte d'un PNG sont retirés avant l'enfant**
    (`lib/pngTextChunks.ts`, fonction pure : `tEXt`, `zTXt`, `iTXt`, que
    l'application jette de toute façon ; `iCCP` et `eXIf` — l'orientation — sont
    gardés ; le CRC est propre à chaque chunk ; une structure coupée est recopiée
    telle quelle). C'est un refus précoce de l'amplificateur connu, pas une borne :
    la borne mémoire ci-dessus est ce qui tient pour les amplificateurs inconnus ;
  - **l'enfant est un exécutant fermé, à l'environnement filtré** : deux opérations
    (`metadata`, `encode`), chaque requête validée clé par clé, tout le reste
    refusé par un code (`invalidRequest`, `decodeFailed`) — il ne renvoie jamais
    de message natif (il le journalise sur sa propre sortie d'erreur ; un
    `invalidRequest` est un bug du pont, journalisé des deux côtés, clés seulement).
    Son environnement est construit **par liste blanche** (`buildChildEnv`, fonction
    pure testée : `PATH`, `NODE_ENV`, plus `SystemRoot`/`TEMP`/`TMP` sous
    Windows) : ni `DATABASE_URL`, ni `AUTH_*`, `CLOUDINARY_*`, `RESEND_*`,
    `ANTHROPIC_*`, `OPENAI_*`. Aucun drapeau du serveur n'est transmis (jamais
    d'`--inspect` hérité),
    sérialisation `advanced`, stdin ignoré, stdout/stderr visibles dans les
    journaux du conteneur. Un seul enfant par processus, gardé sur `globalThis`
    sous un `Symbol.for` comme la file ; il est `unref` (lui et son canal) : un
    enfant inactif ne retient ni le serveur ni vitest, et il sort quand l'IPC
    se déconnecte. Il règle `sharp.cache(false)` et `sharp.concurrency(1)` (le
    VPS a deux cœurs partagés avec le serveur web et la base ; le décodeur n'en
    prend qu'un). **La politique reste dans le parent** :
    le plafond de pixels, le budget d'octets décodés (l'enfant renvoie l'en-tête,
    le parent décide), les qualités et le grand côté sont envoyés avec chaque
    requête, une seule source par constante. **Ce n'est PAS un confinement** : c'est
    une borne de durée et de mémoire. L'enfant tourne sous le même uid que le
    serveur : il peut lire `/proc/<ppid>/environ` (donc les secrets du serveur),
    écrire dans `/app` (`chown -R nextjs` : son propre script, les chunks de
    `.next`), envoyer un signal à son parent et lui envoyer des trames IPC
    invalides. Une faille d'exécution de code dans libvips reste une compromission
    du serveur, comme avant. La liste blanche d'environnement ne retire que
    l'héritage **accidentel** (`NODE_OPTIONS`, `--inspect`, un secret qui
    finirait dans les journaux de l'enfant). Le durcissement (`/app` en lecture
    seule, un autre uid pour l'enfant) est un **lot séparé, ouvert** ;
  - **une file unique du processus**, de concurrence 1, **bornée à 8 tâches en
    attente** (la suivante est refusée tout de suite, code `imageBusy`, traduit
    par chaque appelant : `uploadBusy` pour les photos, `scan.errors.imageBusy`
    pour le bulletin — jamais d'envoi de l'original). Elle vit sur `globalThis`
    sous un `Symbol.for(...)` : le build embarque le module dans **deux**
    chunks, et un état de module aurait donné une file (et un enfant) par chunk.
    Tout nouveau chemin d'image passe par `encodeOriented` (file, contrôles JS,
    enfant), pas par un `sharp(...)` direct ;
  - **la part d'un compte dans le décodeur** (`lib/imageMetadata.ts`, état sur `globalThis`
    sous un `Symbol.for(...)` comme la file : la ressource protégée est le processus) :
    **`owner` est obligatoire** dans tout l'API de décodage (`runExclusive`, `encodeOriented`,
    `stripArchivedPhotoMetadata`, `convertToStrippedJpeg`, le chemin du modèle) — l'ancienne
    signature n'existe plus, un appelant oublié ne compile pas. C'est l'identifiant que la
    **garde de rôle ou de session a résolu** (`requireCapability(...).email`), jamais un champ de
    formulaire (les tests des actions le prouvent avec un champ `owner` forgé). Deux bornes :
    **(1) une tâche par compte dans la file, en attente ou en cours** — la deuxième est refusée
    tout de suite, `imageInProgress` (neuf envois simultanés d'un seul compte remplissaient la file,
    1 + 8, et tout le monde recevait `imageBusy` : prouvé par l'audit) ; **(2) un budget de TEMPS
    de décodage par compte** : la somme des durées réelles passées dans l'enfant (du départ de
    la tâche, enfant prêt, à sa fin, **kill compris**, **au moins 250 ms** par tâche qui a atteint
    l'enfant) sur une heure glissante, **300 s** (`DECODE_BUDGET_MS`) ; au-delà, la tâche est refusée
    **avant** d'entrer dans la file, `imageQuota`, avec le délai en minutes (le moment où assez des
    plus anciennes minutes sortent de la fenêtre). Le contrôle est une **borne d'admission**, pas un
    plafond de la somme : une tâche admise juste sous le budget peut finir bien au-delà (d'une tâche, 20 s
    au plus). Il remplace la limite en base de 30 photos par quart d'heure, qui comptait des
    requêtes alors que ce qui coûte est le temps. Le contrôle et la réservation sont **un seul pas
    synchrone** (aucun `await` entre les deux : deux envois du même tick ne passent pas tous les deux).
    **Ne coûte rien** : un refus de taille, de signature, un contrôle JS, `imageBusy`,
    `imageInProgress`, `imageQuota`, `imageUnavailable`. **Coûte** : un décodage réussi, échoué ou tué
    (une bombe tuée à 20 s coûte 20 s : quinze épuisent l'heure). **La comptabilité est bornée** : un
    registre est une case **par minute** (au plus 60 vivantes par compte, avec un total courant), et le
    **plancher de 250 ms** borne un compte à 1 200 tâches par heure — ce qui borne aussi ses envois sur
    les chemins décodés. Avant, chaque tâche ajoutait un intervalle, et une tâche bon marché (un refus
    après la lecture d'en-tête : 0,42 ms) en empilait ~716 000 en une heure (mesuré par l'audit : 16,8 ms de
    temps synchrone par appel pour **un autre** compte, 74 Mo de tas, 50 ms à trois comptes). Les minutes
    échues sont retirées pour l'appelant à chaque accès ; les **autres** comptes sont balayés au plus une
    fois par minute (le balayage parcourt des comptes, pas des intervalles ; un compte vide est oublié).
    **Mesure** (`tests/image-account-share.test.ts` pour l'invariant ; mesure ponctuelle, Windows, enfant
    simulé) : 100 000 tâches bon marché d'un compte en une rafale — 1 200 admises, 98 800 refusées
    `imageQuota` à 0,0018 ms l'une —, puis des appels d'**autres** comptes : 0,003 ms en moyenne (0,18 ms au
    pire), un registre d'**une** case, ~4,5 Mo de tas (bruit de ramasse-miettes compris). **Perdu
    à chaque redémarrage du processus, et non partagé entre instances** : même portée que la file.
    **Le contrôle bon marché passe d'abord** : l'en-cours et le quota sont décidés, et la place
    réservée, **avant** le parcours JS d'un fichier de 10 Mo (`countImageFrames`, `stripPngTextChunks`) ;
    un fichier que ce parcours refuse rend la place, ne reçoit pas `imageBusy` et ne coûte rien (le
    tout reste synchrone). **Sens légitime, prouvé** (`tests/image-account-share-real.test.ts`, vrai enfant, vrai sharp, une
    photo de 12 Mpx, 4032 × 3024) : un inventaire de 40 outils d'affilée et une session de 20 scans
    de bulletin (modèle puis archive, 40 décodages) passent **sans aucun refus**, en ~3 s de
    décodeur au total pour chacune des deux charges, sur ce poste (Windows, image synthétique en dégradé : le coût réel d'un
    décodage est dans les pixels, mais la vitesse du VPS — deux cœurs partagés — n'est **pas**
    mesurée ici) contre 300 s de budget. Ce que la part par compte **ne borne pas** : plusieurs
    comptes qui se coordonnent (chacun a sa part : la file de 8 et le délai de 20 s les bornent) ;
  - **ce que la file et la part par compte bornent d'une rafale** (envois simultanés) : pour **un**
    compte, au plus une tâche dans la file à tout instant, quel que soit le nombre de requêtes
    (les autres sont refusées dans la même milliseconde, sans toucher l'enfant) et au plus 300 s de
    décodeur par heure ; pour **le processus**, une tâche dans l'enfant, huit en attente, donc 9 comptes au plus
    en train d'attendre et le **dixième** compte suivant `imageBusy`. Un compte seul ne peut donc plus
    remplir la file ni faire répondre « serveur occupé » aux autres ; la mémoire reste bornée par
    l'enfant (`ulimit -d`, un décodage à la fois), la durée par compte par le budget ;
  - **un enfant qui ne démarre pas n'est pas un fichier refusé** : `encodeOriented` lève
    `imageUnavailable` (« Le traitement des images est momentanément indisponible. Réessaie dans
    quelques minutes. ») quand le **démarrage** échoue — la tâche n'a pas commencé, ce n'est pas la
    photo de l'utilisateur, et rien n'est compté. Avant, un JPEG légitime recevait « Le fichier doit
    être une image. ». La mort de l'enfant pendant une tâche reste `corruptedImage` (la tâche a
    commencé). **Le kill à l'échéance est `imageTooHeavy`** (« Cette image est trop lourde à traiter. Essaie
    une version plus légère. ») : un WebP légitime tué à 20 s affichait « Le fichier doit être une image. ».
    Le pont exporte des **prédicats typés** (`isDecodeDeadlineError`, `isOutputTooLargeError`, des
    marqueurs sur l'`Error`, pas de classe) ; plus aucune correspondance sur le texte d'un message. Le
    même `Error` marqué part vers la tâche et vers la course : celui qui se règle le premier dit
    « échéance » ;
  - **les plafonds de sortie viennent de l'appelant, calibrés sur ce que l'aval accepte** :
    `lib/cloudinary.ts::STORAGE_MAX_FILE_BYTES` (10 Mio) et `STORAGE_MAX_IMAGE_PIXELS` (25 Mpx), une
    source chacun, lus par l'API d'administration de Cloudinary depuis le conteneur de production le
    2026-11-27 (plan « Free » : `image_max_size_bytes` = `raw_max_size_bytes` = 10485760,
    `image_max_px` = 25000000). Photo d'entreprise, photo d'équipement et archive du bulletin les
    passent à `encodeOriented` (`maxOutputBytes`, `fitInPixels`) ; l'image envoyée au modèle garde le plafond
    global (32 Mio, borne haute de tous les chemins) et n'a rien à faire tenir en pixels (elle est
    réduite à 1568). **Une image de plus de 25 Mpx est RÉDUITE pour tenir dans 25 Mpx, proportions
    gardées, jamais refusée** — le stockage ne peut pas la garder telle quelle, c'est une conséquence du
    plan de stockage, et 25 Mpx reste très lisible (un A4 scanné à 600 dpi, 4960 × 7016 = 34,8 Mpx,
    passait le scan et l'appel au LLM puis était refusé en entier, à chaque essai). Le grand côté se
    calcule depuis l'en-tête déjà lu (`longEdgeToFit`), l'enfant redimensionne (`maxLongEdge`) ;
    l'orientation est appliquée avant. **Le calcul reproduit la règle de sharp** (grand côté = l'arête, petit côté =
    `max(1, round(petit × arête / grand))`) et retient la **plus grande arête dont le produit tient** : l'ancienne
    formule (« un pixel de moins ») ne compensait pas l'arrondi du petit côté dès que le rapport des côtés dépasse
    ~4,2 (13175 × 2957 ressortait à 25 000 057 px, 20000 × 1300 à 25 002 750 px — prouvé par le vrai enfant dans
    l'image ; une grille de rapports trouvait 15 370 dépassements), et au-delà d'un rapport de 16 l'arête demandée
    dépassait la borne de l'enfant. `tests/image-account-share.test.ts` rejoue une **grille** (rapports de 1 à 40
    par quarts, tailles de 25 000 001 à 40 000 000 px, deux orientations, des bandes d'un pixel) : elle exige
    que le produit tienne, que l'arête soit la plus grande qui tienne, qu'elle ne dépasse ni l'entrée ni la borne
    de l'enfant ; **sonde** : l'ancienne formule la fait rougir (478 dépassements sur cette grille).
    **Borne de l'enfant (`MAX_LONG_EDGE`) : 40 000 000** (elle était de 20 000). Calcul : une demande de
    redimensionnement ne fait que **réduire** (`withoutEnlargement`), donc l'arête demandée ne dépasse jamais le
    grand côté de l'entrée ; or une entrée admise a au plus 40 000 000 px (`SHARP_MAX_INPUT_PIXELS`), donc son grand
    côté vaut au plus 40 000 000 (une bande d'un pixel de haut). Un panorama de rapport 40 réduit à 25 Mpx demande
    ~√(25 M × 40) ≈ 31 600 : le cas ordinaire est bien au-dessous, la borne couvre le pire cas. Il n'y a plus de code « trop de pixels ». Une sortie qui dépasse encore le plafond d'octets
    est refusée **avant l'envoi** : pour la photo d'entreprise et la photo d'équipement,
    `outputTooLarge` (« Image trop volumineuse après traitement (10 Mo max). ») ; pour l'archive du
    bulletin, les matériaux sont appliqués **sans** l'archive et l'état est un avertissement (voir plus
    haut). **Les plafonds
    d'entrée annoncés ne changent pas** (fichiers de chantier 20 Mo, plans de réserve 25 Mo, photos
    10 Mo) : décision produit, ouverte (`docs/SECURITE-CHECKLIST.md`) ;
  - **des refus précoces, en JS, AVANT la file et l'enfant** (`lib/imageFrameCount.ts`,
    sans importer sharp ; un fichier refusé ne prend jamais de place dans la file et
    ne reçoit jamais `imageBusy`) : ils ne bornent **rien** par eux-mêmes — ce sont des
    refus à quelques millisecondes des amplificateurs déjà connus, pour ne pas
    attendre 20 s ni démarrer un décodage. Le format vient du détecteur unique
    (`detectRasterImageMediaType`, `lib/fileSignature.ts`), jamais du type
    déclaré ; **fermé par défaut** : PNG et AVIF comptent pour une image (le
    délai les borne), HEIC, BMP et l'inconnu sont `invalid` (aucun chemin ne les
    décode : le sharp précompilé n'a ni décodeur HEVC ni lecteur BMP).
    **JPEG** : parcours des segments avec les règles de resynchronisation de
    libjpeg (`next_marker` : octets non `FF` sautés, `FF` répétés, `FF 00`
    sauté ; le même parcours sort des données entropiques), on compte les `SOS`,
    refus au-delà de `MAX_JPEG_SCANS = 100` (mozjpeg progressif en émet une
    dizaine) ; un JPEG tronqué n'est **jamais** refusé pour sa troncature
    (`failOn: "none"`). **GIF** : descripteurs d'image, au plus
    `MAX_GIF_FRAMES = 10 000` ; après une première image complète, un bloc
    inconnu, une fin prématurée ou des octets parasites à la place du `0x3B`
    marquent la fin (+1 si l'image coupée avait commencé), sans image complète
    c'est `invalid`. **WebP** : chunks `ANMF`, comparés par mot de 32 bits, au
    plus `MAX_WEBP_FRAMES = 10 000` (comme le GIF : une animation d'une minute
    passe en GIF, le WebP ne doit pas être plus strict pour le même fichier).
    **TIFF** : au plus 100 pages — **refus délibéré** : seule la page 0 sert, un
    scan de document de 150 pages n'est pas une photo d'entreprise ni un bulletin,
    et les bornes d'étiquettes plafonnent le reste —, 256 entrées par IFD, 4 096 sur la chaîne ; un pointeur d'IFD suivant
    hors du fichier **après le premier IFD** termine la chaîne, un premier IFD
    hors du fichier est `invalid` ; garde de boucle ; BigTIFF refusé ;
  - **le cache de libvips est désactivé** dans l'enfant : il retenait chaque
    décodage (20 décodages d'un GIF 6000×6600 : ~3 070 Mo résidents, ~47 Mo
    cache coupé, mesuré sous Windows) ;
  - **un budget de 160 Mo décodés**, lu dans l'en-tête (`metadata()`, rien
    n'est décodé) : largeur × hauteur × canaux × octets par échantillon, soit le
    raster que le plafond de 40 Mpx admet déjà en RGBA 8 bits ; il ne refuse
    rien de ce que ce plafond admet en 8 bits et ne contraint que la haute
    profondeur et les canaux nombreux. TIFF : seulement `uchar`/`ushort`, 4
    canaux au plus. **Non calibré sur de vrais AVIF 10 bits de téléphone (non
    prouvé)** : éprouvé sur des fichiers synthétiques seulement ;
  - **l'optimiseur `/_next/image` est coupé** (`images.unoptimized: true` dans
    `next.config.ts`, gardé par `tests/next-config-images.test.ts`) : il est sans
    authentification et décodait avec le sharp de `next-server`, hors de l'enfant (donc
    hors délai, hors borne mémoire, hors file) ; sous `next start`, `/_next/image`
    répond 404. Son seul usage, `ClientAvatar`, rend déjà en `unoptimized` l'URL que
    Cloudinary a transformée. Deux verrous restent en second : aucun `remotePattern`,
    et `images.localPatterns` limité à `/_next/static/media/**` ;
  - **vérification dans l'image** (ce que ni `tsc`, ni les tests, ni `next build` ne
    voient) : `next-server` ne doit **jamais** avoir chargé sharp ni libvips —
    **0 correspondance `sharp`/`vips` dans `/proc/<pid>/maps` du processus
    `next-server`**, y compris après un envoi de photo (c'est l'enfant qui les
    charge). Vérifié sur des images construites depuis `23009bc`, `51b9d10` et `27e004e`. **En production à `0b2e320`** (sondé sans SSH le 2026-11-27 : `/api/health` rend `version` `0b2e320` et `imageDecoder` `ready`, `/_next/image` répond 404) ; et, par SSH le 2026-11-28 dans le conteneur de production à `0b2e320` : **0** correspondance `sharp`/`vips` dans les `maps` de `next-server`, l'enfant de décodage seul les charge ; à rejouer après tout
    changement de `next.config.ts` (`images`) ou de ce qui importe sharp ;
  - **sharp n'est importé que par le script enfant**, parmi les fichiers
    livrés : `tests/runtime-dependencies.test.ts` lit les scripts livrés depuis
    le Dockerfile et rougit si le serveur (ou tout autre fichier livré) importe
    sharp, ou si le `COPY` du script disparaît. Ce scanner **échoue fermé** : tout
    `require`, `import()`, `module.require` ou appel d'une fonction issue de
    `createRequire` dont l'argument n'est pas un littéral de chaîne fait rougir le
    test (un scanner qui ne sait pas dire ce qui est chargé n'est pas vert). Il ne
    **énumère pas** les formes dangereuses (une énumération en laissait passer onze :
    `const r = require`, `require.call`, `(0, require)`, `globalThis.require`,
    `process.mainModule.require`, `module.constructor._load`, `Module._load`,
    `createRequire` dans un objet, `new Function`, `process.dlopen`,
    `import x = require()`) : il liste la **seule forme sûre** — un appel direct à
    `require`, `import()` ou `module.require`, ou à une fonction liée à
    `createRequire(...)`, avec un littéral de chaîne — et rougit toute autre
    référence à `require` ou à `createRequire`, tout accès à `_load`, `dlopen`,
    `mainModule`, tout accès calculé sur `process`/`module`/`globalThis`, `Function`
    appelé ou construit, et `ImportEqualsDeclaration`. **Et il interdit des modules,
    pas des noms** (un nom s'esquive par un alias — `createRequire as cr` —, une
    déstructuration — `const { _load } = require("node:module")`,
    `const { dlopen } = process` — ou une clé calculée) : tout import (statique,
    dynamique ou `require`) de `module`, `vm`, `worker_threads` et `child_process`
    (avec ou sans `node:`) est rouge dans le code livré, ainsi que l'identifiant
    `eval` partout et `Reflect`/la déstructuration appliqués à `process`, `module` ou
    `globalThis` (sauf une clé qui est un symbole, `Symbol.for(...)`, comme les
    singletons du processus). **Une seule exception, écrite avec sa raison et la
    condition de sa disparition** : `lib/imageDecodeBridge.ts` pour `child_process`
    (il lance l'enfant) ; elle disparaît le jour où le décodeur tourne ailleurs
    (service ou conteneur séparé) et que le serveur ne lance plus de processus.
  **Calibrage du délai de 20 s, mesuré dans l'image de production** (2026-11-27,
  image de production d'avant ce lot — `c8230a3`, `sha256:1a2eac01…` —, node 22.23.5, sharp
  0.35.5 / libvips 8.18.7, sur le VPS ; méthode : `docker run --cpus=1
  --memory=1500m --network none`, chaque fichier décodé puis réencodé avec les
  options de l'application, d'abord dans un processus neuf, puis 4 passes dans
  un seul processus). Fichiers légitimes **aux plafonds réels** (5 Mo pour la
  photo d'entreprise, 10 Mo pour l'équipement et le bulletin) :

  | Fichier | Processus neuf | 4 passes |
  |---|---|---|
  | WebP 40 Mpx 10 Mo (6000×6600, q90), le pire cas | 6,8 s | 6,4 à 6,7 s |
  | WebP bruité 9,7 Mo (4700×3150) | 4,5 s | 4,4 à 5,4 s |
  | GIF 6000×6600 | 1,8 s | 1,9 à 2,6 s |
  | AVIF 12 bits au budget | 1,9 s | 1,7 à 2,1 s |
  | JPEG progressif 40 Mpx 10 Mo | 1,4 s | — |
  | JPEG de base 40 Mpx 10 Mo | 0,9 s | — |
  | PNG entrelacé 40 Mpx | 0,8 s | — |
  | TIFF deflate ou LZW 40 Mpx ≤ 5 Mo | 0,5 à 0,7 s | — |

  Pic de RSS cumulé : 754 Mo. **Dans la configuration livrée** (`concurrency(1)`,
  `ulimit -d` à 1 Go — **plus strict que les 1 536 Mo livrés** : ce qui passe sous
  1 Go passe sous 1 536 Mo —, même méthode, image construite depuis la branche de
  ce lot) tous les fichiers légitimes aux plafonds réels passent :

  | Fichier | Durée | Pic RSS | VmData |
  |---|---|---|---|
  | AVIF 12 bits au budget | 1,3 s | 710 Mo | 884 Mo |
  | GIF 6000×6600 | 1,6 s | 608 Mo | 700 Mo |
  | TIFF LZW 40 Mpx | 0,8 s | 330 Mo | — |
  | WebP 40 Mpx 10 Mo | 6,0 s | 424 Mo | 721 Mo |
  | PNG entrelacé 40 Mpx | 0,96 s | 218 Mo | — |

  Le WebP 40 Mpx est le pire cas légitime : **6,0 à 6,9 s** selon la mesure (6,9 s
  dans l'image par le vrai chemin), donc 20 s fait environ 2,9 fois ce pire cas. La
  limite de 1 536 Mo porte sur `VmData`, dont le plus haut mesuré est 884 Mo :
  marge de 1,74. À 1,5 Go, la bombe
  à 40 chunks `zTXt` s'arrête au bout de 9,8 s (pic 1 412 Mo) ; sans limite c'est
  l'OOM du conteneur.
  Une mesure plus tôt le même jour avait vu des premiers décodages plus lents
  d'environ 6 s, non reproduits ; attribution : le premier chargement d'une
  image fraîchement tirée, c'est-à-dire le premier décodage après un déploiement
  (c'est aussi pourquoi le démarrage de l'enfant a son délai à part). Les
  anciens fichiers de calibrage (WebP de 16 Mo, JPEG de 24 Mo) dépassent tous
  les plafonds réels : ils ne figurent plus. **Les deux contournements qui ont
  motivé le processus enfant**, rejoués dans la même image avec un délai porté à
  300 s pour voir la durée naturelle : JPEG progressif CMYK de 3 529 balayages
  (525 Ko) 33,5 s, le même en 3 composantes (394 Ko) 24,8 s, TIFF de 100 pages ×
  4 000 étiquettes (4,8 Mo) 49,0 s — tous réussissaient ; à 20 s ils sont tués,
  et le JS les refuse avant même de démarrer quoi que ce soit.
  **Mesures de ce lot (Windows, développement)** : le refus JS du JPEG de
  l'audit prend ~1,5 ms ; le pire parcours JPEG (10 Mo de `FF 00`) ~17 ms ; le
  pire parcours WebP, 10 Mo de chunks `JUNK` vides (1,25 million), 8 à 15 ms
  après le passage au mot de 32 bits (l'audit avait mesuré 112 à 137 ms avec
  la chaîne décodée par chunk ; la valeur « ~40 ms » publiée avant ne se
  reproduisait pas) ; `metadata()` sur des WebP animés de 2×2 : 1,8 ms à 1 000
  images, 130 ms à 10 000 (pas de quoi abaisser le plafond sous celui du GIF) ; ces mêmes deux
  attaques, passées directement à l'enfant, y prennent 27,7 s (JPEG) et 84 s
  (TIFF) ; un enfant tué à une échéance de 500 ms rend sa tâche refusée en
  514 ms et le processus a disparu au même instant (mesuré, Windows : l'arrêt
  est immédiat, la durée de l'attente d'un `SIGKILL` sous Linux n'a pas été
  mesurée dans ce lot).
  Le plafond de 40 Mpx borne ce qu'on alloue au pire mais pas ce qui passe
  juste en dessous : le pic par décodage mesuré dans l'image est de 609 Mo pour
  un GIF 6000×6600, 714 Mo pour un AVIF 12 bits au budget, 424 Mo pour un WebP
  bruité de 24 Mpx, 257 Mo pour un JPEG bruité de 24 Mpx — le budget borne le
  raster, pas le pic. Le « ~1,05 Go après la file » publié avant était la
  **rétention du cache**, pas une borne ; il n'y a plus de rétention (RSS
  revenue à ~75-150 Mo entre deux décodages).
  **Ouvert** : (1) **AVIF / HEIF en séquence (marque `avis`) et grilles HEIF
  non comptés** : sur un AVIF dont la marque est remplacée par `avis`, sharp
  0.35.5 répond « unsupported image format » en quelques ms, y compris dans
  l'image de production — ce refus vient de la **détection de format de libvips**
  (marque principale), pas de libheif ; pour un AVIF ordinaire il ne lit que
  l'image principale. Aucun vrai fichier de séquence ni de grille n'a été
  essayé ; ce que le JS ne compte pas, c'est le délai de 20 s qui le borne. Les
  sous-IFD EXIF d'un TIFF ne sont pas comptés non plus : même réponse. (2)
  **Plafonds d'entrée des téléversements** (fichiers de chantier 20 Mo, plans
  de réserve 25 Mo, photos 10 Mo) **non alignés** sur ce que le plan Cloudinary
  accepte (10 Mio, 25 Mpx) : un fichier de chantier de 15 Mo passe notre
  contrôle et reçoit l'échec générique du prestataire — décision produit en
  cours, rien n'a changé. (3) **Conteneur sans limite
  mémoire** : la borne mémoire de l'enfant n'existe que sous Linux (`ulimit -d`) et
  ne couvre pas le reste du conteneur. **Un décodage au-delà d'environ 100 Mo se
  déverse dans un fichier temporaire sans nom** (`O_TMPFILE` dans `/tmp`, mappé en
  partagé, invisible pour `ls`) : il est **hors de `RLIMIT_DATA`**, borné par le
  budget décodé, et libéré à la mort de l'enfant (rien ne reste après un kill). Il
  ne faut donc pas écrire que libvips n'écrit aucun fichier temporaire. (4)
  **Stockage non borné par compte sur les autres chemins d'envoi** (HEIC et BMP d'entreprise,
  fichiers de chantier, plans, photos de réserve : ils n'ont pas de part du décodeur, et rien ne
  borne ce qu'un compte y envoie) : lot séparé. **Courses de remplacement d'actif** (deux
  remplacements concurrents de la photo d'une entreprise, d'un équipement ou du logo) : des
  orphelins publics, jamais la destruction d'un actif vivant ; lot séparé. (5)
  **Isolation de l'enfant** : même uid que le serveur, `/app` inscriptible, lecture
  possible de `/proc/<ppid>/environ` (voir plus haut) — durcissement (`/app` en
  lecture seule, un autre uid) en **lot séparé, non fait**. Ce lot devra traiter
  `/tmp` : avec une racine en lecture seule **sans tmpfs**, le WebP légitime de 40
  Mpx est **refusé** (le déversement n'a nulle part où aller) ; avec
  `--tmpfs /tmp`, le déversement passe en RAM (`RssShmem`), hors de la limite. Il
  faudra dimensionner `/tmp` au-dessus du budget décodé et le compter dans la
  mémoire du conteneur. **`failOn: "none"`** : un JPEG
  tronqué (marqueur de fin absent, transfert interrompu) est décodé et
  nettoyé au lieu d'être refusé — Cloudinary l'acceptait avant ; un en-tête
  réellement corrompu reste refusé. Même comportement pour les quatre
  appelants, à dessein.
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
  **cinq fichiers et six `catch`** (`repository/{clients,equipmentLoans,
  jobFunctions,projectWorkers,users}.ts` ; `clients.ts` en compte deux,
  `create` et `update`, qui passent par le même prédicat) traitent donc
  tout P2002 de leur table comme **le seul unique qu'elle porte** — vrai
  aujourd'hui, faux le jour où une de ces tables gagne une seconde contrainte
  unique : ce jour-là, lire la structure de l'adaptateur (et l'épingler par
  un test), sinon un doublon sur la nouvelle contrainte sera annoncé comme un
  doublon sur l'ancienne. Compte relevé à `05e4b2c` (`fix/photo-entreprise`,
  base `fd719e2`) par `git grep -n "P2002" -- '*.ts' ':!tests*'
  ':!app/generated'`, en ne gardant que les lignes de code (les commentaires
  de `clients.ts` et `equipmentLoans.ts` citent aussi P2002) puis en
  comptant les sites d'appel du prédicat de `clients.ts`. **Seule
  l'hypothèse « un seul unique » de `Client` est épinglée par un test**
  (`tests-integration/client-duplicate-email.test.ts`, par `pg_indexes`) ;
  les quatre autres tables ne le sont pas. **Tables qui portent un unique sans
  aucun `catch` P2002** : `Reserve(projectId, number)`, `Contact.userId`,
  `PasswordResetToken.token` — un doublon y remonterait en erreur serveur
  générique ; à reprendre le jour où un chemin utilisateur peut les provoquer.
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
  (`data`, un littéral de champs nommés — § « Ce qu'une Server Action
  renvoie »), pas ce que le client croit avoir envoyé.
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
- **Messages et surcouches (#257)** : un seul hôte de messages, `TOAST_HOST_ID`
  (`components/toastHost`), rendu dans `app/layout.tsx` en `z-60` — le seul
  endroit où ce `z-index` s'écrit, au-dessus des modales en `z-50`.
  `components/Toast.tsx` s'y rend par portail, et chaque formulaire lui passe
  `result={state}` : un nouvel objet d'état est un nouveau résultat, même à
  texte identique (deuxième mauvais mot de passe). `components/Modal.tsx` et
  `components/ModalShell.tsx` passent par `components/BodyPortal.tsx`. Verrou :
  `tests/overlay-stacking.test.ts` (découvre les éléments `fixed` de `app/`,
  `components/`, `forms/` ; taille exacte : 6 surcouches plus l'hôte, comptées
  « à `e6efb9d` + ce changement » selon son en-tête, c'est-à-dire avec #257). ⚠️ **Le portail n'y est exigé que de `Modal` et `ModalShell`, nommés
  à la main** : `components/ScanDeliveryNoteModal.tsx`,
  `forms/EditInterventionForm.tsx`, `forms/EditMaterialForm.tsx` et
  `forms/EditTaskForm.tsx` ont leur propre `fixed inset-0 z-50` sans portail
  (vérifié à `0b2e320`), donc restent piégeables par un ancêtre empilé — à
  passer par `ModalShell`, puis exiger le portail de **toute** surcouche
  découverte au lieu d'une liste.
- **Un résultat que l'écran doit traiter autrement a son propre `type`** :
  `ApplyDeliveryScanActionState` porte `"warning"` (matériaux appliqués, archive
  non enregistrée), que `ScanDeliveryNoteModal` teste ; il était rendu
  `"success"` avec un autre texte, et la modale se fermait sans rien dire. Les
  redirections après une action se conditionnent à `state.type === "success"`
  (les six formulaires de `forms/` qui redirigent — ajout et modification
  d'entreprise, trois de projet, réinitialisation du mot de passe —, recensés
  par grep de `router.push` à `0b2e320`) ;
  `app/clients/[id]/_components/DeleteClientButton.tsx` redirige encore sur
  « tout sauf `error` » — sans défaut aujourd'hui, à resserrer si l'action gagne
  un autre type.

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
