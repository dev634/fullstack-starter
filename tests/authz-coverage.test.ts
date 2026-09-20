import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { sourceFilesIn, functionsIn, guardedNames } from "./helpers/astScan";
import { AREA_HREFS } from "@/lib/appAreas";

/**
 * Structural guarantee: every exported server action is behind an
 * authorization gate.
 *
 * The per-action tests elsewhere check that a *known* action refuses the wrong
 * role. They cannot catch the regression that actually matters — someone adds
 * a new mutation and forgets the gate entirely. This test enumerates the real
 * `actions/` tree instead of a hand-maintained list, so a new unguarded action
 * fails CI the day it lands.
 */

const ACTIONS_DIR = join(process.cwd(), "actions");
const APP_DIR = join(process.cwd(), "app");

/** Calls that constitute an authorization gate. */
const GUARD_CALLS = new Set([
  "requireCapability", // capability matrix (server actions)
  "requireRole", // explicit minimum role
  "requireSession", // authenticated-only reads
  "can", // page/action-level capability check
  "requirePortalContext", // client portal, scoped
  "getPortalContext",
  "requireAppUser", // route handlers (lib/requireAppUser)
]);

/**
 * Actions that are deliberately reachable without a session, each with the
 * reason it must stay that way. Anything not listed here must be gated.
 */
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  "actions/auth/auth.ts::login": "signing in is what creates the session",
  "actions/auth/auth.ts::logout": "ending a session must never require one",
  "actions/auth/auth.ts::requestPasswordReset": "a locked-out user has no session",
  "actions/auth/auth.ts::resetPassword": "guarded by the emailed single-use token, not a session",
  "actions/locale/locale.ts::setLocale": "UI language cookie, carries no private data",
};

/**
 * Route handlers that are deliberately reachable without a session.
 * Everything else under app/ that exports an HTTP method must be gated —
 * the CSV exports stream whole tables, so the proxy must not be their only
 * line of defence.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "app/api/health/route.ts::GET": "uptime probe; returns only a status string plus an aggregate pending-migration count, no row-level data",
  "app/api/auth/[...nextauth]/route.ts::GET": "Auth.js sign-in endpoints must be reachable logged out",
  "app/api/auth/[...nextauth]/route.ts::POST": "Auth.js sign-in endpoints must be reachable logged out",
};

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * Action files whose mutations belong to a project (every row they touch is
 * reached via a projectId). Declared once and shared by the two tests below
 * — "behind its section" and "behind the projects area" — precisely so a
 * 13th file added to one list can't silently miss the other. That drift is
 * exactly what happened before this list existed here: these files checked
 * requireSectionAccess but not requireAreaAccess("projects"), so a job
 * function whose `projects` rubrique was hidden still kept full write and
 * delete access to every one of them (lot C1 of the adversarial pass on the
 * EDITOR profile — see docs/SECURITE-CHECKLIST.md, V8). 12 files now: the
 * feature "catégories de matériel" (actions/materialCategories) is owned by
 * the same `materials` section as actions/projectMaterials, so it belongs on
 * the same list, not a separate one.
 */
const OWNED_BY_SECTION = [
  "actions/tasks/tasks.ts",
  "actions/taskGroups/taskGroups.ts",
  "actions/taskCategories/taskCategories.ts",
  "actions/taskAssignee/taskAssignee.ts",
  "actions/projectMaterials/projectMaterials.ts",
  "actions/materialCategories/materialCategories.ts",
  "actions/deliveryNoteScan/deliveryNoteScan.ts",
  "actions/interventions/interventions.ts",
  "actions/subcontractors/subcontractors.ts",
  "actions/interims/interims.ts",
  "actions/projectFiles/projectFiles.ts",
  "actions/reserves/reserves.ts",
];

/**
 * "Resolved by import" helpers for requireAreaOrRedirect (lib/areaAccess.ts),
 * used by the page-level test below. Same technique as
 * tests/project-section-authz-coverage.test.ts's resolveProjectSectionAccess
 * check (a second, narrower occurrence — not extracted per this repo's
 * two-occurrence DRY threshold, flagged as a shared-helper candidate the day
 * a third caller needs it): matching the bare identifier
 * "requireAreaOrRedirect" would also count a locally redeclared function of
 * the same name that never imports the real guard.
 */
