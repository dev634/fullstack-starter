import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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
  "app/api/health/route.ts::GET": "uptime probe; returns only a status string",
  "app/api/auth/[...nextauth]/route.ts::GET": "Auth.js sign-in endpoints must be reachable logged out",
  "app/api/auth/[...nextauth]/route.ts::POST": "Auth.js sign-in endpoints must be reachable logged out",
};

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function tsFilesIn(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsFilesIn(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every function name called anywhere inside `node`. */
function callsIn(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) names.add(e.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

type Fn = { name: string; exported: boolean; calls: Set<string> };

function functionsIn(source: ts.SourceFile): Fn[] {
  const fns: Fn[] = [];
  ts.forEachChild(source, (node) => {
    // `export async function foo()` and plain `async function helper()`
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      fns.push({ name: node.name.text, exported, calls: callsIn(node.body) });
      return;
    }
    // `const foo = async () => {}` / `export const foo = async () => {}`
    if (ts.isVariableStatement(node)) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
        fns.push({ name: decl.name.text, exported, calls: callsIn(decl.initializer.body) });
      }
    }
  });
  return fns;
}

/**
 * Resolve gates transitively within a file: an action counts as guarded when it
 * calls a gate directly, or calls a local helper that (eventually) does.
 *
 * This matters — actions/users/users.ts gates through a local `requireManager()`
 * wrapper, and a checker that only looked for direct calls would report those
 * actions as unguarded. A test that cries wolf gets muted, so it must not.
 */
function guardedNames(fns: Fn[]): Set<string> {
  const byName = new Map(fns.map((f) => [f.name, f]));
  const guarded = new Set<string>();

  const isGuarded = (fn: Fn, seen: Set<string>): boolean => {
    if (guarded.has(fn.name)) return true;
    if (seen.has(fn.name)) return false; // cycle
    seen.add(fn.name);

    for (const call of fn.calls) {
      if (GUARD_CALLS.has(call)) return true;
      const local = byName.get(call);
      if (local && isGuarded(local, seen)) return true;
    }
    return false;
  };

  for (const fn of fns) if (isGuarded(fn, new Set())) guarded.add(fn.name);
  return guarded;
}

type Action = { key: string; file: string; name: string; guarded: boolean };

function collectActions(): Action[] {
  const actions: Action[] = [];
  for (const file of tsFilesIn(ACTIONS_DIR)) {
    const rel = relative(process.cwd(), file).split(sep).join("/");
    const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const fns = functionsIn(source);
    const guarded = guardedNames(fns);
    for (const fn of fns) {
      if (!fn.exported) continue;
      actions.push({ key: `${rel}::${fn.name}`, file: rel, name: fn.name, guarded: guarded.has(fn.name) });
    }
  }
  return actions;
}

function collectRouteHandlers(): Action[] {
  const handlers: Action[] = [];
  for (const file of tsFilesIn(APP_DIR)) {
    if (!file.endsWith(`${sep}route.ts`)) continue;
    const rel = relative(process.cwd(), file).split(sep).join("/");
    const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const fns = functionsIn(source);
    const guarded = guardedNames(fns);
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
    const OWNED_BY_SECTION = [
      "actions/tasks/tasks.ts",
      "actions/taskGroups/taskGroups.ts",
      "actions/taskCategories/taskCategories.ts",
      "actions/taskAssignee/taskAssignee.ts",
      "actions/projectMaterials/projectMaterials.ts",
      "actions/deliveryNoteScan/deliveryNoteScan.ts",
      "actions/interventions/interventions.ts",
      "actions/subcontractors/subcontractors.ts",
      "actions/interims/interims.ts",
      "actions/projectFiles/projectFiles.ts",
      "actions/reserves/reserves.ts",
    ];

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
});
