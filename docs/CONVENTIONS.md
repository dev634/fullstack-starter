# Conventions observées du projet

Carte des patterns récurrents, pour éviter de les re-dériver à chaque feature.
**C'est une carte, pas une spécification** : elle décrit ce que le code fait
aujourd'hui. Vérifie contre le code avant de t'appuyer dessus, et corrige ce
fichier s'il a dérivé.

## Modèle d'accès — trois axes orthogonaux

Ne jamais les croiser en matrice.

| Axe | Ce qu'il décide | Où |
|---|---|---|
| **Rôle** (capability) | ce qu'on a le droit de *faire* (lire / écrire) | `requireCapability` — `lib/access.ts`, `lib/capabilities.ts` |
| **Fonction → sections** | quelles sections d'un projet existent pour toi | `requireSectionAccess` — `lib/sectionAccess.ts` |
| **Fonction → rubriques** | quelles rubriques de l'app existent pour toi | `requireAreaAccess` / `canAccessArea` — `lib/areaAccess.ts` |
| **Fonction → projets** | quels projets tu peux atteindre | `requireProjectAccess` — `lib/accessContext.ts` |

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
mais une trentaine — en réalité **41** — de mutations dans `actions/tasks`,
`actions/taskGroups`, `actions/taskCategories`, `actions/taskAssignee`,
`actions/projectMaterials`, `actions/projectFiles`, `actions/reserves`,
`actions/interventions`, `actions/interims`, `actions/subcontractors` et
`actions/deliveryNoteScan` n'avaient que `requireSectionAccess`, jamais
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

**Personne ne modifie la contrainte qui le contraint.** ⚠️ Cette section
affirmait « deux leviers » alors qu'il y en avait (au moins) **trois** — c'est
la passe adverse EDITOR (lot C1, #2) qui a trouvé le troisième, resté invisible
à la première revue. Trois leviers permettaient à un ADMIN de lever sur
lui-même les restrictions de sa fonction : éditer cette fonction
(`setFunctionAreas`), repointer son propre compte vers une autre
(`updateUser`), ou **supprimer sa propre fonction** (`deleteJobFunction` —
`onDelete: SetNull` sur `User.jobFunctionId` vide la contrainte aussi sûrement
que l'éditer). Les trois sont fermés, sortie de secours **SUPERADMIN** (qui
n'est de toute façon pas soumis à `hiddenAreas`). Fermer un levier sans les
autres n'aurait rien fermé — d'où la consigne : **énumérer tous les chemins qui
détachent un utilisateur de sa fonction, ou qui vident les restrictions d'une
fonction** (suppression, y compris en masse ou via import — aucune des deux
n'existe aujourd'hui pour `JobFunction`/`User`, vérifié par grep) avant de se
déclarer fermé.

`LOCKED_CAPABILITIES` (`lib/capabilities.ts`) = `settings.manage`,
`functions.manage`, `users.manage` : **non délégables par la matrice de rôles**,
puisqu'elles configurent le modèle d'accès lui-même. Une capacité qui donne le
pouvoir de changer les capacités rejoint cette liste.

`tests/authz-coverage.test.ts` échoue si une fonction exportée de
`actions/{clients,projects,contacts}` saute `requireAreaAccess` — **lectures
comprises depuis PR #187**. Il portait auparavant un `READS = new Set([...])`
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

## Validation — primitives partagées, à réutiliser

Ne pas réinventer un plafond ni une détection : ces deux modules existent, et
c'est leur duplication partielle qui a produit les défauts de PR #187.

- **Plafonds de texte** : `schemas/fields.ts` (`MAX_NAME_LENGTH`,
  `MAX_NOTE_LENGTH`, `MAX_CODE_LENGTH`, `MAX_EMAIL_LENGTH`…). Un palier **par
  usage**, pas un nombre par champ. Avant, aucun `z.string().min(1)` de l'app
  n'avait de borne haute : une série de tâches amplifiait une requête de 200 Ko
  en ~40 Mo écrits en base.
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
  pas une largesse ajoutée ici). Les cinq chemins d'upload y passent
  maintenant. **HEIC/AVIF/BMP/TIFF sont explicitement couverts** : le HEIC est le
  format par défaut des iPhone, et les réserves se photographient au téléphone.
  Resserrer cette détection sans le vérifier casse le chemin le plus utilisé.
- Une coercition écrite à la main (`Number(v)` puis `refine`) laisse passer
  `Infinity` ; une date non validée laisse écrire `+275760-09-12`, que Prisma
  relit en `Invalid Date` et qui a rendu `/projects/export` en 500 **pour tout
  le monde, définitivement**. Une donnée d'entrée qui casse une lecture globale
  se corrige **des deux côtés** : validation à l'entrée, et lecture tolérante à
  une ligne déjà corrompue en base.

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
- `lib/color.ts::contrastTextColor` (luminance WCAG) — même fonction pour le HTML
  et pour le PDF (`lib/reservesReport.ts`), pour que les deux ne divergent pas.
  ⚠️ Elle a un appelant **hors réserves** : le bouton des e-mails transactionnels.
  Les e-mails ne sont pas sous CSP et leur couleur est un choix de marque : y
  toucher est une PR à part.

Le mode d'échec d'un attribut `style` n'est pas franc : sur un composant
**client**, React réapplique la propriété par le CSSOM après hydratation — donc
« ça marche après un clic » et pas au chargement ; sur un composant **serveur**,
rien ne s'affiche jamais. Il reste **8 attributs `style` dans 5 fichiers**
(`ClientAvatar`, positions des pastilles de `ReservesSection`, aperçu
d'`AppSettingsForm`, transformes dnd-kit de `SectionOrderForm` et
`JobFunctionsManager`), tous des composants client : violations en console plus
un état pré-hydratation faux. Ne pas en ajouter.

Une couleur interpolée dans un `<style>` est validée **trois fois** : Zod à
l'écriture (`hexColor`), `CHECK` en base, et `safeHex` juste avant
l'interpolation (`app/layout.tsx` et `ReserveStatusStyleVars`). Les ancres du
`CHECK` portent la sécurité : `~` en PostgreSQL est une correspondance **non
ancrée**, sans `^…$` la valeur `#000000; background:url(https://evil/)` passe.

## Sections repliables (page projet)

`components/CollapsibleSection.tsx` rend `{open && children}` : **quand la
section est repliée, ses enfants ne sont pas montés du tout.** Conséquence pour
tout état dérivé d'un signal : le composant enfant peut se monter **après** que
le signal a été émis — il doit donc lire le signal *à son montage*, pas
seulement à son changement. Ignorer ça produit une feature qui compile, passe
les tests, et ne marche pas.

Le composant accepte soit `open` **et** `onOpenChange` (mode contrôlé), soit
aucun des deux — le type l'impose.

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

## Modèles de personnes

`Contact`, `Interim`, `SubcontractorPerson` portent tous un `jobFunctionId`
(FK vers `JobFunction`, `onDelete: SetNull`) — plus aucun `role` en texte libre.
Le `<select>` partagé est `forms/JobFunctionOptions.tsx` ; les options viennent
de `repository/jobFunctions.findAllOptions()` qui ne projette que `{id, name}`
(ne jamais sérialiser la ligne complète vers le client : elle porte la posture
d'accès). L'écran d'admin, lui, a besoin de la ligne complète (`findAll`).

Ajouter un axe similaire à un nouveau modèle = **copier ce miroir**, pas
réinventer.