const ROOT = process.cwd();
const AREA_ACCESS_LIB_FILE = resolve(ROOT, "lib", "areaAccess.ts").toLowerCase();
const AREA_GUARD_EXPORT_NAME = "requireAreaOrRedirect";

/** Whether import specifier `spec`, written in file `fromRelFile`, resolves to lib/areaAccess.ts. */
function resolvesToAreaAccessLib(spec: string, fromRelFile: string): boolean {
  let base: string | undefined;
  if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromRelFile), spec);
  if (!base) return false; // a bare package specifier is never this local module
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.some((c) => c.toLowerCase() === AREA_ACCESS_LIB_FILE);
}

/** Local names bound to lib/areaAccess.ts's requireAreaOrRedirect export, aliased or not. */
function collectAreaGuardNames(source: ts.SourceFile, relFile: string): Set<string> {
  const names = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!resolvesToAreaAccessLib(stmt.moduleSpecifier.text, relFile)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === AREA_GUARD_EXPORT_NAME) names.add(el.name.text);
    }
  }
  return names;
}

type PageFn = { name: string; exported: boolean; body: ts.Node };

/** Top-level named page functions in `source`, keeping the body node (unlike functionsIn above, which only keeps bare call names — not enough to tell an import-resolved call from a same-named local declaration). */
function pageFunctionsIn(source: ts.SourceFile): PageFn[] {
  const fns: PageFn[] = [];
  ts.forEachChild(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      fns.push({ name: node.name.text, exported, body: node.body });
      return;
    }
    if (ts.isVariableStatement(node)) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
        fns.push({ name: decl.name.text, exported, body: decl.initializer.body });
      }
    }
  });
  return fns;
}

