import { describe, it, expect } from "vitest";
import { join, relative, sep } from "node:path";
import { sourceFilesIn, functionsIn, guardedNames, importedModulesIn, parseSource } from "./helpers/astScan";

/**
 * Structural guarantee: nothing under app/portail/** may import the app-side
 * access-context guards (lib/accessContext, lib/access, lib/areaAccess,
 * lib/sectionAccess) or the repository they read from, and every entry point
 * (page/route/layout) must itself call the portal's own resolver.
 *
 * Why this is a real trap and not a style preference: a client-portal login
 * is a Contact behind a CLIENT-role User, created WITHOUT a job function.
 * findAccessScopeByEmail (repository/users.ts) treats an absent function as
 * unrestricted and returns `projectScope: "ALL"` — so canReachProject would
 * answer "yes" for every project in the database to a CLIENT session, and
 * canAccessArea/canAccessSection would likewise see nothing hidden. The
 * portal is cloisonné by its own resolver instead
 * (lib/portal.ts::getPortalContext, which intersects against the contact's
 * own linked project ids via requirePortalContext), never by these guards.
 * Someone extending the portal by copying the app's access-guard pattern
 * would compile, pass the app's own authz-coverage test (this file lives
 * outside actions/ and app/**\/route.ts, so that test never sees it), and
 * quietly open the portal's scoping wide for every CLIENT login.
 *
 * Two checks, not one — proven necessary by an adversarial pass that planted
 * probe files here: an import-name regex missed an aliased import
 * (`import { canReachProject as reach } from "@/lib/accessContext"`), and a
 * banned-import check alone still lets a page through with NO guard at all
 * (the more likely real-world mistake). Both are checked with the real
 * TypeScript AST (tests/helpers/astScan.ts) rather than a second regex, so an
 * import mentioned only in a comment can't trip it and an aliased import
 * can't dodge it.
 */

const PORTAL_DIR = join(process.cwd(), "app", "portail");

/**
 * Modules that resolve access from the app's own axes (role/function/project
 * scope) — banned as an IMPORT SOURCE, not as a list of function names. A
 * function-name list goes stale the moment a new wrapper is added around one
 * of these (e.g. a future `requireProjectAccess`-alike); banning the module
 * itself doesn't.
 */
const FORBIDDEN_MODULES = [
  "@/lib/accessContext",
  "@/lib/access",
  "@/lib/areaAccess",
  "@/lib/sectionAccess",
  "@/repository/users", // findAccessScopeByEmail — the raw resolver these guards read from
];

/** The only two calls that scope a portal entry point correctly (lib/portal.ts). */
const PORTAL_GUARD_CALLS = new Set(["requirePortalContext", "getPortalContext"]);

/** Next.js entry-point filenames: the ones that actually run for a request. */
const ENTRY_FILENAMES = new Set(["page.tsx", "page.ts", "layout.tsx", "layout.ts", "route.ts", "route.tsx"]);

function relPath(file: string): string {
  return relative(process.cwd(), file).split(sep).join("/");
}

describe("client portal stays scoped by its own resolver, not the app's access-context guards", () => {
  const files = sourceFilesIn(PORTAL_DIR, [".ts", ".tsx"]);

  it("finds the portal pages (guards against a silently empty scan)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports the app's access-context guards or the repository they read from", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relPath(file);
      const source = parseSource(rel, file);
      for (const mod of importedModulesIn(source)) {
        if (FORBIDDEN_MODULES.includes(mod)) offenders.push(`${rel} imports "${mod}"`);
      }
    }

    expect(
      offenders,
      offenders.length
        ? `app/portail/** must be scoped only by lib/portal.ts (requirePortalContext / getPortalContext), ` +
          `never by the app's access-context guards — a CLIENT login has no job function, so ` +
          `findAccessScopeByEmail resolves it to projectScope: "ALL" and these guards would let it ` +
          `reach every project instead of just its own:\n` +
          offenders.map((o) => `  - ${o}`).join("\n")
        : undefined
    ).toEqual([]);
  });

  it("gates every portal entry point (page/layout/route) behind requirePortalContext or getPortalContext", () => {
    // The likelier real mistake isn't calling the wrong guard, it's calling
    // none at all — a page with no guard whatsoever still passes the
    // import-source check above. Every exported entry point (the default
    // export of a page/layout, or an HTTP method export of a route) must
    // itself resolve to one of the two portal guards, directly or through a
    // local helper.
    const entryFiles = files.filter((f) => ENTRY_FILENAMES.has(f.split(sep).pop()!));
    expect(entryFiles.length).toBeGreaterThan(0);

    const ungated: string[] = [];
    for (const file of entryFiles) {
      const rel = relPath(file);
      const source = parseSource(rel, file);
      const fns = functionsIn(source);
      const guarded = guardedNames(fns, PORTAL_GUARD_CALLS);
      const entryFns = fns.filter((fn) => fn.exported);
      if (entryFns.length === 0) {
        ungated.push(`${rel} (no exported entry function found — did it move?)`);
        continue;
      }
      for (const fn of entryFns) {
        if (!guarded.has(fn.name)) ungated.push(`${rel}::${fn.name}`);
      }
    }

    expect(
      ungated,
      ungated.length
        ? `These portal entry points never call requirePortalContext()/getPortalContext():\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nCall requirePortalContext() from @/lib/portal (or getPortalContext() if the page must ` +
          `handle "not a client" itself) before reading or rendering anything.`
        : undefined
    ).toEqual([]);
  });
});
