import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Structural guarantee: nothing under app/portail/** may call the app-side
 * access-context guards (getAccessContext, canReachProject, canAccessArea,
 * canAccessSection).
 *
 * Why this is a real trap and not a style preference: a client-portal login
 * is a Contact behind a CLIENT-role User, created WITHOUT a job function.
 * findAccessScopeByEmail (lib/accessContext.ts) treats an absent function as
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
 */

const PORTAL_DIR = join(process.cwd(), "app", "portail");

const FORBIDDEN_GUARDS = ["getAccessContext", "canReachProject", "canAccessArea", "canAccessSection"];

function sourceFilesIn(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFilesIn(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("client portal stays scoped by its own resolver, not the app's access-context guards", () => {
  const files = sourceFilesIn(PORTAL_DIR);

  it("finds the portal pages (guards against a silently empty scan)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never calls getAccessContext / canReachProject / canAccessArea / canAccessSection", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file).split(sep).join("/");
      const content = readFileSync(file, "utf8");
      for (const name of FORBIDDEN_GUARDS) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(content)) offenders.push(`${rel} calls ${name}(...)`);
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
});
