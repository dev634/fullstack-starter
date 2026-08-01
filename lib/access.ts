import { getAppSettings } from "@/lib/appSettings";
import { requireRole, hasMinRole, type RoleCheckResult } from "@/lib/authz";
import { resolveAccessConfig, type Capability, type Role } from "@/lib/capabilities";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { hasProjectAmong } from "@/repository/projects";
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
 * Must run after a role/session gate. `getAccessContext()` treats "no
 * session" the same as "unrestricted" (see lib/accessContext.ts — it exists
 * so ADMIN+ never locks itself out), so calling this alone, first, would let
 * an anonymous caller through.
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
