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

/**
 * Route segment -> the section key(s) that gate that
 * `app/clients/[id]/projects/[projectId]/<segment>` page. The single source
 * of truth for the route <-> key correspondence, which used to be implicit
 * (the folder was simply named after its one key) — that stopped being true
 * the day one page started depending on two keys at once (`workforce`,
 * fusing `subcontractors` + `interims` into one page without touching either
 * key: see lib/accessContext.ts's own doc on why the two stay separate).
 *
 * `tasks` depends on TWO keys since Matériel joined it: the dedicated
 * `.../tasks` page now also owns the material list, the add-material form and
 * the delivery-note scan modal, the same "fuse into one page, keep both keys"
 * move `workforce` made first — a caller whose function hides only one of
 * `tasks`/`materials` still gets the other half of the page. `interventions`
 * got its own single-key route the same day, for the same reason `tasks` and
 * `reserves` did before it: a hub that reads full rows just to render an
 * inline dropdown doesn't scale, and there was no reason left for it to be
 * the one remaining full-row read on the hub once materials left it too.
 *
 * Every key now has an entry — there is no key left that renders inline as a
 * collapsible section on the hub page itself.
 *
 * Two consumers read this table instead of re-deriving it:
 *   - tests/project-section-authz-coverage.test.ts discovers which page(s)
 *     must call resolveProjectSectionAccess, and with which key(s);
 *   - buildHubSlots (below) decides where a routed page's link card sits in
 *     the admin-configurable order, collapsing a multi-key route into one
 *     slot instead of leaving a hole (or a duplicate) where its second key
 *     used to render its own card.
 */
export const PROJECT_SECTION_ROUTES = {
  tasks: ["tasks", "materials"],
  files: ["files"],
  reserves: ["reserves"],
  workforce: ["subcontractors", "interims"],
  interventions: ["interventions"],
} as const satisfies Record<string, readonly ProjectSectionKey[]>;

export type ProjectSectionRouteSegment = keyof typeof PROJECT_SECTION_ROUTES;

export type HubSlot =
  | { kind: "route"; segment: ProjectSectionRouteSegment }
  | { kind: "section"; key: ProjectSectionKey };

/**
 * Turns an already visibility-filtered, already admin-ordered list of
 * section keys (`normalizeSectionOrder(...).filter(key => !hidden.has(key))`
 * in the hub page) into the slots it actually renders: every routed page
 * (`PROJECT_SECTION_ROUTES`) becomes exactly ONE slot, no matter how many
 * keys it depends on, positioned at the earliest index any of its member
 * keys held in `order` — dragging either "Sous-traitants" or "Intérimaires"
 * above "Tâches" in the admin's section-order tab moves the merged Personnel
 * card there, whichever of the two moved, and if one of the two is hidden for
 * the caller (already dropped from `order` before this runs) the slot simply
 * takes the other's position. Same story for "Matériel" riding along with
 * "Tâches": moving either one moves the single Tâches card.
 *
 * `HubSlot`'s `{ kind: "section" }` branch (a key with no routed page) is
 * currently never produced — every `ProjectSectionKey` now has an entry in
 * `PROJECT_SECTION_ROUTES` — but stays part of the type and this function's
 * logic for the day a new section key ships inline, without its own route,
 * before it earns one.
 *
 * This is what makes the merged card's position a decision the table
 * encodes, not an accident of which key the hub's render loop happens to
 * reach first.
 */
export function buildHubSlots(order: readonly ProjectSectionKey[]): HubSlot[] {
  const segmentForKey = new Map<ProjectSectionKey, ProjectSectionRouteSegment>();
  for (const [segment, keys] of Object.entries(PROJECT_SECTION_ROUTES) as [
    ProjectSectionRouteSegment,
    readonly ProjectSectionKey[],
  ][]) {
    for (const key of keys) segmentForKey.set(key, segment);
  }

  const slots: HubSlot[] = [];
  const emitted = new Set<ProjectSectionRouteSegment>();
  for (const key of order) {
    const segment = segmentForKey.get(key);
    if (!segment) {
      slots.push({ kind: "section", key });
      continue;
    }
    if (emitted.has(segment)) continue; // the route's other member key, already placed
    emitted.add(segment);
    slots.push({ kind: "route", segment });
  }
  return slots;
}
