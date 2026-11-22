import { getAppSettings } from "@/lib/appSettings";
import { requireRole, hasMinRole, type RoleCheckResult } from "@/lib/authz";
import { resolveAccessConfig, type Capability, type Role } from "@/lib/capabilities";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { hasProjectAmong } from "@/repository/projects";
import { isFullyInScope, findFullyInScopeIds } from "@/repository/clients";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * The resolved capability → minimum-role map (stored matrix merged over the
 * defaults). Cached with app settings, so a change to the matrix busts it via
 * the same tag (see actions/appSettings).
 */
export async function getAccessConfig(): Promise<Record<Capability, Role>> {
  const settings = await getAppSettings();
  return resolveAccessConfig((settings as { accessConfig?: unknown }).accessConfig);
}

/** Guard a server action behind a configurable capability (see the matrix). */
export async function requireCapability(cap: Capability): Promise<RoleCheckResult> {
  const config = await getAccessConfig();
  return requireRole(config[cap]);
}

/** Page-level branching: does the current role satisfy the capability? */
export async function can(role: string | undefined, cap: Capability): Promise<boolean> {
  const config = await getAccessConfig();
  return hasMinRole(role, config[cap]);
}

export type ScopeCheckResult = { error: { type: "error"; message: string } | null };

/**
 * Guard a server action behind the caller's project scope (the DATA axis —
 * see lib/accessContext.ts). This is the third, separate question from role
 * (requireCapability) and section (requireSectionAccess): may this caller
 * touch THIS project at all.
 *
 * Still run after a role/session gate, for defense in depth and because the
 * error message a bare role/session failure should give is more specific
 * than "forbidden" — but `getAccessContext()` no longer treats "no session"
 * as "unrestricted" (lib/accessContext.ts, lib/sessionGate.ts): an absent or
 * unverifiable session now resolves to DENIED, so calling this alone, first,
 * would refuse an anonymous caller rather than let them through. ADMIN+
 * still never locks itself out — SUPERADMIN bypasses this axis entirely, and
 * ADMIN keeps unrestricted projectIds once its own account resolves.
 *
 * `projectId` must be the resource's REAL project, resolved from the
 * database — never a client-supplied form field taken at face value. A
 * caller assigned to project A can always claim `projectId=A` while
 * targeting a row that actually belongs to project B by id; the check only
 * means something when it runs against the id the mutation is really about.
 */
export async function requireProjectAccess(projectId: number): Promise<ScopeCheckResult> {
  const ctx = await getAccessContext();
  if (canReachProject(ctx, projectId)) return { error: null };
  const t = getDictionary(await getLocale());
  return { error: { type: "error", message: t.errors.forbidden } };
}

/**
 * Guard a server action behind the caller's project scope, for an action
 * keyed by client id rather than project id (the client record itself, or
 * creating a new project under it). A client is reachable when the caller is
 * unrestricted, or holds at least one non-trashed project under it — the
 * same reachability rule already used to filter the client list/export
 * (repository/clients.ts::search).
 */
export async function requireClientAccess(clientId: number): Promise<ScopeCheckResult> {
  const ctx = await getAccessContext();
  if (ctx.projectIds === null) return { error: null };
  const reachable = await hasProjectAmong(clientId, [...ctx.projectIds]);
  if (reachable) return { error: null };
  const t = getDictionary(await getLocale());
  return { error: { type: "error", message: t.errors.forbidden } };
}

/**
 * Non-throwing core of requireFullClientAccess, also what the interface asks
 * before offering a whole-company action (trash, restore, permanent delete).
 *
 * requireClientAccess answers "may I reach this company" (at least one live
 * project in scope). An action that acts on the company ENTIRELY takes ALL
 * its projects with it — trashed ones included — so it needs a stronger
 * answer: every project of the company is in the caller's scope. An
 * unrestricted caller passes; a restricted one must also still reach the
 * company (a company with no project at all stays unreachable, as before).
 */
export async function canFullyAccessClient(clientId: number): Promise<boolean> {
  const ctx = await getAccessContext();
  if (ctx.projectIds === null) return true;
  return isFullyInScope(clientId, [...ctx.projectIds]);
}

/**
 * The same rule over a list: of these company ids, the ones the caller may act
 * on ENTIRELY. One query for the whole list — for the bulk action, and for the
 * list screen that decides which cards get a delete box (a box the action then
 * refuses would be a dead control).
 */
export async function fullyAccessibleClientIds(clientIds: number[]): Promise<number[]> {
  const ctx = await getAccessContext();
  if (ctx.projectIds === null) return clientIds;
  return findFullyInScopeIds(clientIds, [...ctx.projectIds]);
}

/** Guard an action that takes the WHOLE company (every project) with it. Same refusal message as requireClientAccess. */
export async function requireFullClientAccess(clientId: number): Promise<ScopeCheckResult> {
  if (await canFullyAccessClient(clientId)) return { error: null };
  const t = getDictionary(await getLocale());
  return { error: { type: "error", message: t.errors.forbidden } };
}
