import { getErrorMessage } from "@/lib/helpers";
import { requireRole } from "@/lib/authz";
import { requireAreaAccess } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { projectTrashState } from "@/lib/projectTrash";
import { findById } from "@/repository/projects";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * The project read of the project pages (projects/[projectId], its edit page,
 * its dashboard) and of lib/projectSectionGuard.ts — all on the server.
 *
 * Deliberately NOT in actions/projects/projects.ts, where it used to live: that
 * file starts with `"use server"`, which registers every EXPORTED function as a
 * Server Action in the build manifest — invocable from the browser by its id.
 * A read that returns the whole project row (budget, notes, address included)
 * has no business being a client-callable endpoint when nothing but the server
 * calls it. Its guards moved with it, unchanged: role, rubrique, scope, trash
 * (projectTrashState). What pins each one: role and rubrique,
 * tests/authz-coverage.test.ts (by argument, "projects"); the trash, the
 * projectTrashState test; the scope, behaviour tests in
 * tests/project-actions.test.ts.
 */
export async function getProject(id: number) {
  const roleCheck = await requireRole("VIEWER");
  if (roleCheck.error) return roleCheck.error;
  // Passe 3b, point 1: an EDITOR whose function hides "projects" (and
  // "clients") could still pull the full chantier row — budget/notes
  // included, the two fields the client portail deliberately never exposes
  // (app/portail/projets/[projectId]/page.tsx) — straight off this action.
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const project = await findById(id);
    // A trashed project — or one whose company is trashed, the same rule
    // requireProjectAccess freezes its content on — is invisible to the
    // normal detail page (looks like "not found"); the trash page reads the
    // repository directly instead. A
    // project outside the caller's scope reads the same way — a distinct
    // response would confirm it exists to someone who shouldn't know that.
    const access = await getAccessContext();
    const visible = project && !projectTrashState(project).inTrash && canReachProject(access, project.id);
    return { type: "success" as const, data: visible ? project : null };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
