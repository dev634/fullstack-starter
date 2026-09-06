import { getProject } from "@/actions/projects/projects";
import { canAccessArea } from "@/lib/areaAccess";
import { canAccessSection } from "@/lib/sectionAccess";
import type { ProjectSectionKey } from "@/lib/projectSections";

/**
 * The one place the canonical read-guard order for a project-section page
 * lives — mirrored from `reserves/report/route.ts` (docs/CONVENTIONS.md,
 * "Ordre des gardes sur une route de LECTURE"):
 *
 *   canAccessArea("projects")  → 404 (folded into "not found", see below)
 *   canAccessSection(section)  → 403 ("forbidden", plainly — see below)
 *   resolve the project row    → 404 if absent OR out of scope (getProject
 *                                 already applies canReachProject internally
 *                                 — see its own doc below)
 *
 * Every project-section page (`.../reserves/page.tsx`, `.../files/page.tsx`,
 * and any future one) is a thin wrapper around this, instead of each
 * recopying the same four checks in the same order. That copy-paste is
 * exactly how a passe adverse found 41 unguarded mutations elsewhere in this
 * app: N copies of a preamble is N chances to drop one, and N-1 that go
 * stale the day the order changes. A structural test can require "this file
 * calls resolveProjectSectionAccess" — it cannot seriously verify "this file
 * contains the right five checks in the right order" copied inline.
 *
 * Deliberately does NOT call `blockClientFromApp()`: that guard is universal
 * to every non-portal page (the project detail page and its dashboard each
 * call it too), not specific to a project's sections, so it stays the
 * caller's own first line rather than being folded into a function about
 * project-section access specifically.
 *
 * Deliberately returns a reason code, not JSX: which title/copy to render
 * around "not found"/"forbidden" differs per page (a réserves heading is not
 * a files heading), so each page keeps that "rendu propre" for itself — only
 * the ACCESS DECISION is shared here.
 */

type GetProjectResult = Awaited<ReturnType<typeof getProject>>;
/** The row shape `getProject` returns on success — `Extract` first, since
 * `GetProjectResult` is a union and its `"error"` branch has no `data`. */
type ProjectRow = NonNullable<Extract<GetProjectResult, { type: "success" }>["data"]>;

/**
 * Only the columns a project-section page actually reads (its name, plus the
 * four réserve-status columns the réserves page resolves into a label/colour
 * pair) — never the full `ProjectRow` `getProject` returns, which also
 * carries `budget`, `notes`, `address` for the callers that legitimately
 * need the whole thing (the project detail page, the guarded asset route,
 * the réserves report, the delivery-note-scan action).
 *
 * Narrowing the TYPE here isn't what closes the leak — TypeScript is
 * structural, so a variable typed with extra fields still satisfies a
 * narrower prop with no error at all, only a fresh object LITERAL trips the
 * excess-property check. What actually closes it is that `project` below is
 * built as a literal picking exactly these fields: a future page can never
 * forward `budget`/`notes`/`address` to a client component through
 * `access.project`, because those fields simply aren't there to forward
 * (same reasoning as repository/projects.ts::findById's own doc, and
 * repository/jobFunctions.ts::findAllOptions()).
 */
type ProjectSectionRow = Pick<
  ProjectRow,
  "name" | "reserveOpenLabel" | "reserveOpenColor" | "reserveResolvedLabel" | "reserveResolvedColor"
>;

export type ProjectSectionAccess =
  | {
      ok: true;
      clientId: number;
      projectId: number;
      project: ProjectSectionRow;
    }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "error"; message: string };

export async function resolveProjectSectionAccess(
  routeParams: { id: string; projectId: string },
  section: ProjectSectionKey
): Promise<ProjectSectionAccess> {
  const clientId = parseInt(routeParams.id, 10);
  const pid = parseInt(routeParams.projectId, 10);

  // The `projects` rubrique — the same one gating the standalone /projects
  // list, its CSV export, and the guarded asset delivery route (see
  // docs/CONVENTIONS.md's access-axes table) — governs whether a project
  // exists for this caller AT ALL. Checked first, and folded into the same
  // "not found" response as out-of-scope below: it's a blanket,
  // function-level rule (not tied to this one project), so it doesn't need
  // the anti-enumeration reasoning that branch exists for — it just reuses
  // the same rendering.
  if (!(await canAccessArea("projects"))) {
    return { ok: false, reason: "not-found" };
  }

  // A hidden SECTION, unlike the rubrique/scope checks above and below, is a
  // blanket, function-level refusal that names no project — it can say so
  // plainly, the same message requireSectionAccess already returns to a
  // mutation, checked before a single row of this section's own data (a
  // réserve, a plan, a file) is read — not merely before it is rendered,
  // which is the render-time filter this whole route exists to close.
  if (!(await canAccessSection(section))) {
    return { ok: false, reason: "forbidden" };
  }

  const result = await getProject(pid);
  if (result.type === "error") {
    return { ok: false, reason: "error", message: result.message };
  }
  if (!result.data) {
    return { ok: false, reason: "not-found" };
  }

  // getProject (actions/projects/projects.ts) already applies
  // canReachProject internally before ever returning non-null `data` — a
  // project outside the caller's scope comes back as `data: null`, caught
  // by the `!result.data` branch above. Re-running canReachProject here
  // could therefore never fire: same session, same request, same
  // underlying access context as the check `getProject` just did. The one
  // thing left that ISN'T covered above is the URL's own client id — a
  // project reached through the wrong client (real project, wrong parent in
  // the URL) reads exactly like one that doesn't exist — a distinct
  // response would confirm it exists to someone who shouldn't know that
  // (same reasoning as the project detail page's own comment).
  if (result.data.clientId !== clientId) {
    return { ok: false, reason: "not-found" };
  }

  return {
    ok: true,
    clientId,
    projectId: pid,
    project: {
      name: result.data.name,
      reserveOpenLabel: result.data.reserveOpenLabel,
      reserveOpenColor: result.data.reserveOpenColor,
      reserveResolvedLabel: result.data.reserveResolvedLabel,
      reserveResolvedColor: result.data.reserveResolvedColor,
    },
  };
}
