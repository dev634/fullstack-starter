import { getAccessContext } from "@/lib/accessContext";
import {
  type AppAreaKey,
  type AreaLandingCandidate,
  AREA_HREFS,
  TOP_LEVEL_APP_AREAS,
  getAreaAncestors,
  resolveAreaLanding,
} from "@/lib/appAreas";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// `next/navigation`, lib/auth and lib/adminAccess are deliberately NOT
// imported at module scope: requireAreaAccess below is called from every
// clients/projects/contacts mutation (actions/**), so pulling in the
// session/redirect machinery here would drag it into code paths — and unit
// tests — that only ever need the pure hidden-areas check. Only
// requireAreaOrRedirect needs them, so it loads them lazily on the one path
// that actually redirects.

/**
 * Access to a top-level app rubrique (and its sub-parts), decided by the
 * caller's job function — the exact mirror of lib/sectionAccess.ts, applied
 * to the whole app instead of a single project's detail page.
 *
 * Bypass rule deliberately DIFFERS from sectionAccess: there, ADMIN and above
 * are exempt because they're the ones configuring it. Here, only SUPERADMIN
 * is exempt (see lib/accessContext.ts) — an ADMIN can have their own
 * top-level rubriques hidden by their job function, same as anyone else.
 * SUPERADMIN stays unrestricted so the anti-lockout guarantee always has one
 * role that can reach every rubrique, including the one that fixes a
 * misconfigured function.
 *
 * This is enforcement, not decoration: every guarded page checks this
 * server-side, not just the nav links.
 */

/** Areas hidden for the current user by their job function. Empty for SUPERADMIN. */
export async function getHiddenAreas(): Promise<Set<AppAreaKey>> {
  return (await getAccessContext()).hiddenAreas;
}

/**
 * Page-level branching: may the current user see this area? Hiding a parent
 * hides every one of its sub-parts too — e.g. hiding `clients` also hides
 * `clients.contacts`, regardless of whether that leaf key is itself listed.
 */
export async function canAccessArea(area: AppAreaKey): Promise<boolean> {
  const hidden = await getHiddenAreas();
  if (hidden.has(area)) return false;
  return !getAreaAncestors(area).some((ancestor) => hidden.has(ancestor));
}

/**
 * Guard a server action behind an area, mirroring requireSectionAccess's
 * shape so actions can check both the same way.
 */
export async function requireAreaAccess(
  area: AppAreaKey
): Promise<{ error: { type: "error"; message: string } | null }> {
  if (await canAccessArea(area)) return { error: null };

  const t = getDictionary(await getLocale());
  return { error: { type: "error" as const, message: t.errors.forbidden } };
}

/**
 * The first top-level rubrique the current user may reach, in
 * dashboard → clients → projects → admin order — the canonical redirect
 * target when the rubrique a page was about to render turns out to be
 * hidden by the caller's job function.
 *
 * `admin`'s own visibility is capability ∧ function (RBAC role AND not
 * hidden) — a combination only lib/adminAccess.ts (`getAdminAccess`) can
 * resolve, since this module has no notion of capabilities. Callers pass
 * that result in rather than this function re-deriving RBAC.
 *
 * Never returns null: if every rubrique — including admin — is hidden (only
 * reachable for ADMIN and below; SUPERADMIN is always unrestricted), this
 * falls back to "/acces-refuse". That page requires only a session (no area
 * of its own to be hidden from), so it can't loop, and it tells an
 * authenticated user the truth instead of bouncing them at the sign-in form
 * as if they were never logged in.
 */
export async function firstAccessibleAreaHref(
  adminAccessible: boolean,
  adminHref: string | null
): Promise<string> {
  const hidden = await getHiddenAreas();
  // AREA_HREFS (lib/appAreas.ts) is the single source for both the candidate
  // order and their hrefs — `admin` has no fixed href there (its landing tab
  // depends on RBAC too), so it's handled separately below via the caller's
  // already-resolved adminAccessible/adminHref.
  const candidates: AreaLandingCandidate[] = TOP_LEVEL_APP_AREAS.flatMap((key) => {
    const href = AREA_HREFS[key];
    return href ? [{ key, href }] : [];
  });
  const landing = resolveAreaLanding(candidates, hidden);
  if (landing) return landing;
  if (adminAccessible && adminHref) return adminHref;
  return "/acces-refuse";
}

/**
 * Page-level guard: redirect away if the current user's job function hides
 * this rubrique — the exact block app/page.tsx, app/clients/page.tsx,
 * app/clients/[id]/page.tsx and app/projects/page.tsx each repeated inline.
 * Resolves the session/adminAccess and calls `redirect` itself (never
 * returns when it does), mirroring lib/adminAccess.ts's requireAdminTab.
 */
export async function requireAreaOrRedirect(area: AppAreaKey): Promise<void> {
  if (await canAccessArea(area)) return;
  const [{ redirect }, { auth }, { getAdminAccess }] = await Promise.all([
    import("next/navigation"),
    import("@/lib/auth"),
    import("@/lib/adminAccess"),
  ]);
  const session = await auth();
  const adminAccess = await getAdminAccess(session?.user?.role);
  redirect(await firstAccessibleAreaHref(adminAccess.any, adminAccess.landing));
}
