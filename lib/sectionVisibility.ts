import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { findHiddenSectionsByEmail } from "@/repository/users";
import { isProjectSectionKey, type ProjectSectionKey } from "@/lib/projectSections";

/**
 * Project-detail sections hidden from the current user by their job function
 * (see JobFunction.hiddenSections). ADMIN+ are exempt — they manage the app and
 * always see every section. Returned as a Set of valid section keys for a cheap
 * `.has()` filter on the project page.
 */
export async function getHiddenSectionsForCurrentUser(): Promise<Set<ProjectSectionKey>> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || hasMinRole(session?.user?.role, "ADMIN")) {
    return new Set();
  }
  const hidden = await findHiddenSectionsByEmail(email);
  return new Set(hidden.filter(isProjectSectionKey));
}
