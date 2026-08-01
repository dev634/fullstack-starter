import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { findAccessScopeByEmail } from "@/repository/users";
import { isProjectSectionKey, type ProjectSectionKey } from "@/lib/projectSections";

/**
 * Everything that decides what the current user may reach, resolved once.
 *
 * The app has two access axes and they answer different questions:
 *   - `hiddenSections` — which FEATURES exist for you (job function);
 *   - `projectIds`     — which DATA exists for you (job function + assignments).
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
  /** Sections this user may not touch. Empty for ADMIN+. */
  hiddenSections: Set<ProjectSectionKey>;
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
  projectIds: null,
};

export async function getAccessContext(): Promise<AccessContext> {
  const session = await auth();
  const email = session?.user?.email ?? null;
  const role = session?.user?.role;

  // ADMIN and above administer the app: they see every section and every
  // project. Restricting the people who configure the restrictions is how you
  // end up locked out of your own instance.
  if (!email || hasMinRole(role, "ADMIN")) {
    return { email, role, ...UNRESTRICTED };
  }

  const scope = await findAccessScopeByEmail(email);
  if (!scope) return { email, role, ...UNRESTRICTED };

  return {
    email,
    role,
    hiddenSections: new Set(scope.hiddenSections.filter(isProjectSectionKey)),
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
