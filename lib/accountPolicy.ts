import { ROLE_RANK, meetsRole, type Role } from "@/lib/capabilities";

/**
 * Who may touch which ACCOUNT — one pure source of truth, read by the server
 * actions (actions/users, which enforce) AND, later, by the users screen
 * (which must stop offering what the action refuses). Client-safe: nothing
 * here imports the server.
 *
 * The rule (decided by the owner, 2026-11-22): everything that touches an
 * ADMIN or SUPERADMIN account goes through a SUPERADMIN. ADMINs keep their
 * full power over EDITOR, VIEWER and CLIENT accounts. Without it, a restricted
 * ADMIN (a job function that hides areas / limits projects) could mint a free
 * ADMIN — one with no function, so no restriction — or take over another one.
 */

/** ADMIN and above: the accounts only a SUPERADMIN may create, change or remove. */
export function isPrivilegedRole(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.ADMIN;
}

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
