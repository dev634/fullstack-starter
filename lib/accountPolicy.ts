import { ROLES, ROLE_RANK, meetsRole, type Role } from "@/lib/capabilities";
import { coversHiddenAreas, type AppAreaKey } from "@/lib/appAreas";

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
 * An ADMIN whose function hides at least one rubrique. The only axis an ADMIN
 * is subject to (hiddenSections and the project scope bypass ADMIN) — and the
 * only actor the relay rules below apply to. SUPERADMIN is the escape hatch;
 * an ADMIN whose function hides nothing has nothing to be relayed around.
 */
export function isRestrictedAdmin(actor: AccountActor): boolean {
  return actor.role === "ADMIN" && actor.hiddenAreas.size > 0;
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
  return !isRestrictedAdmin(actor) || coversHiddenAreas(functionHiddenAreas, actor.hiddenAreas);
}

/**
 * Same lever, from the function's side. A function nobody holds constrains
 * nobody: free (assigning it goes through mayManageAccountWithFunction). A HELD
 * function, for a restricted ADMIN, may only be reconfigured so that it still
 * covers their rubriques (`resultingHiddenAreas`), and may not be deleted at
 * all (`null`): deleting it detaches every holder (onDelete: SetNull) and
 * leaves them with no restriction.
 */
export function mayChangeHeldFunction(actor: AccountActor, resultingHiddenAreas: readonly AppAreaKey[] | null): boolean {
  if (!isRestrictedAdmin(actor)) return true;
  return resultingHiddenAreas !== null && coversHiddenAreas(resultingHiddenAreas, actor.hiddenAreas);
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
