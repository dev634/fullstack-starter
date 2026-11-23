import { LOCKED_CAPABILITIES, ROLES, ROLE_RANK, meetsRole, type Capability, type Role } from "@/lib/capabilities";
import { APP_AREA_CHILDREN, coversHiddenAreas, getAreaAncestors, type AppAreaKey } from "@/lib/appAreas";

/**
 * Who may touch which ACCOUNT — one pure source of truth, read by the server
 * actions (actions/users, which enforce) AND by the users screen
 * (which must stop offering what the action refuses). Client-safe: nothing
 * here imports the server.
 *
 * The rule (decided by the owner, 2026-11-22): everything that touches an
 * ADMIN or SUPERADMIN account goes through a SUPERADMIN. ADMINs keep their
 * full power over EDITOR, VIEWER and CLIENT accounts. Without it, a restricted
 * ADMIN (a job function that hides rubriques; an ADMIN is never restricted in
 * projects) could mint a free ADMIN — one with no function, so no restriction —
 * or take over another one.
 */

/** ADMIN and above: the accounts only a SUPERADMIN may create, change or remove. */
export function isPrivilegedRole(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.ADMIN;
}

/** The roles isPrivilegedRole accepts, as a list — for a query (`role: { in: PRIVILEGED_ROLES }`). */
export const PRIVILEGED_ROLES: Role[] = ROLES.filter(isPrivilegedRole);

/**
 * May `actorRole` give an account this role (creation, or a role change)?
 * SUPERADMIN: any role. Everyone else: never ADMIN or above, and never a role
 * above their own.
 */
export function canAssignRole(actorRole: Role, role: Role): boolean {
  if (actorRole === "SUPERADMIN") return true;
  return meetsRole(actorRole, role) && !isPrivilegedRole(role);
}

/**
 * The roles the role <select> may offer this actor. CLIENT is left out on
 * purpose: portal logins are provisioned from their contact, never picked
 * there (the screen already omits it).
 */
export function assignableRoles(actorRole: Role): Role[] {
  const offered: Role[] = ["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER"];
  return offered.filter((r) => canAssignRole(actorRole, r));
}

/**
 * May `actorRole` edit / delete / re-assign projects of an account whose
 * CURRENT role is `targetRole`?
 *
 * `isSelf` is true only for an actor editing THEIR OWN profile (name,
 * password): the single exception that lets an ADMIN touch an ADMIN account.
 * It widens nothing else — callers asking about deletion or project
 * assignment pass `false`. Changing one's own role is a separate refusal made
 * by actions/users::updateUser: this answers "may I touch this row", not
 * "may I turn it into that role" (that is `canAssignRole`).
 */
export function canManageAccount(actorRole: Role, targetRole: Role, isSelf: boolean): boolean {
  if (actorRole === "SUPERADMIN") return true;
  if (!meetsRole(actorRole, targetRole)) return false;
  if (isPrivilegedRole(targetRole)) return isSelf;
  return true;
}

/**
 * Is the account an actor is editing LOCKED against them, because it is their
 * own? A non-SUPERADMIN may change their own name and password, never their own
 * role nor their own job function: either would lift the restrictions the
 * function imposes, with no SUPERADMIN involved. SUPERADMIN is the escape
 * hatch. One source for the server (actions/users) and the screen.
 */
export function isOwnAccountLocked(actorRole: Role, isSelf: boolean): boolean {
  return isSelf && actorRole !== "SUPERADMIN";
}

/**
 * The actor, as far as the job-function restriction is concerned: their role and
 * the rubriques their OWN function hides (AccessContext.hiddenAreas).
 */
export type AccountActor = { role: string | undefined; hiddenAreas: ReadonlySet<AppAreaKey> };

/**
 * The rubrique each LOCKED capability (lib/capabilities.ts::LOCKED_CAPABILITIES)
 * guards — the pairing lib/adminAccess.ts::getAdminAccess applies tab by tab.
 * Exported so a test can prove no locked capability is missing from it: a new
 * locked capability without an entry here would silently count its rubrique as
 * reachable by an EDITOR.
 */
export const AREA_OF_LOCKED_CAPABILITY: Partial<Record<Capability, AppAreaKey>> = {
  "settings.manage": "admin.settings",
  "functions.manage": "admin.functions",
  "users.manage": "admin.users",
};