/** Whether a call expression anywhere inside `node` calls one of `guardNames`. */
function bodyCallsAnyOf(node: ts.Node, guardNames: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && guardNames.has(n.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

type Action = { key: string; file: string; name: string; guarded: boolean };

function collectActions(): Action[] {
  const actions: Action[] = [];
  for (const file of sourceFilesIn(ACTIONS_DIR, [".ts"])) {
    const rel = relative(process.cwd(), file).split(sep).join("/");
    const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const fns = functionsIn(source);
    const guarded = guardedNames(fns, GUARD_CALLS);
    for (const fn of fns) {
      if (!fn.exported) continue;
      actions.push({ key: `${rel}::${fn.name}`, file: rel, name: fn.name, guarded: guarded.has(fn.name) });
    }
  }
  return actions;
}

function collectRouteHandlers(): Action[] {
  const handlers: Action[] = [];
  for (const file of sourceFilesIn(APP_DIR, [".ts"])) {
    if (!file.endsWith(`${sep}route.ts`)) continue;
    const rel = relative(process.cwd(), file).split(sep).join("/");
    const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const fns = functionsIn(source);
    const guarded = guardedNames(fns, GUARD_CALLS);
    for (const fn of fns) {
      if (!fn.exported || !HTTP_METHODS.has(fn.name)) continue;
      handlers.push({ key: `${rel}::${fn.name}`, file: rel, name: fn.name, guarded: guarded.has(fn.name) });
    }
  }
  return handlers;
}

describe("authorization coverage across server actions", () => {
  const actions = collectActions();

  it("finds the action modules (guards against a silently empty scan)", () => {
    // If a refactor moves actions/, this test would otherwise pass vacuously.
    expect(actions.length).toBeGreaterThan(50);
  });

  it("gates every exported server action, except those explicitly declared public", () => {
    const unguarded = actions
      .filter((a) => !a.guarded && !(a.key in INTENTIONALLY_PUBLIC))
      .map((a) => a.key);

    expect(
      unguarded,
      unguarded.length
        ? `These server actions reach the database with no authorization gate:\n` +
          unguarded.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd requireCapability(...) (or another gate), or — if the action is ` +
          `genuinely public — add it to INTENTIONALLY_PUBLIC with the reason.`
        : undefined
    ).toEqual([]);
  });

  it("keeps the public allowlist honest: every entry still exists and is still ungated", () => {
    // A stale allowlist is how an entry silently becomes permission to skip the
    // gate on an action that later grew teeth.
    const byKey = new Map(actions.map((a) => [a.key, a]));
    for (const key of Object.keys(INTENTIONALLY_PUBLIC)) {
      const action = byKey.get(key);
      expect(action, `${key} is allowlisted as public but no longer exists — remove the entry`).toBeDefined();
      expect(
        action!.guarded,
        `${key} is allowlisted as public but now has a gate — remove the entry, it is protected`
      ).toBe(false);
    }
  });

  it("gates every route handler, except those explicitly declared public", () => {
    // Route handlers are the surface with no render-time second check: the CSV
    // exports stream whole tables, so a proxy-only defence is one bug from a
    // full data leak — and that proxy has silently failed here before.
    const handlers = collectRouteHandlers();
    expect(handlers.length).toBeGreaterThan(3);

    const unguarded = handlers
      .filter((h) => !h.guarded && !(h.key in PUBLIC_ROUTES))
      .map((h) => h.key);

    expect(
      unguarded,
      unguarded.length
        ? `These route handlers answer without checking the session:\n` +
          unguarded.map((k) => `  - ${k}`).join("\n") +
          `\n\nCall requireAppUser() from @/lib/requireAppUser, or add the route to ` +
          `PUBLIC_ROUTES with the reason.`
        : undefined
    ).toEqual([]);
  });

  it("gates every section-owned action behind its section, not just a role", () => {
    // The capability matrix answers "may I write?"; it says nothing about
    // "may I touch Matériel at all?". Without this, a job function barred from
    // a section still reaches every mutation in it — which is what
    // JobFunction.hiddenSections used to be: a filter on one page's render.
    const ungated: string[] = [];
    for (const file of OWNED_BY_SECTION) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fns = functionsIn(source);
      expect(fns.length, `${file} has no exported action — did it move?`).toBeGreaterThan(0);
      for (const fn of fns) {
        if (!fn.exported) continue;
        if (!fn.calls.has("requireSectionAccess")) ungated.push(`${file}::${fn.name}`);
      }
    }

    expect(
      ungated,
      ungated.length
        ? `These actions belong to a project section but never check it:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd requireSectionAccess("<section>") from @/lib/sectionAccess, ` +
          `next to the existing capability check.`
        : undefined
    ).toEqual([]);
  });

  it("gates every section-owned action behind the projects area too, not just its section (adversarial pass, lot C1, #1)", () => {
    // requireSectionAccess (checked above) only answers "which of a
    // project's OWN sections may this caller see" — a narrower question that
    // assumes the `projects` rubrique itself is already reachable. Reads
    // (getClient/getProject, the dashboard, the PDF report, /api/assets)
    // were closed behind canAccessArea("projects") first; these mutations —
    // every one of them content living inside a project — were not, so a
    // function whose hiddenAreas hides `projects` could no longer open the
    // project list, the detail page, the dashboard, export, or download a
    // single file, and still add/edit/delete tasks, materials, files,
    // réserves, interventions, intérimaires and subcontractors on it. Same
    // OWNED_BY_SECTION list as above, deliberately: any file added to one
    // gate belongs behind both.
    const ungated: string[] = [];
    for (const file of OWNED_BY_SECTION) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fns = functionsIn(source);
      expect(fns.length, `${file} has no exported action — did it move?`).toBeGreaterThan(0);
      for (const fn of fns) {
        if (!fn.exported) continue;
        if (!fn.calls.has("requireAreaAccess")) ungated.push(`${file}::${fn.name}`);
      }
    }

    expect(
      ungated,
      ungated.length
        ? `These actions belong to a project but never check the projects area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd requireAreaAccess("projects") from @/lib/areaAccess, ` +
          `next to the existing capability/section check.`
        : undefined
    ).toEqual([]);
  });

  it("gates every clients/projects/contacts action (reads included) behind its area, not just a role", () => {
    // requireCapability answers "may I write?"; it says nothing about "does my
    // job function even show me Clients/Projects/Contacts at all". Without
    // this, a function whose hiddenAreas hides clients/projects/contacts
    // still reaches every mutation in it — the same gap requireSectionAccess
    // already closes for project-content mutations above.
    const AREA_BY_FILE: Record<string, string> = {
      "actions/clients/clients.ts": "clients",
      "actions/projects/projects.ts": "projects",
      "actions/contacts/contacts.ts": "clients.contacts",
      "actions/equipment/equipment.ts": "loans",
      "actions/equipmentLoans/equipmentLoans.ts": "loans",
    };
    // Passe 3b, point 1: getClient/getProjectsForClient/getProject used to be
    // exempted here as "reads are exempt — only mutations must check the
    // area". That exemption was the bug, not a rule: role alone (requireRole)
    // let an EDITOR whose function hides clients/projects still pull the full
    // company/chantier row — budget and notes included, the two fields the
    // client portail deliberately never exposes. The exemption is gone now
    // that the guard actually exists; every exported function in these three
    // files, reads included, must call requireAreaAccess.

    const ungated: string[] = [];
    for (const file of Object.keys(AREA_BY_FILE)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fns = functionsIn(source);
      expect(fns.length, `${file} has no exported action — did it move?`).toBeGreaterThan(0);
      for (const fn of fns) {
        if (!fn.exported) continue;
        if (!fn.calls.has("requireAreaAccess")) ungated.push(`${file}::${fn.name}`);
      }
    }

    expect(
      ungated,
      ungated.length
        ? `These actions touch a rubrique but never check its area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd requireAreaAccess("<area>") from @/lib/areaAccess, ` +
          `next to the existing capability/role check.`
        : undefined
    ).toEqual([]);
  });

  it("gates every action that writes to the users table", () => {
    // Privilege escalation is the highest-value target: these must never be
    // reachable without users.manage, whatever the allowlist says.
    const userActions = actions.filter((a) => a.file === "actions/users/users.ts");
    expect(userActions.length).toBeGreaterThan(0);
    for (const action of userActions) {
      expect(action.guarded, `${action.key} must be gated`).toBe(true);
      expect(action.key in INTENTIONALLY_PUBLIC, `${action.key} must never be allowlisted as public`).toBe(false);
    }
  });

  it("gates every CSV export route behind its area, not just requireAppUser", () => {
    // requireAppUser only checks role/session — a caller whose job function
    // hides the rubrique a CSV belongs to must be refused here too, or the
    // export becomes a way around that restriction by direct URL. Mirrors
    // the mutation-area test below, but for GET route handlers.
    const AREA_BY_ROUTE: Record<string, string> = {
      "app/clients/export/route.ts": "clients",
      "app/projects/export/route.ts": "projects",
      "app/clients/contacts/export/route.ts": "clients.contacts",
    };

    const ungated: string[] = [];
    for (const file of Object.keys(AREA_BY_ROUTE)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fns = functionsIn(source);
      const getFn = fns.find((f) => f.exported && f.name === "GET");
      expect(getFn, `${file} has no exported GET handler — did it move?`).toBeDefined();
      if (!getFn!.calls.has("canAccessArea")) ungated.push(`${file}::GET`);
    }

    expect(
      ungated,
      ungated.length
        ? `These export routes never check the caller's area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd canAccessArea("<area>") from @/lib/areaAccess, next to requireAppUser().`
        : undefined
    ).toEqual([]);
  });

  it("gates the guarded asset delivery route and the réserves report route behind the `projects` area, not just their section", () => {
    // canAccessSection (via SECTION_BY_KIND / "reserves") only answers "which
    // of a project's OWN sections may this caller see" — a narrower question
    // that assumes the project itself is already reachable. Without this,
    // hiding the `projects` rubrique from a job function still lets it
    // stream files/plans/photos and download the réserves report by direct
    // URL, exactly the gap a project's own detail page has too (see the test
    // below).
    const AREA_BY_ROUTE: Record<string, string> = {
      "app/api/assets/[kind]/[id]/route.ts": "projects",
      "app/clients/[id]/projects/[projectId]/reserves/report/route.ts": "projects",
    };

    const ungated: string[] = [];
    for (const file of Object.keys(AREA_BY_ROUTE)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fns = functionsIn(source);
      const getFn = fns.find((f) => f.exported && f.name === "GET");
      expect(getFn, `${file} has no exported GET handler — did it move?`).toBeDefined();
      if (!getFn!.calls.has("canAccessArea")) ungated.push(`${file}::GET`);
    }

    expect(
      ungated,
      ungated.length
        ? `These routes never check the caller's area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd canAccessArea("projects") from @/lib/areaAccess, next to requireAppUser().`
        : undefined
    ).toEqual([]);
  });

  it("gates the project detail page behind the `projects` area, not just the project's own scope", () => {
    // canReachProject (lib/accessContext.ts) answers "is THIS project inside
    // my assigned scope" — a data-scoping question, the third access axis.
    // hiddenAreas answers a different, second-axis one: "does the whole
    // `projects` rubrique even exist for my job function at all". Without
    // this, a function with `projects` hidden could still open a project's
    // detail page directly (e.g. a bookmarked URL, or a link surfaced by the
    // still-visible `clients.projects` tab), bypassing the rubrique toggle
    // entirely.
    const file = "app/clients/[id]/projects/[projectId]/page.tsx";
    const source = ts.createSourceFile(
      file,
      readFileSync(join(process.cwd(), file), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const fns = functionsIn(source);
    const pageFn = fns.find((f) => f.exported && f.name === "ProjectDetailPage");
    expect(pageFn, `${file} has no exported ProjectDetailPage — did it get renamed?`).toBeDefined();
    expect(
      pageFn!.calls.has("canAccessArea"),
      `${file} never checks canAccessArea("projects") — a job function with the ` +
        `rubrique hidden can still reach a project's detail page directly.`
    ).toBe(true);
  });

  it("gates the project dashboard page behind the `projects` area and hiddenSections, same as the detail page (adversarial pass 1, #4)", () => {
    // The dashboard is just another view of the same chantier as the detail
    // page above, but it used to skip both axes: a hidden `projects` rubrique
    // still rendered the chantier name/task progress/material stock here, and
    // a function hiding the tasks/materials sections still fetched and
    // rendered them (as props of a Client Component, i.e. into the HTML).
    const file = "app/clients/[id]/projects/[projectId]/dashboard/page.tsx";
    const source = ts.createSourceFile(
      file,
      readFileSync(join(process.cwd(), file), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const fns = functionsIn(source);
    const pageFn = fns.find((f) => f.exported && f.name === "ProjectDashboardPage");
    expect(pageFn, `${file} has no exported ProjectDashboardPage — did it get renamed?`).toBeDefined();
    expect(
      pageFn!.calls.has("canAccessArea"),
      `${file} never checks canAccessArea("projects") — a job function with the ` +
        `rubrique hidden can still reach a project's dashboard directly.`
    ).toBe(true);
    expect(
      pageFn!.calls.has("getHiddenSections"),
      `${file} never checks getHiddenSections() — a function hiding the tasks/materials ` +
        `sections on the detail page can still see them on the dashboard.`
    ).toBe(true);
  });

  it("gates every Administration mutation behind its area, not just its capability/role", () => {
    // Same gap as the clients/projects/contacts area test above, but for the
    // Administration mutations (users, functions, settings):
    // requireCapability/requireRole answer "may I write?", not "does my job
    // function even show me this Admin tab at all?". Without this, a function
    // whose hiddenAreas hides admin.users/functions/settings still reaches
    // every mutation in it.
    const AREA_BY_FILE: Record<string, string> = {
      "actions/users/users.ts": "admin.users",
      "actions/jobFunctions/jobFunctions.ts": "admin.functions",
      "actions/appSettings/appSettings.ts": "admin.settings",
    };

    const ungated: string[] = [];
    for (const file of Object.keys(AREA_BY_FILE)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const fns = functionsIn(source);
      expect(fns.length, `${file} has no exported action — did it move?`).toBeGreaterThan(0);
      for (const fn of fns) {
        if (!fn.exported) continue;
        if (!fn.calls.has("requireAreaAccess")) ungated.push(`${file}::${fn.name}`);
      }
    }

    expect(
      ungated,
      ungated.length
        ? `These Administration mutations never check their area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd requireAreaAccess("<area>") from @/lib/areaAccess, ` +
          `next to the existing capability/role check.`
        : undefined
    ).toEqual([]);
  });

  it("gates every rubrique's landing page behind requireAreaOrRedirect, imported from @/lib/areaAccess", () => {
    // Discovers its targets from AREA_HREFS (lib/appAreas.ts) — the single
    // source of truth for a rubrique's landing route — rather than a
    // hand-maintained list, so a rubrique added there is covered here for
    // free. Same reasoning as tests/route-guard-area-coverage.test.ts, one
    // layer down: that test proves the PROXY redirects an anonymous/CLIENT
    // visitor away from the route; this one proves the PAGE itself also
    // bounces a signed-in caller whose job function hides the rubrique —
    // the gap this closes for `loans` (point 3 of the review).
    //
    // Two rubriques of AREA_HREFS/TOP_LEVEL_APP_AREAS are out of scope here,
    // each checked instead of assumed:
    //  - "admin" has no entry in AREA_HREFS at all — its landing href
    //    depends on which RBAC tab a role/function can open
    //    (lib/adminAccess.ts::getAdminAccess), not a fixed route, so the
    //    generic href -> page.tsx mapping below doesn't apply to it. Its own
    //    mutations are covered by the "Administration mutations" test above.
    //  - "dashboard" (href "/") IS in AREA_HREFS, but is checked by the
    //    dedicated test right below instead of folded into this loop: "/" is
    //    the one href that isn't `app${href}/page.tsx` (that would build
    //    "app/page.tsx" wrongly as "app//page.tsx" via naive concatenation).
    //    Verified directly: app/page.tsx (HomePage) already calls
    //    requireAreaOrRedirect("dashboard") — same mechanism as the other
    //    three, just asserted outside the generic path-building rule.
    const ungated: string[] = [];
    for (const [area, href] of Object.entries(AREA_HREFS)) {
      if (area === "dashboard") continue;
      const file = `app${href}/page.tsx`;
      const rel = file; // already repo-relative
      const source = ts.createSourceFile(
        rel,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const guardNames = collectAreaGuardNames(source, rel);
      const fns = pageFunctionsIn(source).filter((f) => f.exported);
      expect(fns.length, `${file} has no exported page component — did it move?`).toBeGreaterThan(0);
      const resolved = fns.some((f) => bodyCallsAnyOf(f.body, guardNames));
      if (!resolved) ungated.push(`${file} (rubrique "${area}")`);
    }

    expect(
      ungated,
      ungated.length
        ? `These rubrique landing pages never resolve access through requireAreaOrRedirect:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nCall requireAreaOrRedirect("<area>") imported from @/lib/areaAccess — a locally ` +
          `redeclared function of the same name does not count.`
        : undefined
    ).toEqual([]);
  });

  it("gates the dashboard page (\"/\") behind requireAreaOrRedirect too, checked explicitly (see the comment above)", () => {
    const file = "app/page.tsx";
    const source = ts.createSourceFile(
      file,
      readFileSync(join(process.cwd(), file), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const guardNames = collectAreaGuardNames(source, file);
    const pageFn = pageFunctionsIn(source).find((f) => f.exported && f.name === "HomePage");
    expect(pageFn, `${file} has no exported HomePage — did it get renamed?`).toBeDefined();
    expect(
      bodyCallsAnyOf(pageFn!.body, guardNames),
      `${file} never resolves access through requireAreaOrRedirect("dashboard"), imported from @/lib/areaAccess.`
    ).toBe(true);
  });
});
