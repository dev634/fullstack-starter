import { getAccessContext } from "@/lib/accessContext";
import { type ProjectSectionKey } from "@/lib/projectSections";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Access to a project section, decided by the caller's job function.
 *
 * This is the second of the app's two access axes, and they are deliberately
 * kept orthogonal:
 *   - the ROLE (via the capability matrix) decides read vs write;
 *   - the FUNCTION decides which sections exist for you at all.
 * Crossing them would give a function × section × level grid that nobody can
 * configure or reason about. "Chef de projet, Matériel en lecture seule" is
 * expressed by giving that person a VIEWER-ish role, not a third system.
 *
 * ADMIN and above are exempt: they configure this, and configuring what you
 * cannot see is how you lock yourself out.
 *
 * Note this is enforcement, not decoration. `JobFunction.hiddenSections` used
 * to be applied only when rendering the project page, so the rows were still
 * fetched and every mutation stayed reachable by anyone with the right role —
 * a preference, not a permission.
 */

/** Sections the current user may not touch. Empty for ADMIN+ and unassigned users. */
export async function getHiddenSections(): Promise<Set<ProjectSectionKey>> {
  return (await getAccessContext()).hiddenSections;
}

/** Page-level branching: may the current user see this section? */
export async function canAccessSection(section: ProjectSectionKey): Promise<boolean> {
  const hidden = await getHiddenSections();
  return !hidden.has(section);
}

/**
 * Guard a server action behind a section, mirroring requireCapability's shape
 * so actions can check both the same way:
 *
 *   const sectionCheck = await requireSectionAccess("reserves");
 *   if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };
 */
export async function requireSectionAccess(
  section: ProjectSectionKey
): Promise<{ error: { type: "error"; message: string } | null }> {
  if (await canAccessSection(section)) return { error: null };

  const t = getDictionary(await getLocale());
  return { error: { type: "error" as const, message: t.errors.forbidden } };
}