/** The rubriques guarded by a locked capability: no role below ADMIN ever reaches them. */
const LOCKED_AREAS: ReadonlySet<AppAreaKey> = new Set(
  LOCKED_CAPABILITIES.flatMap((capability) => AREA_OF_LOCKED_CAPABILITY[capability] ?? [])
);

/**
 * Is this rubrique out of reach of every role below ADMIN? A locked rubrique
 * is; so is a parent all of whose sub-parts are (`admin`).
 */
function isBeyondLowerRoles(key: AppAreaKey): boolean {
  if (LOCKED_AREAS.has(key)) return true;
  const children = APP_AREA_CHILDREN[key];
  return children.length > 0 && children.every(isBeyondLowerRoles);
}

/**
 * The actor's hidden rubriques that matter to the relay rule: the ones an
 * account BELOW ADMIN could reach. Hiding `admin.functions` only (say) hides
 * nothing a relay EDITOR/VIEWER could ever open, so it must neither make the
 * ADMIN "restricted" nor be demanded of the accounts they manage.
 * Valid only as long as those capabilities stay locked at ADMIN or above
 * (LOCKED_CAPABILITIES: resolveAccessConfig forces them back to their default,
 * whatever the stored matrix says). The day one is delegable, this filter
 * hides a real relay.
 */
export function relevantHiddenAreas(actor: AccountActor): AppAreaKey[] {
  return [...actor.hiddenAreas].filter((key) => !isBeyondLowerRoles(key));
}

/**
 * An ADMIN whose function hides at least one rubrique a lower role can reach.
 * The only axis an ADMIN is subject to (hiddenSections and the project scope
 * bypass ADMIN) — and the only actor the relay rules below apply to. SUPERADMIN
 * is the escape hatch; an ADMIN whose function hides nothing relevant has
 * nothing to be relayed around.
 */
export function isRestrictedAdmin(actor: AccountActor): boolean {
  return actor.role === "ADMIN" && relevantHiddenAreas(actor).length > 0;
}

/** The keys among `keys` that a function hiding `hidden` covers (itself, or an ancestor of it, is hidden). */
function coveredKeys(hidden: readonly AppAreaKey[], keys: readonly AppAreaKey[]): AppAreaKey[] {
  return keys.filter((key) => coversHiddenAreas(hidden, [key]));
}

/**
 * "Compte relais": a restricted ADMIN who creates or takes over an account
 * whose function hides LESS than theirs (or has none) can then sign in as it
 * and see what their own function hides. So a restricted actor manages an
 * account only if the function it holds covers what the actor's hides
 * (`coversHiddenAreas`) — checked BEFORE the operation (the account as it
 * stands: you do not take over one that already sees more) and, for a creation
 * or a change, AFTER (the function it would end up with).
 *
 * `functionHiddenAreas` is the hiddenAreas of the account's function, `[]` for
 * an account with no function. Everyone but a restricted ADMIN: always true.
 */
export function mayManageAccountWithFunction(actor: AccountActor, functionHiddenAreas: readonly AppAreaKey[]): boolean {
  return !isRestrictedAdmin(actor) || coversHiddenAreas(functionHiddenAreas, relevantHiddenAreas(actor));
}

/**
 * Same lever, from the function's side, and MONOTONE: a function nobody holds
 * constrains nobody (free; assigning it goes through
 * mayManageAccountWithFunction). A HELD function, for a restricted ADMIN, may be
 * reconfigured as long as it does not newly reveal anything: every rubrique of
 * the actor's that `current` already covered, `next` must still cover. One that
 * `current` did not cover is already seen by its holders — touching the
 * function changes nothing for it. `next === null` is a deletion
 * (onDelete: SetNull detaches every holder, who then see everything): refused
 * if the function covered at least one of the actor's rubriques.
 */
export function mayChangeHeldFunction(
  actor: AccountActor,
  current: readonly AppAreaKey[],
  next: readonly AppAreaKey[] | null
): boolean;
/**
 * @deprecated The pre-monotone absolute form, kept ONLY so the functions screen
 * (a client component, not rewired yet) still compiles: it demands that the
 * function cover the actor's rubriques after the write. Remove with that
 * screen's switch to the server-computed locks (heldFunctionLocks).
 */
export function mayChangeHeldFunction(actor: AccountActor, resulting: readonly AppAreaKey[] | null): boolean;
export function mayChangeHeldFunction(
  actor: AccountActor,
  currentOrResulting: readonly AppAreaKey[] | null,
  next?: readonly AppAreaKey[] | null
): boolean {
  if (!isRestrictedAdmin(actor)) return true;
  const relevant = relevantHiddenAreas(actor);
  if (next === undefined) {
    return currentOrResulting !== null && coversHiddenAreas(currentOrResulting, relevant);
  }
  const before = coveredKeys(currentOrResulting ?? [], relevant);
  const after = next === null ? [] : coveredKeys(next, relevant);
  return before.every((key) => after.includes(key));
}

