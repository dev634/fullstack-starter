import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { findAccessScopeByEmail, type AccessScope } from "@/repository/users";
import { PROJECT_SECTION_KEYS, isProjectSectionKey, type ProjectSectionKey } from "@/lib/projectSections";
import { APP_AREA_KEYS, normalizeHiddenAreas, type AppAreaKey } from "@/lib/appAreas";

/**
 * Everything that decides what the current user may reach, resolved once.
 *
 * The app has two access axes and they answer different questions:
 *   - `hiddenSections`/`hiddenAreas` — which FEATURES exist for you (job function);
 *   - `projectIds`                  — which DATA exists for you (job function + assignments).
 * The role, handled by the capability matrix, is the third and separate
 * question of read vs write.
 *
 * Resolved in one place on purpose. Scattering these lookups is how an app ends
 * up unable to answer "why does this person see that?", and how one surface
 * quietly forgets to filter — which is exactly what happened when section
 * visibility lived only in the project page's render.
 */
export type AccessContext = {
  email: string | null;
  role: string | undefined;
  /** Project-detail sections this user may not touch. Empty for ADMIN+. */
  hiddenSections: Set<ProjectSectionKey>;
  /**
   * Top-level app rubriques this user may not reach. Empty for SUPERADMIN
   * only — unlike `hiddenSections`, ADMIN is NOT exempt here: an ADMIN's own
   * job function can still hide rubriques from them (see lib/areaAccess.ts
   * for why the bypass rule deliberately differs).
   */
  hiddenAreas: Set<AppAreaKey>;
  /**
   * Projects this user may reach, or `null` for "no restriction".
   *
   * `null` and an empty Set mean opposite things — unrestricted versus
   * assigned to nothing — so callers must branch on `null` explicitly rather
   * than treating a falsy value as "everything".
   */
  projectIds: Set<number> | null;
};

const UNRESTRICTED: Omit<AccessContext, "email" | "role"> = {
  hiddenSections: new Set<ProjectSectionKey>(),
  hiddenAreas: new Set<AppAreaKey>(),
  projectIds: null,
};

/**
 * Every section and area key hidden, no project reachable — what an absent
 * or unverifiable caller resolves to. Used to read "anonymous = unrestricted"
 * here, exactly backwards: a caller with no session, or whose session's
 * account lib/sessionGate.ts can no longer verify (deleted mid-session — see
 * its own doc on why that race survives the JWT-level gate), must see and
 * reach NOTHING, not everything.
 *
 * Builds fresh Sets on every call on purpose — unlike UNRESTRICTED above,
 * never share one mutable Set across callers who might (today, none do;
 * verified by grep) come to rely on mutating what they were handed.
 * `projectIds` is an empty Set, never `null` — `null` means "every project",
 * the one thing DENIED must not say.
 */
function deniedScope(): Omit<AccessContext, "email" | "role"> {
  return {
    hiddenSections: new Set(PROJECT_SECTION_KEYS),
    hiddenAreas: new Set(APP_AREA_KEYS),
    projectIds: new Set<number>(),
  };
}

function resolveHiddenAreas(scope: AccessScope | null): Set<AppAreaKey> {
  return new Set(normalizeHiddenAreas(scope?.hiddenAreas));
}

export async function getAccessContext(): Promise<AccessContext> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const role = session?.user?.role;

  // No email at all: a truly anonymous caller, or a session lib/sessionGate.ts
  // has already voided because its account is gone. DENIED, resolved with no
  // database round trip — there is no row to look up.
  if (!email) return { email, role, ...deniedScope() };

  // SUPERADMIN bypasses every axis, including hiddenAreas, WITHOUT a scope
  // lookup. Restricting the people who configure the restrictions is how you
  // end up locked out of your own instance. Its existence is vouched for by
  // lib/sessionGate.ts (the JWT is refused the moment the account vanishes),
  // not by anything checked here.
  if (hasMinRole(role, "SUPERADMIN")) {
    return { email, role, ...UNRESTRICTED };
  }

  const scope = await findAccessScopeByEmail(email);

  // No row for this email — the race lib/sessionGate.ts's own per-request
  // cache cannot always catch (a row deleted BETWEEN two requests, not
  // within the one that already verified it). DENIED, for ADMIN exactly like
  // every role below it — the lookup runs before the ADMIN branch on
  // purpose, because a session claiming to be an account that no longer
  // exists has no "ADMIN's own job" left to defer to.
  if (!scope) return { email, role, ...deniedScope() };

  // ADMIN keeps its existing unrestricted hiddenSections/projectIds (that
  // configuration is an ADMIN's own job) — but hiddenAreas is resolved from
  // its function like any other role. It's the one axis an ADMIN doesn't
  // implicitly administer for its own account.
  if (hasMinRole(role, "ADMIN")) {
    return { email, role, hiddenSections: UNRESTRICTED.hiddenSections, hiddenAreas: resolveHiddenAreas(scope), projectIds: null };
  }

  return {
    email,
    role,
    hiddenSections: new Set(scope.hiddenSections.filter(isProjectSectionKey)),
    hiddenAreas: resolveHiddenAreas(scope),
    projectIds:
      scope.projectScope === "ASSIGNED" ? new Set(scope.assignedProjectIds) : null,
  };
}

/** `true` when the user may reach this project. */
export function canReachProject(ctx: AccessContext, projectId: number): boolean {
  return ctx.projectIds === null || ctx.projectIds.has(projectId);
}

/**
 * The project-id filter to hand a repository, or `undefined` when the caller
 * is unrestricted. Kept as a plain array so it drops straight into a Prisma
 * `where: { id: { in: ... } }`.
 */
export function projectIdFilter(ctx: AccessContext): number[] | undefined {
  return ctx.projectIds === null ? undefined : [...ctx.projectIds];
}
