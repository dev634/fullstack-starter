// Single source of truth for the reorderable collapsible sections ("dropdowns")
// on the project detail page. Used by the page (render order), the admin
// settings page (initial order), and the reorder action (validation) — keep
// the key list here so adding a new section is a one-line change.

export const PROJECT_SECTION_KEYS = [
  "tasks",
  "materials",
  "interventions",
  "subcontractors",
  "interims",
  "files",
  "reserves",
] as const;

export type ProjectSectionKey = (typeof PROJECT_SECTION_KEYS)[number];

export function isProjectSectionKey(value: string): value is ProjectSectionKey {
  return (PROJECT_SECTION_KEYS as readonly string[]).includes(value);
}

/**
 * Turn a stored (possibly partial, stale, or dirty) order into a valid, full
 * ordering of every known section:
 *   1. keep the stored keys in their stored order — deduped, unknown dropped;
 *   2. append any known key the stored list is missing, in canonical order.
 *
 * This makes the feature forward-compatible: a section added to
 * PROJECT_SECTION_KEYS later simply appears at the end until an admin
 * repositions it, and a removed/renamed key in old stored data is ignored.
 */
export function normalizeSectionOrder(
  stored: readonly string[] | null | undefined
): ProjectSectionKey[] {
  const seen = new Set<ProjectSectionKey>();
  const result: ProjectSectionKey[] = [];
  for (const key of stored ?? []) {
    if (isProjectSectionKey(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  for (const key of PROJECT_SECTION_KEYS) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}
