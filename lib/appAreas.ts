// Single source of truth for the app's top-level rubriques and their
// sub-parts — mirrors lib/projectSections.ts, but for the whole app instead
// of a single project's detail page. Used by the admin settings page (the
// job-function area picker), the access-context resolver, and every
// top-level page that must enforce "does my job function even show me this
// rubrique at all".
//
// `projects` is deliberately a leaf here: a project's own 7 detail sections
// (tasks, materials, …) are the orthogonal axis already covered by
// lib/projectSections.ts / lib/sectionAccess.ts and are not duplicated.

export const APP_AREA_KEYS = [
  "dashboard",
  "dashboard.stats",
  "dashboard.recent",
  "clients",
  "clients.info",
  "clients.contacts",
  "clients.projects",
  "projects",
  "admin",
  "admin.users",
  "admin.functions",
  "admin.settings",
] as const;

export type AppAreaKey = (typeof APP_AREA_KEYS)[number];

export function isAppAreaKey(value: string): value is AppAreaKey {
  return (APP_AREA_KEYS as readonly string[]).includes(value);
}

/**
 * Parent → children, describing the tree an admin configures visibility for.
 * Leaves (no sub-parts, including `projects`) map to an empty array.
 */
export const APP_AREA_CHILDREN: Record<AppAreaKey, readonly AppAreaKey[]> = {
  dashboard: ["dashboard.stats", "dashboard.recent"],
  "dashboard.stats": [],
  "dashboard.recent": [],
  clients: ["clients.info", "clients.contacts", "clients.projects"],
  "clients.info": [],
  "clients.contacts": [],
  "clients.projects": [],
  projects: [],
  admin: ["admin.users", "admin.functions", "admin.settings"],
  "admin.users": [],
  "admin.functions": [],
  "admin.settings": [],
};

/** The top-level rubriques, in the app's canonical/landing order. */
export const TOP_LEVEL_APP_AREAS: readonly AppAreaKey[] = ["dashboard", "clients", "projects", "admin"];

/**
 * Fixed landing href for each top-level rubrique that has exactly one — every
 * one except `admin`, whose href depends on which tab a role/function can
 * open (RBAC capability AND not hidden), not just this module's notion of
 * area visibility; lib/adminAccess.ts resolves that one separately. Order
 * matches TOP_LEVEL_APP_AREAS — this is the single source lib/areaAccess.ts
 * draws both the iteration order and the hrefs from.
 */
export const AREA_HREFS: Partial<Record<AppAreaKey, string>> = {
  dashboard: "/",
  clients: "/clients",
  projects: "/projects",
};

/**
 * The ancestors of a key, root-first — e.g. `clients.contacts` → `["clients"]`,
 * and a top-level key → `[]`. Derived from the dotted key itself (rather than
 * walking APP_AREA_CHILDREN) so it stays correct even if a branch grows a
 * third level later.
 */
export function getAreaAncestors(key: AppAreaKey): AppAreaKey[] {
  const parts = key.split(".");
  const ancestors: AppAreaKey[] = [];
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(0, i).join(".");
    if (isAppAreaKey(candidate)) ancestors.push(candidate);
  }
  return ancestors;
}

/**
 * Effective visibility for DISPLAY purposes only: a key reads as visible when
 * its own checkbox is on AND every one of its ancestors' is too — mirrors
 * canAccessArea's "a hidden ancestor hides everything under it" rule, but
 * against an in-progress admin UI selection (a `Set` of checked keys) rather
 * than the persisted hiddenAreas. Used to grey out/disable descendants of an
 * unchecked parent in the admin picker.
 *
 * Never use this to decide what gets STORED: JobFunctionsManager persists
 * each key's own checkbox state (`visibleAreas.has(k)`), not this combined
 * predicate — otherwise unchecking a parent would bake "hidden" into every
 * descendant too, and re-checking the parent could never tell which
 * descendants the admin actually meant to keep unchecked.
 */
export function isAreaEffectivelyVisible(key: AppAreaKey, visible: ReadonlySet<AppAreaKey>): boolean {
  return visible.has(key) && getAreaAncestors(key).every((ancestor) => visible.has(ancestor));
}

/**
 * Turn a stored (possibly stale or tampered) hiddenAreas list into only the
 * keys this app still knows about, deduped — forward-compatible the same way
 * a section key list is: an area removed or renamed later is silently
 * dropped instead of poisoning the set with garbage, and a newly added area
 * is visible by default until an admin hides it.
 */
export function normalizeHiddenAreas(stored: readonly string[] | null | undefined): AppAreaKey[] {
  const seen = new Set<AppAreaKey>();
  for (const key of stored ?? []) {
    if (isAppAreaKey(key)) seen.add(key);
  }
  return [...seen];
}

/** One candidate landing page: a top-level area and the route that renders it. */
export type AreaLandingCandidate = { key: AppAreaKey; href: string };

/**
 * The first candidate whose key isn't in `hidden`, or `null` if every
 * candidate is. Pure (no session/DB access) so the "which page comes next"
 * decision is unit-testable without mocking auth — see lib/areaAccess.ts for
 * the async wrapper that resolves the real hidden set and adds `admin` (whose
 * visibility also depends on the RBAC capability, not just hiddenAreas).
 */
export function resolveAreaLanding(
  candidates: readonly AreaLandingCandidate[],
  hidden: ReadonlySet<AppAreaKey>
): string | null {
  for (const candidate of candidates) {
    if (!hidden.has(candidate.key)) return candidate.href;
  }
  return null;
}
