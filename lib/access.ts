import { getAppSettings } from "@/lib/appSettings";
import { requireRole, hasMinRole, type RoleCheckResult } from "@/lib/authz";
import { resolveAccessConfig, type Capability, type Role } from "@/lib/capabilities";
import { getAccessContext, canReachProject, type AccessContext } from "@/lib/accessContext";
import { hasProjectAmong, findTrashState as findProjectTrashState } from "@/repository/projects";
import { isFullyInScope, findFullyInScopeIds, findTrashState as findClientTrashState } from "@/repository/clients";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ScopeCheckResult, ScopeRefusal } from "@/lib/scopeRefusal";

export type { ScopeCheckResult } from "@/lib/scopeRefusal";

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

/**
 * A scope refusal, with its message read lazily: the dictionary (and the
 * locale behind it) is only resolved on the refusing path, as it always was.
 * Carries a typed `reason` (lib/scopeRefusal.ts) next to the message.
 */
async function refuse(
  reason: ScopeRefusal,
  pick: (t: ReturnType<typeof getDictionary>) => string
): Promise<ScopeCheckResult> {
  const t = getDictionary(await getLocale());
  return { error: { type: "error", message: pick(t) }, reason };
}

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
  if (!canReachProject(ctx, projectId)) return refuse("forbidden", (t) => t.errors.forbidden);
  // Scope alone says "this caller may touch this project", not "this project
  // is still there to be edited". The content of a project in the trash — or
  // of a live project under a company in the trash (trashing a company does
  // not cascade to its projects) — stays frozen until it is restored. This
  // name keeps the safe meaning: an action that calls it refuses the trash
  // without having to think about it. The one pair that must act ON a trashed
  // project (restore, permanent delete) calls requireTrashedProjectAccess.
  const state = await findProjectTrashState(projectId);
  if (!state) return refuse("absent", (t) => t.projects.messages.invalidId);
  // The project itself is trashed: the trash of projects is where it is
  // restored. A live project under a trashed COMPANY is not in that trash —
  // sending the caller there would be a dead end — so it answers with the
  // company-side message.
  if (state.selfTrashed) return refuse("inTrash", (t) => t.errors.inTrash);
  if (state.inTrash) return refuse("parentInTrash", (t) => t.errors.parentInTrash);
  return { error: null };
}

/**
 * The inverse of requireProjectAccess, for the two actions that act ON a
 * trashed project: restoreProject and permanentlyDeleteProject (and nothing
 * else — tests/authz-coverage.test.ts pins it). Scope first, then the project
 * must exist AND be in the trash itself. A live project and an unknown one
 * answer the same (the project-scoped invalidId), so the response says nothing
 * about which of the two an id was.
 *
 * `purpose` is required (no default, so a new caller has to choose): restoring
 * a project whose COMPANY is in the trash is refused (parentInTrash) — it would
 * leave the trash of projects yet stay invisible and frozen under the company,
 * so the company is restored first. Destroying it for good has no such
 * dependency.
 */
export async function requireTrashedProjectAccess(
  projectId: number,
  purpose: "restore" | "destroy"
): Promise<ScopeCheckResult> {
  const ctx = await getAccessContext();
  if (!canReachProject(ctx, projectId)) return refuse("forbidden", (t) => t.errors.forbidden);
  const state = await findProjectTrashState(projectId);
  if (!state || !state.selfTrashed) return refuse("absent", (t) => t.projects.messages.invalidId);
  if (purpose === "restore" && state.parentTrashed) return refuse("parentInTrash", (t) => t.errors.parentInTrash);
  return { error: null };
}

/**
 * Guard a server action behind the caller's project scope, for an action
 * keyed by client id rather than project id (the client record itself, or
 * creating a new project under it). A client is reachable when the caller is
 * unrestricted, or holds at least one non-trashed project under it — the
 * same reachability rule already used to filter the client list/export
 * (repository/clients.ts::search) — and, on top of reachability, a company in
 * the trash is refused (inTrash): it must be restored to be edited.
 */
export async function requireClientAccess(
  clientId: number,
  /** The caller's access context when it has already been read (see requireClientAccessWithin for why). */
  resolvedCtx?: AccessContext
): Promise<ScopeCheckResult> {
  return guardClientAccess(resolvedCtx ?? (await getAccessContext()), clientId, () => findClientTrashState(clientId));
}

/**
 * requireClientAccess for a caller that has ALREADY read both inputs: the
 * access context (once, outside a loop) and the company row (`id` and
 * `deletedAt`, e.g. from findByEmail). Same rule — it is the same function
 * underneath — without re-reading either per row. A restricted caller still
 * costs one reachability query (hasProjectAmong); an unrestricted one none.
 */
export async function requireClientAccessWithin(
  ctx: AccessContext,
  client: { id: number; deletedAt: Date | null }
): Promise<ScopeCheckResult> {
  return guardClientAccess(ctx, client.id, async () => ({ inTrash: client.deletedAt !== null }));
}

async function guardClientAccess(
  ctx: AccessContext,
  clientId: number,
  readState: () => Promise<{ inTrash: boolean } | null>
): Promise<ScopeCheckResult> {
  if (ctx.projectIds !== null && !(await hasProjectAmong(clientId, [...ctx.projectIds]))) {
    return refuse("forbidden", (t) => t.errors.forbidden);
  }
  // Reachable is not enough: the company must also exist and be live. Every
  // action behind this guard WRITES to the company or under it (edit, contacts,
  // portal login, new project, imports); none of them has a reason to act on
  // one in the trash. The whole-company actions that do (trash, restore,
  // permanent delete) go through requireFullClientAccess below instead.
  const state = await readState();
  if (!state) return refuse("absent", (t) => t.errors.invalidId);
  if (state.inTrash) return refuse("inTrash", (t) => t.errors.inTrash);
  return { error: null };
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
  return refuse("forbidden", (t) => t.errors.forbidden);
}