/**
 * What the functions screen needs, computed on the server with the same rule
 * the actions enforce (mayChangeHeldFunction) — never rebuilt client-side from
 * a fake actor. For a restricted ADMIN and each HELD function (a function
 * nobody holds is free): `deleteLockedIds` — the ones they may not delete — and
 * `lockedAreasByFunctionId` — their own rubriques the function covers and can
 * therefore no longer be made to reveal. Everyone else: nothing is locked.
 */
export function heldFunctionLocks(
  actor: AccountActor,
  functions: readonly { id: number; hiddenAreas: readonly AppAreaKey[] }[],
  heldFunctionIds: readonly number[]
): { deleteLockedIds: number[]; lockedAreasByFunctionId: Record<number, AppAreaKey[]> } {
  const out: { deleteLockedIds: number[]; lockedAreasByFunctionId: Record<number, AppAreaKey[]> } = {
    deleteLockedIds: [],
    lockedAreasByFunctionId: {},
  };
  if (!isRestrictedAdmin(actor)) return out;
  const held = new Set(heldFunctionIds);
  const relevant = relevantHiddenAreas(actor);
  for (const fn of functions) {
    if (!held.has(fn.id)) continue;
    out.lockedAreasByFunctionId[fn.id] = coveredKeys(fn.hiddenAreas, relevant);
    if (!mayChangeHeldFunction(actor, fn.hiddenAreas, null)) out.deleteLockedIds.push(fn.id);
  }
  return out;
}

/**
 * What a client-portal login shows (app/portail/** at the commit that wrote
 * this): the linked projects — name, type, status, business number, power,
 * address, dates, company name — their task progress and their réserves
 * (read-only). All of it is the content of the `projects` rubrique. Budget and
 * notes are deliberately not shown; nothing of `clients`, `loans`, `dashboard`
 * or `admin`. A new portal page that shows another rubrique's data adds its key
 * here.
 */
export const PORTAL_EXPOSED_AREAS: readonly AppAreaKey[] = ["projects"];

/**
 * May this actor provision a portal login? A restricted ADMIN who hides what
 * the portal shows could link the projects to a contact, create the login (the
 * reset link is handed back to them), sign in as that CLIENT and read what
 * their own function hides: the portal is a relay, like an account without a
 * function. Overlap goes both ways (a hidden parent, or a hidden sub-part, of
 * an exposed rubrique).
 */
export function mayProvisionPortalLogin(actor: AccountActor): boolean {
  if (!isRestrictedAdmin(actor)) return true;
  const overlaps = (a: AppAreaKey, b: AppAreaKey) => a === b || getAreaAncestors(a).includes(b) || getAreaAncestors(b).includes(a);
  return !relevantHiddenAreas(actor).some((hidden) => PORTAL_EXPOSED_AREAS.some((exposed) => overlaps(hidden, exposed)));
}

/**
 * The job functions this actor may ASSIGN to an account (creation / change):
 * all of them, unless the actor is a restricted ADMIN — then only those that
 * cover their rubriques. The "no function" option is never offered to a
 * restricted actor (see `mayManageAccountWithFunction`, `[]`).
 */
export function assignableFunctionIds(
  actor: AccountActor,
  functions: readonly { id: number; hiddenAreas: readonly AppAreaKey[] }[]
): number[] {
  return functions.filter((f) => mayManageAccountWithFunction(actor, f.hiddenAreas)).map((f) => f.id);
}

/**
 * The accounts this actor may NOT manage (edit, delete, assign projects),
 * given each account's function id and the hiddenAreas of every function.
 */
export function unmanageableAccountIds(
  actor: AccountActor,
  accounts: readonly { id: number; jobFunctionId: number | null }[],
  functions: readonly { id: number; hiddenAreas: readonly AppAreaKey[] }[]
): number[] {
  const hiddenById = new Map(functions.map((f) => [f.id, f.hiddenAreas]));
  return accounts
    .filter((a) => !mayManageAccountWithFunction(actor, (a.jobFunctionId === null ? undefined : hiddenById.get(a.jobFunctionId)) ?? []))
    .map((a) => a.id);
}
