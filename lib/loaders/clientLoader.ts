import { getErrorMessage } from "@/lib/helpers";
import { requireRole } from "@/lib/authz";
import { requireAreaAccess } from "@/lib/areaAccess";
import { getAccessContext } from "@/lib/accessContext";
import { hasProjectAmong } from "@/repository/projects";
import { findById } from "@/repository/clients";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * The company read of the company pages (clients/[id], clients/[id]/edit,
 * clients/[id]/projects/add) — all three Server Components.
 *
 * Deliberately NOT in actions/clients/clients.ts, where it used to live: that
 * file starts with `"use server"`, which registers every EXPORTED function as a
 * Server Action in the build manifest — invocable from the browser by its id,
 * whoever renders the page. A read that returns the whole company row has no
 * business being a client-callable endpoint when nothing but the server calls
 * it. Living here keeps it an ordinary server-side function (same move as
 * lib/revalidateFiles.ts). Its guards moved with it, unchanged: role, rubrique,
 * scope, trash. What pins each one (a guard is only as good as the test that
 * turns red without it): role and rubrique, tests/authz-coverage.test.ts (by
 * argument, "clients"); scope and trash, behaviour tests in
 * tests/client-actions.test.ts (a company with no project in scope, a company
 * in the trash — both answered like an absent one).
 */
export async function getClient(id: number) {
  const roleCheck = await requireRole("VIEWER");
  if (roleCheck.error) return roleCheck.error;
  // Passe 3b, point 1: this used to only check the role, not the rubrique —
  // a function whose hiddenAreas hides "clients" could still read the full
  // company row (including fields the portail deliberately never exposes)
  // straight off this action. tests/authz-coverage.test.ts's READS allowlist
  // used to exempt this file's reads for exactly that reason; the exemption
  // is gone now that this guard actually exists.
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: t.errors.invalidId,
      };
    }

    const client = await findById(id);
    // A trashed client is invisible to the normal detail page (looks like
    // "not found"); the trash page reads the repository directly instead. A
    // client outside the caller's scope reads the same way — a distinct
    // response would confirm it exists to someone who shouldn't know that.
    const access = await getAccessContext();
    const reachable =
      access.projectIds === null || (await hasProjectAmong(id, [...access.projectIds]));
    const visible = client && !client.deletedAt && reachable;
    return {
      type: "success",
      data: visible ? client : null,
    };
  } catch (error) {
    console.log("Action getClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
