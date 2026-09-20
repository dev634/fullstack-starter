import { describe, it, expect } from "vitest";
import { isProtectedPath } from "@/lib/routeGuard";
import { AREA_HREFS } from "@/lib/appAreas";

// Discovers its targets from AREA_HREFS (lib/appAreas.ts) — the single
// source of truth for every top-level rubrique's landing route — rather than
// a hand-maintained list of paths. A rubrique added to AREA_HREFS without a
// matching entry in PROTECTED_PATHS (lib/routeGuard.ts) is exactly the class
// of bug this closes: /loans shipped without one, leaving both the anonymous
// visitor and the CLIENT portal boundary unenforced on it.
describe("isProtectedPath covers every rubrique in AREA_HREFS", () => {
  for (const [area, href] of Object.entries(AREA_HREFS)) {
    it(`protects ${area}'s landing route (${href})`, () => {
      expect(isProtectedPath(href)).toBe(true);
    });

    // The whole subtree, not just the landing route: a future `^/loans$`
    // pattern would pass the test above and leave /loans/<anything> naked.
    // "/" is the one exact-match entry (a root has no subtree of its own:
    // every other rubrique lives under it), so it is skipped here.
    if (href !== "/") {
      it(`protects ${area}'s subtree (${href}/x)`, () => {
        expect(isProtectedPath(`${href}/x`)).toBe(true);
      });
    }
  }
});
