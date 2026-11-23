import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { sourceFilesIn, functionsIn, guardedNames, exportInfoOf } from "./helpers/astScan";
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
 * EDITOR profile — see docs/SECURITE-CHECKLIST.md, V8). 13 files now: the
 * feature "catégories de matériel" (actions/materialCategories) is owned by
 * the same `materials` section as actions/projectMaterials, so it belongs on
 * the same list, not a separate one — and "travailleurs"
 * (actions/projectWorkers) is owned by the same `interims` section as
 * actions/interims (there is no dedicated "workers" project-section key; see
 * that file's own doc), for the same reason.
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
  "actions/projectWorkers/projectWorkers.ts",
  "actions/projectFiles/projectFiles.ts",
  "actions/reserves/reserves.ts",
];

/**
 * The section each OWNED_BY_SECTION file belongs to, which every exported
 * action of it must name in requireSectionAccess (lot 5b). Recounted at the
 * source (the requireSectionAccess("…") calls of each file, on 09fbd0b + the lot
 * 5b changes): tasks/taskGroups/taskCategories/taskAssignee -> tasks;
 * projectMaterials/materialCategories/deliveryNoteScan -> materials;
 * interventions -> interventions; subcontractors -> subcontractors;
 * interims/projectWorkers -> interims (workers have no section key of their
 * own); projectFiles -> files; reserves -> reserves. 13 files, 10 distinct
 * calls of the table's own keys. The table is checked equal to
 * OWNED_BY_SECTION: a file added to one and not the other fails.
 */
const SECTION_BY_FILE: Readonly<Record<string, readonly string[]>> = {
  "actions/tasks/tasks.ts": ["tasks"],
  "actions/taskGroups/taskGroups.ts": ["tasks"],
  "actions/taskCategories/taskCategories.ts": ["tasks"],
  "actions/taskAssignee/taskAssignee.ts": ["tasks"],
  "actions/projectMaterials/projectMaterials.ts": ["materials"],
  "actions/materialCategories/materialCategories.ts": ["materials"],
  "actions/deliveryNoteScan/deliveryNoteScan.ts": ["materials"],
  "actions/interventions/interventions.ts": ["interventions"],
  "actions/subcontractors/subcontractors.ts": ["subcontractors"],
  "actions/interims/interims.ts": ["interims"],
  "actions/projectWorkers/projectWorkers.ts": ["interims"],
  "actions/projectFiles/projectFiles.ts": ["files"],
  "actions/reserves/reserves.ts": ["reserves"],
};

/**
 * setAssignee assigns a task (tasks) to a subcontractor company (subcontractors)
 * or to a workforce member (interims): the two latter checks are CONDITIONAL on
 * the kind of assignee, so the action names all three. Disappears the day the
 * assignee kinds are split into their own actions.
 */
const SECTION_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  "actions/taskAssignee/taskAssignee.ts::setAssignee": ["tasks", "subcontractors", "interims"],
};

/**
 * The ONLY guard calls allowed to sit in a branch: setAssignee's second section
 * depends on the kind of assignee, so its two checks are conditional by nature.
 * Everything else must be on a path every call takes. Disappears with the split
 * of setAssignee by assignee kind.
 */
const SECTION_CONDITIONAL: Readonly<Record<string, readonly string[]>> = {
  "actions/taskAssignee/taskAssignee.ts::setAssignee": ["subcontractors", "interims"],
};

/**
 * "Resolved by import" helpers for lib/areaAccess.ts exports (requireAreaOrRedirect,
 * canAccessArea), used by the page-level and report-route tests below. Same
 * technique as tests/project-section-authz-coverage.test.ts's
 * resolveProjectSectionAccess check: matching a bare identifier would also
 * count a locally redeclared function of the same name that never imports
 * the real guard. `collectAreaGuardNames` takes the export name as a
 * parameter rather than being duplicated per export — a third near-identical
 * copy, one per guard name, is exactly the "third caller" this repo's
 * two-occurrence DRY threshold would have to extract anyway.
 */
const ROOT = process.cwd();
const AREA_ACCESS_LIB_FILE = resolve(ROOT, "lib", "areaAccess.ts").toLowerCase();
const AREA_GUARD_EXPORT_NAME = "requireAreaOrRedirect";
const AREA_CAN_ACCESS_EXPORT_NAME = "canAccessArea";

const ACCESS_LIB_FILE = resolve(ROOT, "lib", "access.ts").toLowerCase();

/** Whether import specifier `spec`, written in file `fromRelFile`, resolves to the module at `targetFileLower` (absolute, lower-cased). */
function resolvesToModule(spec: string, fromRelFile: string, targetFileLower: string): boolean {
  let base: string | undefined;
  if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromRelFile), spec);
  if (!base) return false; // a bare package specifier is never this local module
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.some((c) => c.toLowerCase() === targetFileLower);
}

/** Local names bound to the `exportName` export of the module at `targetFileLower`, aliased or not. */
function collectImportedNames(source: ts.SourceFile, relFile: string, targetFileLower: string, exportName: string): Set<string> {
  const names = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!resolvesToModule(stmt.moduleSpecifier.text, relFile, targetFileLower)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === exportName) names.add(el.name.text);
    }
  }
  return names;
}

/**
 * Whether `source` reaches lib/access.ts in a way that does not bind its exports by name:
 * a namespace import (`import * as x`), a default import, a dynamic `import("…")`, a
 * `require("…")`, or an `export … from` re-export. Named imports are what
 * collectImportedNames sees; these are everything else.
 */
function reachesAccessLibWithoutNamedImport(source: ts.SourceFile, relFile: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && resolvesToModule(n.moduleSpecifier.text, relFile, ACCESS_LIB_FILE)) {
      const clause = n.importClause;
      if (clause?.name || (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))) found = true;
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && resolvesToModule(n.moduleSpecifier.text, relFile, ACCESS_LIB_FILE)) {
      found = true;
    }
    if (ts.isCallExpression(n)) {
      const [arg] = n.arguments;
      const dynamicImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const requireCall = ts.isIdentifier(n.expression) && n.expression.text === "require";
      if ((dynamicImport || requireCall) && arg && ts.isStringLiteralLike(arg) && resolvesToModule(arg.text, relFile, ACCESS_LIB_FILE)) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

/** Local names bound to lib/areaAccess.ts's `exportName` export, aliased or not. */
function collectAreaGuardNames(source: ts.SourceFile, relFile: string, exportName: string): Set<string> {
  return collectImportedNames(source, relFile, AREA_ACCESS_LIB_FILE, exportName);
}

type PageFn = { name: string; exported: boolean; body: ts.Node };

/** Top-level named page functions in `source`, keeping the body node (unlike functionsIn above, which only keeps bare call names — not enough to tell an import-resolved call from a same-named local declaration). */
function pageFunctionsIn(source: ts.SourceFile): PageFn[] {
  const fns: PageFn[] = [];
  // `export { f }`, `export default f`, an anonymous default and a re-export are
  // exports too (exportInfoOf): the last two have no named body here, so they
  // are stood in for ("default" = its body; a re-export = its declaration, which
  // calls nothing and therefore fails every guard check).
  const info = exportInfoOf(source);
  ts.forEachChild(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || info.locals.has(node.name.text);
      fns.push({ name: node.name.text, exported, body: node.body });
      return;
    }
    if (ts.isVariableStatement(node)) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
        fns.push({ name: decl.name.text, exported: exported || info.locals.has(decl.name.text), body: decl.initializer.body });
      }
    }
  });
  for (const body of info.anonymousDefaults) fns.push({ name: "default", exported: true, body });
  info.reexports.forEach((name, i) => fns.push({ name, exported: true, body: info.reexportNodes[i] }));
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

/**
 * AREA ARGUMENT, function by function (lot 5b). The tests below used to check
 * that a file calls `requireAreaAccess` / `canAccessArea` SOMEWHERE — the
 * name, not the argument. `requireAreaAccess("projects")` pasted into
 * actions/loans would have stayed green while guarding the wrong rubrique, and
 * so would a guard on the right rubrique in ANOTHER function of the same file
 * (the file "calls it", the function does not). And a table of one value per
 * file cannot say that `createPortalLogin` needs TWO rubriques.
 *
 * So each table below maps a file to the rubrique(s) EVERY exported function of
 * it must name, and `overrides` maps "file::function" to its own list when it
 * differs. A violation is reported per function and per missing rubrique. The
 * guard must be resolved by IMPORT (collectAreaGuardNames): a same-named local
 * function that never imports the real guard counts for nothing. Probes at the
 * bottom of this file prove the four ways to fail (right guard wrong rubrique,
 * right rubrique in another function, a local homonym) and the one way to pass.
 */
type AreaTable = Readonly<Record<string, readonly string[]>>;

/** Every string-literal first argument passed to a call of one of `guardNames` anywhere inside `node`. */
function areasNamedIn(node: ts.Node, guardNames: ReadonlySet<string>): Set<string> {
  const areas = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && guardNames.has(n.expression.text)) {
      const first = n.arguments[0];
      if (first && ts.isStringLiteral(first)) areas.add(first.text);
      else if (!first) areas.add(""); // a guard with no argument (requireEverySectionAccess)
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return areas;
}

/**
 * Violations of `table` in ONE parsed file: every function selected by `pick`
 * must name every rubrique expected of it, through `guardExport` imported from
 * lib/areaAccess. `expectedFor` is the table entry for this file (or the
 * per-function override).
 */
function areaViolationsIn(
  source: ts.SourceFile,
  file: string,
  guardExport: string,
  pick: (fn: PageFn) => boolean,
  expectedFor: (fnName: string) => readonly string[],
  libFile: string = AREA_ACCESS_LIB_FILE,
  conditionalFor: (fnName: string) => readonly string[] = () => []
): string[] {
  const guardNames = collectImportedNames(source, file, libFile, guardExport);
  const violations: string[] = [];
  // requireAreaAccess / requireSectionAccess RETURN a refusal: they protect
  // nothing unless the action tests the result and leaves, in its own body,
  // before any effect (lot 5b). The other area guards (canAccessArea in a route,
  // requireAreaOrRedirect in a page) decide by their own control flow and stay
  // on the by-argument check.
  const mustRefuse = RETURNING_GUARDS.has(guardExport);
  const bindings = new Map([...guardNames].map((local) => [local, guardExport] as const));
  const effects = mustRefuse ? effectModelOf(source, file) : undefined;
  for (const fn of pageFunctionsIn(source).filter(pick)) {
    const named = areasNamedIn(fn.body, guardNames);
    const sites = mustRefuse ? guardCallSites(fn.body, bindings, true) : [];
    const effectNodes = effects ? effectCallsIn(fn.body, effects) : [];
    for (const area of expectedFor(fn.name)) {
      if (!named.has(area)) {
        violations.push(`${file}::${fn.name} — never calls ${guardExport}("${area}")`);
      } else if (mustRefuse) {
        const mayBeConditional = conditionalFor(fn.name).includes(area);
        const honoured = sites.some((site) => (site.firstArg ?? "") === area && siteHonoured(site, fn.body, effectNodes, mayBeConditional));
        if (!honoured) {
          violations.push(
            `${file}::${fn.name} — calls ${guardExport}("${area}") but does not REFUSE on it ` +
              `(result bound and never reassigned, its .error tested by an if that exits — a throw only if no catch swallows it — ` +
              `on a path every call takes, in the action body, before any write, none of them inside the refusal branch or a finally)`
          );
        }
      }
    }
  }
  return violations;
}

/** The returning guards of lib/areaAccess and lib/sectionAccess: their result must be tested and acted on. */
const RETURNING_GUARDS: ReadonlySet<string> = new Set(["requireAreaAccess", "requireSectionAccess", "requireEverySectionAccess"]);

/**
 * Nodes between `node` and `body` that make it run only SOMETIMES: a branch of
 * an if, a conditional expression, a loop (it may not run), a switch case, a
 * catch or finally clause, the right side of && / || / ??. A guard that sits in
 * one is not a guard of the action. The plain block of the function and the
 * block of a try are not conditions.
 */
function isUnconditional(node: ts.Node, body: ts.Node): boolean {
  for (let cur: ts.Node = node; cur.parent && cur !== body; cur = cur.parent) {
    const p = cur.parent;
    if (ts.isIfStatement(p) || ts.isConditionalExpression(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isCatchClause(p)) return false;
    if (ts.isIterationStatement(p, false)) return false;
    if (ts.isTryStatement(p) && p.tryBlock !== cur) return false;
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) return false;
    }
  }
  return true;
}

/**
 * Whether ONE guard call really protects the action: bound and refused by a
 * valid if (guardCallSites), in the action's own body (not a closure), on a
 * path every call takes (unless this action is explicitly allowed a
 * conditional guard), with no effect before it, none INSIDE the refusal branch
 * (`if (c.error) { await update(); return }` writes, then refuses), and none in
 * the finally of a try that holds the refusal (a `return` still runs it).
 */
function siteHonoured(site: GuardCallSite, body: ts.Node, effects: readonly ts.CallExpression[], mayBeConditional: boolean): boolean {
  if (site.nested) return false;
  if (!mayBeConditional && !isUnconditional(site.callNode, body)) return false;
  return site.refusals.some((refusal) => {
    if (!mayBeConditional && !isUnconditional(refusal, body)) return false;
    const refusedUntil = refusal.thenStatement.getEnd();
    if (effects.some((e) => e.getStart() < refusedUntil)) return false;
    for (let cur: ts.Node = refusal; cur.parent && cur !== body; cur = cur.parent) {
      const p = cur.parent;
      if (ts.isTryStatement(p) && p.tryBlock === cur && p.finallyBlock) {
        const fin = p.finallyBlock;
        if (effects.some((e) => e.getStart() >= fin.getStart() && e.getEnd() <= fin.getEnd())) return false;
      }
    }
    return true;
  });
}

/**
 * The effect model of a file: which calls WRITE (or reach out). Modules, by
 * repo-relative path whatever the import style (alias "@/…" or relative):
 *   - repository/, service/ and lib/cloudinary, lib/deliveryNoteScan (an LLM
 *     call), lib/rate-limit (registerFailure), lib/email: a call counts unless
 *     its imported name reads (find/get/count/has/is/list/search/exists);
 *   - lib/prisma: ANY call rooted at the imported client counts.
 * Named imports bind a function name; a namespace / default import (and
 * `const m = await import("…")`) binds a root, whose member is judged the same
 * way.
 */
type EffectModel = { fnNames: Set<string>; nsRoots: Set<string>; allRoots: Set<string> };

const WRITE_LAYER_MODULES: ReadonlySet<string> = new Set(["lib/cloudinary", "lib/deliveryNoteScan", "lib/rate-limit", "lib/email"]);
const READ_NAME = /^(find|get|count|has|is|list|search|exists)/;

/** Repo-relative module path of an import specifier written in `relFile`, without extension or /index. */
function moduleKey(spec: string, relFile: string): string | undefined {
  let abs: string | undefined;
  if (spec.startsWith("@/")) abs = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) abs = resolve(dirname(resolve(ROOT, relFile)), spec);
  if (!abs) return undefined;
  return relative(ROOT, abs).split(sep).join("/").replace(/[.]tsx?$/, "").replace(/[/]index$/, "");
}

function layerOf(spec: string, relFile: string): "write-layer" | "prisma" | undefined {
  const key = moduleKey(spec, relFile);
  if (key === undefined) return undefined;
  if (key === "lib/prisma") return "prisma";
  if (key.startsWith("repository/") || key.startsWith("service/") || WRITE_LAYER_MODULES.has(key)) return "write-layer";
  return undefined;
}

function effectModelOf(source: ts.SourceFile, relFile: string): EffectModel {
  const model: EffectModel = { fnNames: new Set(), nsRoots: new Set(), allRoots: new Set() };
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const layer = layerOf(stmt.moduleSpecifier.text, relFile);
    if (!layer) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    const bindings = clause.namedBindings;
    if (clause.name) (layer === "prisma" ? model.allRoots : model.nsRoots).add(clause.name.text);
    if (bindings && ts.isNamespaceImport(bindings)) (layer === "prisma" ? model.allRoots : model.nsRoots).add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if (layer === "prisma") model.allRoots.add(el.name.text);
        else if (!READ_NAME.test((el.propertyName ?? el.name).text)) model.fnNames.add(el.name.text);
      }
    }
  }
  // const m = await import("@/repository/x")
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer;
      while (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isCallExpression(init) && init.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = init.arguments[0];
        const layer = arg && ts.isStringLiteralLike(arg) ? layerOf(arg.text, relFile) : undefined;
        if (layer) (layer === "prisma" ? model.allRoots : model.nsRoots).add(n.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return model;
}

/** Every call inside `body` that the effect model counts as a write / outward call. */
function effectCallsIn(body: ts.Node, model: EffectModel): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee)) {
        if (model.fnNames.has(callee.text) || model.allRoots.has(callee.text)) calls.push(n);
      } else if (ts.isPropertyAccessExpression(callee)) {
        let root: ts.Expression = callee;
        while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root) || ts.isCallExpression(root)) root = root.expression;
        if (ts.isIdentifier(root)) {
          if (model.allRoots.has(root.text)) calls.push(n);
          else if (model.nsRoots.has(root.text) && !READ_NAME.test(callee.name.text)) calls.push(n);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return calls;
}

/** The same, over every file of a table read from disk. `overrides` keys are "file::function". */
function areaViolations(
  table: AreaTable,
  guardExport: string,
  pick: (fn: PageFn) => boolean,
  overrides: AreaTable = {},
  libFile: string = AREA_ACCESS_LIB_FILE,
  conditional: AreaTable = {}
): string[] {
  const violations: string[] = [];
  for (const [file, expected] of Object.entries(table)) {
    const source = ts.createSourceFile(file, readFileSync(join(process.cwd(), file), "utf8"), ts.ScriptTarget.Latest, true);
    const picked = pageFunctionsIn(source).filter(pick);
    expect(picked.length, `${file} has nothing to check — did it move?`).toBeGreaterThan(0);
    violations.push(...areaViolationsIn(source, file, guardExport, pick, (name) => overrides[`${file}::${name}`] ?? expected, libFile, (name) => conditional[`${file}::${name}`] ?? []));
  }
  return violations;
}

const REQUIRE_AREA_ACCESS = "requireAreaAccess";
const REQUIRE_SECTION_ACCESS = "requireSectionAccess";
const SECTION_ACCESS_LIB_FILE = resolve(ROOT, "lib", "sectionAccess.ts").toLowerCase();
const exportedFn = (fn: PageFn) => fn.exported;
const exportedGet = (fn: PageFn) => fn.exported && fn.name === "GET";

/**
 * REFUSAL, not just a call. A scope guard (requireProjectAccess & co.) returns a
 * result; it protects nothing unless the caller TESTS that result and leaves.
 * `await requireProjectAccess(id);` on its own is "a call to the guard" and
 * lets every refusal through — a call-only scan certifies it. The accepted form
 * is the one the codebase uses everywhere:
 *
 *   const check = await guard(...);          // result bound to a plain variable
 *   if (check.error) return ... / throw ...; // .error tested by an `if` that exits
 *
 * (`if (check.error !== null)` is accepted too.) Destructuring the result or
 * testing it through anything else is NOT accepted: it is not a form this
 * codebase uses, and an unrecognized form fails closed rather than passing.
 */
function unwrapExpression(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAwaitExpression(cur)) cur = cur.expression;
  return cur;
}

/** `name.error`, or `name.error !== null` / `!= null`. */
function isErrorTest(cond: ts.Expression, name: string): boolean {
  const c = unwrapExpression(cond);
  if (ts.isPropertyAccessExpression(c)) {
    return ts.isIdentifier(c.expression) && c.expression.text === name && c.name.text === "error";
  }
  if (
    ts.isBinaryExpression(c) &&
    (c.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      c.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)
  ) {
    return c.right.kind === ts.SyntaxKind.NullKeyword && isErrorTest(c.left, name);
  }
  return false;
}

/** A branch that leaves the function: a `return`/`throw`, bare or as a statement of its block. */
function exitsFunction(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  return ts.isBlock(stmt) && stmt.statements.some((s) => ts.isReturnStatement(s) || ts.isThrowStatement(s));
}

type GuardCallSite = {
  exportName: string;
  line: number;
  refused: boolean;
  /** Where the first valid refusing `if` starts (source position), when `refused`. */
  refusalPos: number | undefined;
  /** The guard call sits in a function nested in the action (a closure that may never run), not in the action itself. */
  nested: boolean;
  /** The string-literal first argument of the call (the area / section it names), if it is one. */
  firstArg: string | undefined;
  /** The guard call itself. */
  callNode: ts.CallExpression;
  /** EVERY `if (check.error) <exit>` that is a valid refusal of this call (not reassigned before it, not a swallowed throw). */
  refusals: ts.IfStatement[];
};

/** `x = …`, `x += …`, `x++` on the plain identifier `name` or on one of its properties (`name.error = null`). */
function assignsTo(n: ts.Node, name: string): boolean {
  const rootIs = (e: ts.Expression): boolean => {
    let cur = e;
    while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isParenthesizedExpression(cur)) cur = cur.expression;
    return ts.isIdentifier(cur) && cur.text === name;
  };
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment) return rootIs(n.left);
  }
  if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
    return rootIs(n.operand);
  }
  return false;
}

/** Whether `stmt` leaves by a `return` (not only by a `throw`, which an enclosing `catch` may swallow). */
function exitsByReturn(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt)) return true;
  return ts.isBlock(stmt) && stmt.statements.some((s) => ts.isReturnStatement(s));
}

/** A `throw` exit inside a `try` whose `catch` does not itself leave the function: the refusal is swallowed and execution continues. */
function throwIsSwallowed(ifNode: ts.IfStatement, body: ts.Node): boolean {
  for (let cur: ts.Node = ifNode; cur.parent && cur !== body; cur = cur.parent) {
    const p = cur.parent;
    if (ts.isTryStatement(p) && p.tryBlock === cur && p.catchClause && !exitsFunction(p.catchClause.block)) return true;
  }
  return false;
}

/**
 * Every call to a guard (`guardNames`: local name -> the lib/access export it
 * is bound to) inside `body`, each with whether its result is bound to a
 * variable whose `.error` is tested, AFTER the call, by an `if` that exits.
 * A refusal is valid only if the variable is not reassigned (nor its `.error`
 * overwritten) between the call and the `if`, and — when it leaves by `throw`
 * only — no enclosing `try` swallows the throw (lot 5b, point 3).
 */
function guardCallSites(body: ts.Node, guardNames: ReadonlyMap<string, string>, strict = false): GuardCallSite[] {
  const sites: GuardCallSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && guardNames.has(n.expression.text)) {
      const exportName = guardNames.get(n.expression.text)!;
      const line = n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;
      // Climb through `await` and parentheses to the declaration that binds the result.
      let parent: ts.Node = n.parent;
      while (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
      const refusals: ts.IfStatement[] = [];
      let nested = false;
      const firstArgNode = n.arguments[0];
      const firstArg = firstArgNode && ts.isStringLiteralLike(firstArgNode) ? firstArgNode.text : undefined;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        const varName = parent.name.text;
        const after = n.end;
        // The `if` must sit at the level of the function that CALLS the guard: a refusal written inside a
        // nested closure that is never invoked (`const never = () => { if (c.error) return c.error; }`)
        // refuses nothing. So the search starts at the nearest enclosing function body and never enters a
        // nested function.
        let scope: ts.Node = n.parent;
        while (scope !== body && scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;
        nested = scope !== body;
        const searchRoot =
          (ts.isFunctionDeclaration(scope) || ts.isArrowFunction(scope) || ts.isFunctionExpression(scope) || ts.isMethodDeclaration(scope)) && scope.body
            ? scope.body
            : body;
        const assignments: number[] = [];
        const candidates: ts.IfStatement[] = [];
        const find = (m: ts.Node) => {
          if (m !== searchRoot && ts.isFunctionLike(m)) return;
          if (m.pos >= after && assignsTo(m, varName)) assignments.push(m.getStart());
          if (ts.isIfStatement(m) && m.pos >= after && isErrorTest(m.expression, varName) && exitsFunction(m.thenStatement)) candidates.push(m);
          ts.forEachChild(m, find);
        };
        find(searchRoot);
        for (const c of candidates) {
          // Strict (requireAreaAccess / requireSectionAccess): a per-row loop that CATCHES a thrown
          // refusal and moves on to the next row is a legitimate pattern of the freeze guards
          // (actions/contacts importContacts), so only the area/section checks refuse it.
          const reassigned = strict && assignments.some((pos) => pos < c.getStart());
          const swallowed = strict && !exitsByReturn(c.thenStatement) && throwIsSwallowed(c, searchRoot);
          if (!reassigned && !swallowed) refusals.push(c);
        }
      }
      sites.push({
        exportName,
        line,
        refused: refusals.length > 0,
        refusalPos: refusals[0]?.getStart(),
        nested,
        firstArg,
        callNode: n,
        refusals,
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return sites;
}

/** Local name -> lib/access export name, for the given exports, aliased or not. */
function accessGuardBindings(source: ts.SourceFile, relFile: string, exportNames: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const exportName of exportNames) {
    for (const local of collectImportedNames(source, relFile, ACCESS_LIB_FILE, exportName)) map.set(local, exportName);
  }
  return map;
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

  it("gates every section-owned action behind ITS section (by argument, resolved by import), and refuses on it", () => {
    // The capability matrix answers "may I write?"; it says nothing about
    // "may I touch Matériel at all?". Without this, a job function barred from
    // a section still reaches every mutation in it — which is what
    // JobFunction.hiddenSections used to be: a filter on one page's render.
    // Lot 5b: the section is READ, not just the name of the guard —
    // requireSectionAccess("materials") pasted into actions/tasks used to be
    // "a call to requireSectionAccess" and stayed green. The table below says
    // which section each file owns; the guard must be imported from
    // lib/sectionAccess and the action must REFUSE on its result (same control
    // as requireAreaAccess above).
    expect(Object.keys(SECTION_BY_FILE).sort(), "SECTION_BY_FILE and OWNED_BY_SECTION name different files").toEqual([...OWNED_BY_SECTION].sort());
    const ungated = areaViolations(SECTION_BY_FILE, REQUIRE_SECTION_ACCESS, exportedFn, SECTION_OVERRIDES, SECTION_ACCESS_LIB_FILE, SECTION_CONDITIONAL);

    expect(
      ungated,
      ungated.length
        ? `These actions belong to a project section but never check it (or never refuse on it):\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd the section the table assigns, bound and tested: const sectionCheck = await requireSectionAccess("<section>"); ` +
          `if (sectionCheck.error) return ..., from @/lib/sectionAccess, next to the existing capability check.`
        : undefined
    ).toEqual([]);
  });

  it("a PERMANENT deletion refuses an account whose function hides any project section (requireEverySectionAccess, with a refusal)", () => {
    // The cascade of a company or a chantier takes every section with it (tasks,
    // materials, files and their Cloudinary blobs, plans, réserves, interventions,
    // subcontractors, interims, workers) and, for a company, its contacts: the
    // account must be allowed ALL of them. Trashing is reversible and is not here.
    const violations = areaViolations(
      { "actions/projects/projects.ts": [""], "actions/clients/clients.ts": [""] },
      "requireEverySectionAccess",
      (fn) => fn.exported && fn.name.startsWith("permanentlyDelete"),
      {},
      SECTION_ACCESS_LIB_FILE
    );
    expect(violations).toEqual([]);
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
    // gate belongs behind both. Lot 5b: by ARGUMENT, function by function —
    // every exported action must call requireAreaAccess("projects").
    const ungated = areaViolations(
      Object.fromEntries(OWNED_BY_SECTION.map((file) => [file, ["projects"]])),
      REQUIRE_AREA_ACCESS,
      exportedFn
    );

    expect(
      ungated,
      ungated.length
        ? `These actions belong to a project but never check the projects area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd requireAreaAccess("projects") imported from @/lib/areaAccess, ` +
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
    // Lot 5b: the values are READ now — each exported function must call
    // requireAreaAccess with every rubrique listed for its file. A list holds
    // several when the file's actions need several: createPortalLogin creates a
    // login (admin.users) for a contact (clients.contacts), and both are also
    // proven by tests/portal-actions.test.ts. The portal file has ONE exported
    // action; a second one added there must name both too, or be given its own
    // entry in the `overrides` argument of areaViolations (as
    // permanentlyDeleteClient is, just below).
    const AREA_BY_FILE: AreaTable = {
      "actions/clients/clients.ts": ["clients"],
      "actions/projects/projects.ts": ["projects"],
      "actions/contacts/contacts.ts": ["clients.contacts"],
      "actions/portal/portal.ts": ["admin.users", "clients.contacts"],
      "actions/equipment/equipment.ts": ["loans"],
      "actions/equipmentLoans/equipmentLoans.ts": ["loans"],
    };
    // Passe 3b, point 1: getClient/getProjectsForClient/getProject used to be
    // exempted here as "reads are exempt — only mutations must check the
    // area". That exemption was the bug, not a rule: role alone (requireRole)
    // let an EDITOR whose function hides clients/projects still pull the full
    // company/chantier row — budget and notes included, the two fields the
    // client portail deliberately never exposes. The exemption is gone now
    // that the guard actually exists; every exported function in these three
    // files, reads included, must call requireAreaAccess.

    // permanentlyDeleteClient destroys a company AND, by onDelete: Cascade, its
    // chantiers and contacts: it needs the `projects` and `clients.contacts`
    // rubriques too (lot 5b). Only this action — trashing is reversible and stays
    // on `clients`.
    const ungated = areaViolations(AREA_BY_FILE, REQUIRE_AREA_ACCESS, exportedFn, {
      "actions/clients/clients.ts::permanentlyDeleteClient": ["clients", "projects", "clients.contacts"],
    });

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
    // Lot 5b: by ARGUMENT — canAccessArea("clients") pasted into the projects
    // export would have been "a call to canAccessArea" and stayed green.
    const AREA_BY_ROUTE: AreaTable = {
      "app/clients/export/route.ts": ["clients"],
      "app/projects/export/route.ts": ["projects"],
      "app/clients/contacts/export/route.ts": ["clients.contacts"],
    };

    const ungated = areaViolations(AREA_BY_ROUTE, AREA_CAN_ACCESS_EXPORT_NAME, exportedGet);

    expect(
      ungated,
      ungated.length
        ? `These export routes never check the caller's area:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd canAccessArea("<area>") from @/lib/areaAccess, next to requireAppUser().`
        : undefined
    ).toEqual([]);
  });

  it("gates every report route behind the `projects` area, discovered by glob rather than a hand-written list", () => {
    // A hand-written file list only ever protects the files it already
    // names — exactly the OWNED_BY_SECTION trap (docs/CONVENTIONS.md,
    // "Tests — le piège récurrent"): `actions/materialCategories` (PR #228)
    // went unguarded through an entire implementation because no list named
    // it yet. Every report — the six under dashboard/report/ plus the
    // réserves one — lives under a `report` folder, so this discovers them
    // by walking app/ (sourceFilesIn, already used above) and filtering on
    // that folder segment, the same "table that defines the domain" move
    // tests/project-section-authz-coverage.test.ts makes from
    // PROJECT_SECTION_ROUTES rather than a file list of its own.
    const reportRouteFiles = sourceFilesIn(APP_DIR, [".ts"])
      .map((file) => relative(process.cwd(), file).split(sep).join("/"))
      .filter((file) => file.endsWith("/route.ts") && file.split("/").includes("report"));

    // Exact count, not a floor: `toBeGreaterThan(3)` stayed green even if half
    // these routes vanished from the glob. Recounted at this commit: 7 (5
    // per-section dashboard reports + the whole-dashboard report + réserves).
    // Adding a genuine 8th report route bumps this number too — that's the
    // point, it forces a human to notice the domain grew.
    expect(reportRouteFiles.length, "report route count changed — recount and update this expectation").toBe(7);

    const ungated: string[] = [];
    for (const file of reportRouteFiles) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(process.cwd(), file), "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
      const getFn = pageFunctionsIn(source).find((f) => f.exported && f.name === "GET");
      expect(getFn, `${file} has no exported GET handler — did it move?`).toBeDefined();
      // The call must be resolved by import AND name this rubrique:
      // canAccessArea("clients") pasted into a project report route would
      // still be "a call to canAccessArea" while checking the wrong rubrique.
      // The ONE mechanism for that control is areaViolationsIn (areasNamedIn).
      ungated.push(...areaViolationsIn(source, file, AREA_CAN_ACCESS_EXPORT_NAME, exportedGet, () => ["projects"]));
    }

    expect(
      ungated,
      ungated.length
        ? `These report routes never check the caller's area for "projects":\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nAdd canAccessArea("projects") from @/lib/areaAccess, next to requireAppUser().`
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
    // Lot 5b: by ARGUMENT, like the report routes above.
    const AREA_BY_ROUTE: AreaTable = {
      "app/api/assets/[kind]/[id]/route.ts": ["projects"],
      "app/clients/[id]/projects/[projectId]/reserves/report/route.ts": ["projects"],
    };

    const ungated = areaViolations(AREA_BY_ROUTE, AREA_CAN_ACCESS_EXPORT_NAME, exportedGet);

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
    // Lot 5b: by ARGUMENT, and resolved by import, like the tables above.
    expect(
      areaViolationsIn(source, file, AREA_CAN_ACCESS_EXPORT_NAME, (f) => f.exported && f.name === "ProjectDetailPage", () => ["projects"]),
      `${file} never checks canAccessArea("projects") — a job function with the ` +
        `rubrique hidden can still reach a project's detail page directly.`
    ).toEqual([]);
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
    // Lot 5b: by ARGUMENT, and resolved by import, like the tables above.
    expect(
      areaViolationsIn(source, file, AREA_CAN_ACCESS_EXPORT_NAME, (f) => f.exported && f.name === "ProjectDashboardPage", () => ["projects"]),
      `${file} never checks canAccessArea("projects") — a job function with the ` +
        `rubrique hidden can still reach a project's dashboard directly.`
    ).toEqual([]);
    // Resolved by IMPORT from lib/sectionAccess, not by the bare name: a local
    // function called getHiddenSections would satisfy the name alone.
    const hiddenSectionsNames = collectImportedNames(source, file, SECTION_ACCESS_LIB_FILE, "getHiddenSections");
    const dashboardFn = pageFunctionsIn(source).find((f) => f.exported && f.name === "ProjectDashboardPage");
    expect(
      dashboardFn !== undefined && bodyCallsAnyOf(dashboardFn.body, hiddenSectionsNames),
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
    // Lot 5b: by ARGUMENT, function by function.
    const AREA_BY_FILE: AreaTable = {
      "actions/users/users.ts": ["admin.users"],
      "actions/jobFunctions/jobFunctions.ts": ["admin.functions"],
      "actions/appSettings/appSettings.ts": ["admin.settings"],
    };

    const ungated = areaViolations(AREA_BY_FILE, REQUIRE_AREA_ACCESS, exportedFn);

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
      const guardNames = collectAreaGuardNames(source, rel, AREA_GUARD_EXPORT_NAME);
      const fns = pageFunctionsIn(source).filter((f) => f.exported);
      expect(fns.length, `${file} has no exported page component — did it move?`).toBeGreaterThan(0);
      // The call must name THIS rubrique: requireAreaOrRedirect("projects")
      // pasted into app/loans/page.tsx would still be "a call to the guard"
      // while gating the wrong area (delta audit, Low).
      const resolved = fns.some((f) => areasNamedIn(f.body, guardNames).has(area));
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
    const guardNames = collectAreaGuardNames(source, file, AREA_GUARD_EXPORT_NAME);
    const pageFn = pageFunctionsIn(source).find((f) => f.exported && f.name === "HomePage");
    expect(pageFn, `${file} has no exported HomePage — did it get renamed?`).toBeDefined();
    expect(
      bodyCallsAnyOf(pageFn!.body, guardNames),
      `${file} never resolves access through requireAreaOrRedirect("dashboard"), imported from @/lib/areaAccess.`
    ).toBe(true);
  });

  // ---------------------------------------------------------------------
  // F10 — the content of a project in the trash (or under a company in the
  // trash) is frozen. lib/access.ts::requireProjectAccess now reads the trash
  // state; these two tests make sure every project-content action actually
  // goes through it, and that its inverse stays confined to restore/destroy.
  // ---------------------------------------------------------------------

  /**
   * Exported OWNED_BY_SECTION actions that write nothing under a project, so
   * have no trash state to check. Each carries its reason AND the condition of
   * its disappearance; the test below fails if an exempt action starts calling
   * requireProjectAccess (stale exemption) or disappears.
   */
  const PROJECT_ACCESS_EXEMPT: Record<string, string> = {
    "actions/deliveryNoteScan/deliveryNoteScan.ts::scanDeliveryNote":
      "reads one uploaded photo and returns a preview. It does read a `projectId` from the form — " +
      "unvalidated, not even sent by the UI today — but only to write it into logScanEvent, a console.log; " +
      "that id is never resolved, and nothing is read or written under a project (its write step, " +
      "applyDeliveryNoteScan, is guarded). Disappears the day it uses that id for anything else, or reads or " +
      "writes a project's data: it must then call requireProjectAccess and leave this list.",
  };

  /**
   * How many actions of OWNED_BY_SECTION the test below looks at (exempt ones
   * included), and how many it requires to call requireProjectAccess AND
   * refuse on its result.
   * Recounted by AST (pageFunctionsIn, exported only — top-level `function`
   * and `const f = () => {}` declarations, helpers that are not exported
   * excluded) on the working tree above 3bff9d8, before any commit of this
   * change: 13 files, 47 exported actions, 1 exempt, 46 covered. The commit
   * that carries this line is not known when it is written — an earlier
   * wording cited 5c68150 "plus this change", a base that is not the state
   * counted; re-date it at the next recount.
   * An EXACT count, not a floor: a file dropped from OWNED_BY_SECTION, or an
   * action removed from one, must make this fail rather than shrink the
   * domain silently. Update it, with the method above, when an action is added.
   */
  const OWNED_ACTIONS_EXPECTED = 47;
  const PROJECT_ACCESS_COVERED_EXPECTED = 46;

  type GuardUse = { calls: boolean; unrefused: number[] };

  /**
   * Every exported action of OWNED_BY_SECTION: key -> whether its body calls
   * requireProjectAccess imported from @/lib/access, and the lines of the
   * calls whose result is not tested by an `if` that exits (guardCallSites).
   */
  function ownedActionsCallingProjectAccess(): Map<string, GuardUse> {
    const result = new Map<string, GuardUse>();
    for (const file of OWNED_BY_SECTION) {
      const source = ts.createSourceFile(file, readFileSync(join(process.cwd(), file), "utf8"), ts.ScriptTarget.Latest, true);
      const bindings = accessGuardBindings(source, file, ["requireProjectAccess"]);
      for (const fn of pageFunctionsIn(source)) {
        if (!fn.exported) continue;
        const sites = guardCallSites(fn.body, bindings);
        result.set(`${file}::${fn.name}`, { calls: sites.length > 0, unrefused: sites.filter((s) => !s.refused).map((s) => s.line) });
      }
    }
    return result;
  }

  it("every project-content action calls requireProjectAccess (imported from @/lib/access) and REFUSES on its result, so the trash freezes it", () => {
    const actions = ownedActionsCallingProjectAccess();

    const missing = [...actions].filter(([key, use]) => !use.calls && !(key in PROJECT_ACCESS_EXEMPT)).map(([key]) => key);
    expect(
      missing,
      missing.length
        ? `These project-content actions never call requireProjectAccess directly:\n` +
          missing.map((k) => `  - ${k}`).join("\n") +
          `\n\nCall it with the project id RESOLVED FROM THE DATABASE (imported from @/lib/access — an alias ` +
          `of another module or a call through an intermediate variable does not count). ` +
          `Without it the action still writes under a project in the trash.`
        : undefined
    ).toEqual([]);

    // A call that does not refuse is a decoration: `await requireProjectAccess(id);` alone passes every
    // refusal through. The result must be bound and its `.error` tested by an `if` that returns or throws.
    const unrefused = [...actions].filter(([, use]) => use.unrefused.length > 0).map(([key, use]) => `${key} (line ${use.unrefused.join(", ")})`);
    expect(
      unrefused,
      unrefused.length
        ? `These actions call requireProjectAccess but never act on a refusal:\n` +
          unrefused.map((k) => `  - ${k}`).join("\n") +
          `\n\nBind the result (\`const scopeCheck = await requireProjectAccess(id)\`) and ` +
          `\`if (scopeCheck.error) return ...\` (or throw): a call whose result is ignored refuses nothing.`
        : undefined
    ).toEqual([]);

    // Exemptions must stay true: an exempt action that exists and does NOT call it.
    for (const key of Object.keys(PROJECT_ACCESS_EXEMPT)) {
      expect(actions.has(key), `PROJECT_ACCESS_EXEMPT names ${key}, which no longer exists — drop the exemption.`).toBe(true);
      expect(actions.get(key)?.calls, `${key} now calls requireProjectAccess — drop its exemption.`).toBe(false);
    }

    // The discovered domain has an exact size (see the constants above).
    expect(actions.size).toBe(OWNED_ACTIONS_EXPECTED);
    expect(actions.size - Object.keys(PROJECT_ACCESS_EXEMPT).length).toBe(PROJECT_ACCESS_COVERED_EXPECTED);
  });

  // ---------------------------------------------------------------------
  // The freeze for the writes that are NOT project content: the project row
  // itself (actions/projects), and the company, its contacts and its portal
  // logins (actions/clients, actions/contacts, actions/portal) — guarded by
  // requireProjectAccess / requireTrashedProjectAccess / requireClientAccess /
  // requireFullClientAccess instead of the OWNED_BY_SECTION pair above.
  // ---------------------------------------------------------------------

  /** The scope guards of lib/access.ts that decide on the trash. */
  const FREEZE_GUARD_EXPORTS = [
    "requireProjectAccess",
    "requireTrashedProjectAccess",
    "requireClientAccess",
    "requireClientAccessWithin",
    "requireFullClientAccess",
  ] as const;

  /**
   * Each exported action of the discovered files -> the guard(s) it must
   * reach AND refuse on (any one of them). "Reach" includes a helper of the
   * same file that does (actions/contacts/contacts.ts::findContactInScope).
   * Update this table, not the test, when an action is added: an action that
   * is in neither this table nor FREEZE_EXEMPT fails the test.
   */
  const FREEZE_EXPECTED: Record<string, readonly string[]> = {
    "actions/projects/projects.ts::addProject": ["requireClientAccess"],
    "actions/projects/projects.ts::updateProject": ["requireProjectAccess"],
    "actions/projects/projects.ts::deleteProject": ["requireProjectAccess"],
    "actions/projects/projects.ts::restoreProject": ["requireTrashedProjectAccess"],
    "actions/projects/projects.ts::permanentlyDeleteProject": ["requireTrashedProjectAccess"],
    "actions/projects/projects.ts::importProjects": ["requireClientAccessWithin"],
    "actions/clients/clients.ts::updateClient": ["requireClientAccess"],
    "actions/clients/clients.ts::deleteClient": ["requireFullClientAccess"],
    "actions/clients/clients.ts::restoreClient": ["requireFullClientAccess"],
    "actions/clients/clients.ts::permanentlyDeleteClient": ["requireFullClientAccess"],
    "actions/contacts/contacts.ts::addContact": ["requireClientAccess"],
    "actions/contacts/contacts.ts::editContact": ["requireClientAccess"],
    "actions/contacts/contacts.ts::setPrimaryContact": ["requireClientAccess"],
    "actions/contacts/contacts.ts::deleteContact": ["requireClientAccess"],
    "actions/contacts/contacts.ts::importContacts": ["requireClientAccessWithin"],
    "actions/portal/portal.ts::createPortalLogin": ["requireClientAccess"],
  };

  /**
   * Exported actions of those files that need no freeze guard, each with its
   * reason AND the condition of its disappearance. The test fails if an
   * exempt action starts calling one of the guards (stale exemption) or no
   * longer exists.
   */
  const FREEZE_EXEMPT: Record<string, string> = {
    "actions/projects/projects.ts::getProject":
      "a read: nothing to freeze. Its visibility rule is projectTrashState (lib/projectTrash.ts), the same formula " +
      "requireProjectAccess reads, pinned by the 'visibility reads' test below. Disappears the day it writes.",
    "actions/clients/clients.ts::addClient":
      "creates a NEW company: no existing row is under a trash to respect. Disappears the day it updates an existing company.",
    "actions/clients/clients.ts::importClients":
      "creates new companies (an existing email is reported as a duplicate, never updated): no existing row is " +
      "written. Disappears the day an import updates an existing company.",
    "actions/clients/clients.ts::getClient":
      "a read: nothing to freeze. It answers 'not found' for a company in the trash (client.deletedAt) and for one " +
      "out of scope. Disappears the day it writes.",
    "actions/clients/clients.ts::deleteClients":
      "bulk TRASHING of companies: guarded by fullyAccessibleClientIds (a filter over the batch, not a refusal " +
      "to test) and it skips a row already in the trash (existing.deletedAt) — it writes the company's own " +
      "trash flag, nothing under a frozen company. Disappears the day it writes anything but that flag, or " +
      "when the bulk path is folded into deleteClient.",
  };

  /** Every top-level function of a file with the guard call sites in its own body. */
  type FreezeFn = { name: string; exported: boolean; sites: GuardCallSite[]; calls: Set<string> };

  function freezeFunctions(rel: string): FreezeFn[] {
    const source = ts.createSourceFile(rel, readFileSync(join(process.cwd(), rel), "utf8"), ts.ScriptTarget.Latest, true);
    const bindings = accessGuardBindings(source, rel, FREEZE_GUARD_EXPORTS);
    const callNames = new Map(functionsIn(source).map((f) => [f.name, f.calls]));
    return pageFunctionsIn(source).map((fn) => ({
      name: fn.name,
      exported: fn.exported,
      sites: guardCallSites(fn.body, bindings),
      calls: callNames.get(fn.name) ?? new Set<string>(),
    }));
  }

  /**
   * The freeze guards a function reaches AND refuses on — directly, or through
   * a function of the same file it calls (transitively, cycle-safe).
   */
  function refusedGuards(fns: FreezeFn[], name: string, seen: Set<string> = new Set()): Set<string> {
    const out = new Set<string>();
    if (seen.has(name)) return out;
    seen.add(name);
    const fn = fns.find((f) => f.name === name);
    if (!fn) return out;
    for (const s of fn.sites) if (s.refused) out.add(s.exportName);
    for (const callee of fn.calls) for (const g of refusedGuards(fns, callee, seen)) out.add(g);
    return out;
  }

  /**
   * Discovered, not listed: every file under actions/ that imports one of the
   * freeze guards from lib/access, minus OWNED_BY_SECTION (checked by the
   * test above). A file that imports none of them is invisible here — that
   * gap is what AREA_BY_FILE and the "clients/projects/contacts" area test
   * close from the other side.
   */
  function freezeFiles(): string[] {
    const files: string[] = [];
    for (const file of sourceFilesIn(ACTIONS_DIR, [".ts"])) {
      const rel = relative(process.cwd(), file).split(sep).join("/");
      if (OWNED_BY_SECTION.includes(rel)) continue;
      const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      if (accessGuardBindings(source, rel, FREEZE_GUARD_EXPORTS).size > 0) files.push(rel);
    }
    return files.sort();
  }

  /**
   * Exact sizes of the domain above, recounted by AST (top-level exported
   * functions of the discovered files) on the working tree above 3bff9d8,
   * before any commit of this change: 4 files, 21 exported actions, 5 exempt,
   * 16 covered (getProjectsForClient was removed: no caller). An EXACT count: a file leaving the discovery (its guard import
   * removed) or an action disappearing must fail here, not shrink the domain.
   */
  const FREEZE_FILES_EXPECTED = 4;
  const FREEZE_ACTIONS_EXPECTED = 21;

  it("every write outside OWNED_BY_SECTION (project row, company, contacts, portal) reaches a trash-aware scope guard and REFUSES on its result", () => {
    const files = freezeFiles();
    expect(files, "the discovered files changed — recount, then update FREEZE_FILES_EXPECTED").toHaveLength(FREEZE_FILES_EXPECTED);

    const actions: string[] = [];
    const problems: string[] = [];
    for (const rel of files) {
      const fns = freezeFunctions(rel);
      // No guard call anywhere in these files may ignore its result.
      for (const fn of fns) {
        for (const s of fn.sites) {
          if (!s.refused) problems.push(`${rel}::${fn.name} (line ${s.line}): ${s.exportName} result is not tested by an if that returns or throws`);
        }
      }
      for (const fn of fns.filter((f) => f.exported)) {
        const key = `${rel}::${fn.name}`;
        actions.push(key);
        const reached = refusedGuards(fns, fn.name);
        if (key in FREEZE_EXEMPT) {
          if (reached.size > 0) problems.push(`${key} is exempt but now reaches ${[...reached].join(", ")} — drop its exemption`);
          continue;
        }
        const expected = FREEZE_EXPECTED[key];
        if (!expected) {
          problems.push(`${key} is in neither FREEZE_EXPECTED nor FREEZE_EXEMPT — classify it`);
          continue;
        }
        if (!expected.some((g) => reached.has(g))) {
          problems.push(`${key} must reach and refuse on ${expected.join(" or ")}, but reaches: ${[...reached].join(", ") || "nothing"}`);
        }
      }
    }
    // Both tables must name only actions that exist.
    for (const key of [...Object.keys(FREEZE_EXPECTED), ...Object.keys(FREEZE_EXEMPT)]) {
      if (!actions.includes(key)) problems.push(`${key} is named in a table but no longer exists — drop it`);
    }

    expect(problems, problems.join("\n")).toEqual([]);
    expect(actions).toHaveLength(FREEZE_ACTIONS_EXPECTED);
    expect(actions.length - Object.keys(FREEZE_EXEMPT).length).toBe(Object.keys(FREEZE_EXPECTED).length);
  });

  // ---------------------------------------------------------------------
  // Visibility reads. The write guard freezes a project whose company is in the
  // trash; every READ that decides whether a project exists for the caller must
  // use the same formula (lib/projectTrash.ts::projectTrashState), or the page
  // renders and every button on it is refused.
  // ---------------------------------------------------------------------

  it("every read that resolves a project for display decides its trash state through projectTrashState, never a bare deletedAt", () => {
    const PROJECT_READERS = new Set(["findById", "findByIdForPortal"]);
    const offenders: string[] = [];
    const readers: string[] = [];
    for (const dir of ["app", "actions", "lib"]) {
      for (const file of sourceFilesIn(join(process.cwd(), dir), [".ts", ".tsx"])) {
        const rel = relative(process.cwd(), file).split(sep).join("/");
        const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        // Local names bound to the project repository's findById / findByIdForPortal.
        const names = new Set<string>();
        for (const stmt of source.statements) {
          if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
          if (stmt.moduleSpecifier.text !== "@/repository/projects") continue;
          const b = stmt.importClause?.namedBindings;
          if (!b || !ts.isNamedImports(b)) continue;
          for (const el of b.elements) if (PROJECT_READERS.has((el.propertyName ?? el.name).text)) names.add(el.name.text);
        }
        if (names.size === 0) continue;
        // Every function that CALLS the reader. In app/ and lib/ it must judge the trash state through the
        // formula; in actions/ the callers are pinned by the exact list below.
        const trashNames = new Set<string>();
        for (const stmt of source.statements) {
          if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
          if (stmt.moduleSpecifier.text !== "@/lib/projectTrash") continue;
          const b = stmt.importClause?.namedBindings;
          if (!b || !ts.isNamedImports(b)) continue;
          for (const el of b.elements) if ((el.propertyName ?? el.name).text === "projectTrashState") trashNames.add(el.name.text);
        }
        for (const fn of pageFunctionsIn(source)) {
          if (!bodyCallsAnyOf(fn.body, names)) continue;
          const usesDeletedAt = (() => {
            let found = false;
            const visit = (n: ts.Node) => {
              if (found) return;
              if (ts.isPropertyAccessExpression(n) && n.name.text === "deletedAt") { found = true; return; }
              ts.forEachChild(n, visit);
            };
            visit(fn.body);
            return found;
          })();
          const usesFormula = bodyCallsAnyOf(fn.body, trashNames);
          readers.push(`${rel}::${fn.name}`);
          if (usesDeletedAt) offenders.push(`${rel}::${fn.name} reads a bare .deletedAt to decide visibility`);
          // A page or a route that fetches a project must judge its trash state through the formula: it has no
          // other reason to read the row. (An action may fetch it for a log line — see above — so actions are
          // pinned by the exact list below instead.)
          if (!usesFormula && (rel.startsWith("app/") || rel.startsWith("lib/"))) {
            offenders.push(`${rel}::${fn.name} fetches a project without projectTrashState`);
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // Every caller of the two project readers, 13 on the working tree above 3bff9d8: ten visibility reads
    // (getProject, the guarded asset route, the six dashboard report routes, the reserves report route, the
    // portal page) and three ACTIONS that fetch the row for something other than visibility —
    // deleteProject / permanentlyDeleteProject for the activity-log name, applyDeliveryNoteScan for the
    // clientId to revalidate — each behind its own guard (the freeze test above). Exact: a reader added
    // anywhere changes this list; in app/ and lib/ it also has to use the formula (offenders above).
    expect(readers.sort()).toEqual([
      "actions/deliveryNoteScan/deliveryNoteScan.ts::applyDeliveryNoteScan",
      "actions/projects/projects.ts::deleteProject",
      "actions/projects/projects.ts::getProject",
      "actions/projects/projects.ts::permanentlyDeleteProject",
      "app/api/assets/[kind]/[id]/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/dashboard/report/companies/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/dashboard/report/interims/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/dashboard/report/materials/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/dashboard/report/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/dashboard/report/tasks/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/dashboard/report/workers/route.ts::GET",
      "app/clients/[id]/projects/[projectId]/reserves/report/route.ts::GET",
      "app/portail/projets/[projectId]/page.tsx::PortalProjectPage",
    ]);
  });

  it("requireTrashedProjectAccess is called by restoreProject and permanentlyDeleteProject, and by nothing else", () => {
    // The inverse guard (the project must BE in the trash) is the one place
    // where acting on a trashed project is legitimate. Any other caller
    // reopens the freeze, so the set is pinned. Domain: every source file of
    // the app, not a list — a new caller anywhere must show up here.
    const allowed = [
      "actions/projects/projects.ts::permanentlyDeleteProject",
      "actions/projects/projects.ts::restoreProject",
    ];
    const callers = new Set<string>();
    for (const dir of ["actions", "app", "lib", "service", "repository", "components", "forms"]) {
      for (const file of sourceFilesIn(join(process.cwd(), dir), [".ts", ".tsx"])) {
        const rel = relative(process.cwd(), file).split(sep).join("/");
        if (rel === "lib/access.ts") continue; // the definition
        const source = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        // Every way of reaching lib/access that does NOT bind the export by name defeats the scan below
        // (`import * as access from "@/lib/access"; access.requireTrashedProjectAccess(...)`, a dynamic
        // import, a require, a re-export through a barrel). None is used today: refuse them all, so the
        // set of callers cannot be widened through a door this test does not look at.
        if (reachesAccessLibWithoutNamedImport(source, rel)) callers.add(`${rel}::<indirect access to @/lib/access>`);
        const names = collectImportedNames(source, rel, ACCESS_LIB_FILE, "requireTrashedProjectAccess");
        if (names.size === 0) continue;
        const named = pageFunctionsIn(source).filter((fn) => bodyCallsAnyOf(fn.body, names));
        for (const fn of named) callers.add(`${rel}::${fn.name}`);
        // Imported but not called from any top-level function: still a caller to refuse.
        if (named.length === 0) callers.add(`${rel}::<outside a top-level function>`);
      }
    }
    expect([...callers].sort()).toEqual(allowed);
  });
});

// ---------------------------------------------------------------------------
// Probes (lot 5b) — the area-argument check itself, on sources written for the
// occasion. A structural test proves nothing until it has been seen to fail:
// each way of being wrong must go red, the one correct form must stay green.
// ---------------------------------------------------------------------------
describe("the area-argument guard check (probes)", () => {
  const REFUSAL_MESSAGE = (fn: string) =>
    `actions/probe/probe.ts::${fn} — calls requireAreaAccess("loans") but does not REFUSE on it (result bound and never reassigned, its .error tested by an if that exits — a throw only if no catch swallows it — on a path every call takes, in the action body, before any write, none of them inside the refusal branch or a finally)`;

  const IMPORT = `import { requireAreaAccess } from "@/lib/areaAccess";\n`;

  /** The one accepted form: result bound, `.error` tested by an `if` that exits. */
  const REFUSE = (area: string, guard = "requireAreaAccess", v = "check") => `const ${v} = await ${guard}("${area}"); if (${v}.error) return ${v}.error;`;

  function violationsOf(code: string, expected: readonly string[], guardExport = REQUIRE_AREA_ACCESS): string[] {
    const file = "actions/probe/probe.ts";
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    return areaViolationsIn(source, file, guardExport, exportedFn, () => expected);
  }

  it("stays green on the correct form, aliased or not", () => {
    expect(violationsOf(`${IMPORT}export async function a() { ${REFUSE("loans")} }`, ["loans"])).toEqual([]);
    expect(
      violationsOf(`import { requireAreaAccess as guard } from "@/lib/areaAccess";\nexport async function a() { ${REFUSE("loans", "guard")} }`, ["loans"])
    ).toEqual([]);
  });

  it("goes red on the right guard with the WRONG rubrique", () => {
    expect(violationsOf(`${IMPORT}export async function a() { await requireAreaAccess("projects"); }`, ["loans"])).toEqual([
      'actions/probe/probe.ts::a — never calls requireAreaAccess("loans")',
    ]);
  });

  it("goes red on the right rubrique guarded in ANOTHER function of the same file", () => {
    const code = `${IMPORT}
      export async function guarded() { ${REFUSE("loans")} }
      export async function unguarded() { return 1; }`;
    expect(violationsOf(code, ["loans"])).toEqual(['actions/probe/probe.ts::unguarded — never calls requireAreaAccess("loans")']);
  });

  it("goes red on a local homonym that is not the imported guard", () => {
    const code = `async function requireAreaAccess(_area: string) { return { error: null }; }
      export async function a() { await requireAreaAccess("loans"); }`;
    expect(violationsOf(code, ["loans"])).toHaveLength(1);
    // ... and on a same-named import from some OTHER module
    const other = `import { requireAreaAccess } from "@/lib/somewhereElse";\nexport async function a() { await requireAreaAccess("loans"); }`;
    expect(violationsOf(other, ["loans"])).toHaveLength(1);
  });

  it("goes red when the rubrique only appears in a comment or a string", () => {
    expect(violationsOf(`${IMPORT}export async function a() { /* requireAreaAccess("loans") */ const s = 'requireAreaAccess("loans")'; return s; }`, ["loans"])).toHaveLength(1);
  });

  it("goes red on a non-literal argument (it cannot be shown to be the expected rubrique)", () => {
    expect(violationsOf(`${IMPORT}const AREA = "loans";\nexport async function a() { await requireAreaAccess(AREA); }`, ["loans"])).toHaveLength(1);
  });

  it("accepts SEVERAL rubriques for one function, and names the missing one", () => {
    const both = `${IMPORT}export async function createPortalLogin() { ${REFUSE("admin.users", "requireAreaAccess", "u")} ${REFUSE("clients.contacts", "requireAreaAccess", "c")} }`;
    expect(violationsOf(both, ["admin.users", "clients.contacts"])).toEqual([]);
    const one = `${IMPORT}export async function createPortalLogin() { ${REFUSE("clients.contacts")} }`;
    expect(violationsOf(one, ["admin.users", "clients.contacts"])).toEqual([
      'actions/probe/probe.ts::createPortalLogin — never calls requireAreaAccess("admin.users")',
    ]);
  });

  // lot 5b: the four forms of a guard that is CALLED but refuses nothing. Each
  // was green under the by-name-and-argument check; each must now go red.
  it("goes red on a guard whose RESULT IS IGNORED", () => {
    expect(violationsOf(`${IMPORT}export async function a() { await requireAreaAccess("loans"); }`, ["loans"])).toEqual([REFUSAL_MESSAGE("a")]);
  });

  it("goes red on a guard placed in a CLOSURE that is never called", () => {
    const code = `${IMPORT}export async function a() { const never = async () => { ${REFUSE("loans")} }; return 1; }`;
    expect(violationsOf(code, ["loans"])).toEqual([REFUSAL_MESSAGE("a")]);
  });

  it("goes red on a guard placed AFTER the mutation", () => {
    const code = `import { requireAreaAccess } from "@/lib/areaAccess";
      import { update } from "@/repository/x";
      export async function a() { await update(1); ${REFUSE("loans")} }`;
    expect(violationsOf(code, ["loans"])).toEqual([REFUSAL_MESSAGE("a")]);
  });

  it("goes red on a result bound but never tested with .error, or tested by an if that does not exit", () => {
    expect(violationsOf(`${IMPORT}export async function a() { const c = await requireAreaAccess("loans"); return c; }`, ["loans"])).toEqual([REFUSAL_MESSAGE("a")]);
    expect(violationsOf(`${IMPORT}export async function a() { const c = await requireAreaAccess("loans"); if (c.error) { console.log(1); } }`, ["loans"])).toEqual([REFUSAL_MESSAGE("a")]);
  });

  it("stays green when the guard sits before the mutation, inside a try, with a throw, or before a repository READ", () => {
    const before = `import { requireAreaAccess } from "@/lib/areaAccess";
      import { update } from "@/repository/x";
      export async function a() { ${REFUSE("loans")} await update(1); }`;
    expect(violationsOf(before, ["loans"])).toEqual([]);
    expect(violationsOf(`${IMPORT}export async function a() { try { ${REFUSE("loans")} } catch { return 1; } }`, ["loans"])).toEqual([]);
    expect(
      violationsOf(`${IMPORT}export async function a() { const c = await requireAreaAccess("loans"); if (c.error !== null) throw c.error; }`, ["loans"])
    ).toEqual([]);
  });

  it("works the same for canAccessArea on a route handler", () => {
    const route = (arg: string) => `import { canAccessArea } from "@/lib/areaAccess";\nexport async function GET() { return canAccessArea("${arg}"); }`;
    const file = "app/probe/route.ts";
    const check = (arg: string) =>
      areaViolationsIn(ts.createSourceFile(file, route(arg), ts.ScriptTarget.Latest, true), file, AREA_CAN_ACCESS_EXPORT_NAME, exportedGet, () => ["projects"]);
    expect(check("projects")).toEqual([]);
    expect(check("clients")).toHaveLength(1);
  });
});

// Probes (lot 5b) — requireSectionAccess by ARGUMENT, resolved by import, with a
// refusal. Same four wrong forms as the area probes, plus the one specific to
// sections: the right guard with ANOTHER file's section.
describe("the section-argument guard check (probes)", () => {
  const IMPORT = `import { requireSectionAccess } from "@/lib/sectionAccess";\n`;
  const REFUSE = (section: string) => `const c = await requireSectionAccess("${section}"); if (c.error) return c.error;`;

  function violationsOf(code: string, expected: readonly string[], conditional: readonly string[] = []): string[] {
    const file = "actions/probe/probe.ts";
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    return areaViolationsIn(source, file, REQUIRE_SECTION_ACCESS, exportedFn, () => expected, SECTION_ACCESS_LIB_FILE, () => conditional);
  }

  it("goes red on the right guard with ANOTHER file's section (materials pasted into a tasks action)", () => {
    expect(violationsOf(`${IMPORT}export async function a() { ${REFUSE("materials")} }`, ["tasks"])).toEqual([
      'actions/probe/probe.ts::a — never calls requireSectionAccess("tasks")',
    ]);
  });

  it("goes red on a guard whose result is ignored, a local homonym, and a same-named import from elsewhere", () => {
    expect(violationsOf(`${IMPORT}export async function a() { await requireSectionAccess("tasks"); }`, ["tasks"])).toHaveLength(1);
    expect(violationsOf(`async function requireSectionAccess(_s: string) { return { error: null }; }\nexport async function a() { ${REFUSE("tasks")} }`, ["tasks"])).toHaveLength(1);
    expect(violationsOf(`import { requireSectionAccess } from "@/lib/areaAccess";\nexport async function a() { ${REFUSE("tasks")} }`, ["tasks"])).toHaveLength(1);
  });

  it("stays green on the right section, and on a CONDITIONAL second section that waits for a read but not for a write", () => {
    expect(violationsOf(`${IMPORT}export async function a() { ${REFUSE("tasks")} }`, ["tasks"])).toEqual([]);
    const conditional = `${IMPORT}import { findTaskProjectId, setAssignee } from "@/repository/x";
      export async function a(k: number) {
        const c = await requireSectionAccess("tasks"); if (c.error) return c.error;
        await findTaskProjectId(1);
        if (k) { const d = await requireSectionAccess("interims"); if (d.error) return d.error; }
        await setAssignee(1);
      }`;
    expect(violationsOf(conditional, ["tasks", "interims"], ["interims"])).toEqual([]);
    expect(violationsOf(conditional.replace("await setAssignee(1);", "").replace("await findTaskProjectId(1);", "await setAssignee(1);"), ["tasks", "interims"], ["interims"])).toHaveLength(1);
    // ... and a conditional guard in an action that is NOT allowed one goes red
    expect(violationsOf(conditional, ["tasks", "interims"])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Probes (lot 5b, audit of the refusal check): the forms that stayed green under
// the first version of it. Each wrong form goes red, its correct neighbour stays
// green. The letters are the audit's.
// ---------------------------------------------------------------------------
describe("the refusal check (probes: forms that used to stay green)", () => {
  const HEAD =
    `import { requireAreaAccess } from "@/lib/areaAccess";\n` +
    `import { update, findById } from "@/repository/x";\n`;
  const G = `const c = await requireAreaAccess("loans");`;
  const REFUSE = `${G} if (c.error) return c.error;`;

  function check(code: string, file = "actions/probe/probe.ts", conditional: readonly string[] = []): string[] {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    return areaViolationsIn(source, file, REQUIRE_AREA_ACCESS, exportedFn, () => ["loans"], AREA_ACCESS_LIB_FILE, () => conditional);
  }
  const red = (code: string, file?: string) => expect(check(code, file)).toHaveLength(1);
  const green = (code: string, file?: string, conditional?: readonly string[]) => expect(check(code, file, conditional)).toEqual([]);

  it("(a) a refusal by throw inside a try whose catch CONTINUES is swallowed; a catch that leaves keeps it", () => {
    red(`${HEAD}export async function a() { try { ${G} if (c.error) throw c.error; } catch { } await update(1); }`);
    red(`${HEAD}export async function a() { try { ${G} if (c.error) throw c.error; } catch (e) { console.log(e); } await update(1); }`);
    green(`${HEAD}export async function a() { try { ${G} if (c.error) throw c.error; } catch (e) { return { error: e }; } await update(1); }`);
    green(`${HEAD}export async function a() { ${G} if (c.error) throw c.error; await update(1); }`);
  });

  it("(b) a guard or a refusal in a CONDITIONAL branch is not a guard — unless the action is explicitly allowed one", () => {
    red(`${HEAD}export async function a(x: boolean) { if (x) { ${REFUSE} } await update(1); }`);
    red(`${HEAD}export async function a(x: boolean) { ${G} if (x) { if (c.error) return c.error; } await update(1); }`);
    red(`${HEAD}export async function a(x: boolean) { x && (await requireAreaAccess("loans")); await update(1); }`);
    green(`${HEAD}export async function a(x: boolean) { if (x) { ${REFUSE} } await update(1); }`, undefined, ["loans"]);
    green(`${HEAD}export async function a() { try { ${REFUSE} await update(1); } catch { return 1; } }`);
  });

  it("(c) a write in a finally, a refusal in a loop, a result reassigned before the test", () => {
    red(`${HEAD}export async function a() { try { ${REFUSE} } finally { await update(1); } }`);
    red(`${HEAD}export async function a() { ${G} for (const i of [1]) { if (c.error) return c.error; } await update(1); }`);
    red(`${HEAD}export async function a() { let c = await requireAreaAccess("loans"); c = { error: null }; if (c.error) return c.error; await update(1); }`);
    red(`${HEAD}export async function a() { const c = await requireAreaAccess("loans"); c.error = null; if (c.error) return c.error; await update(1); }`);
    green(`${HEAD}export async function a() { try { ${REFUSE} await update(1); } finally { console.log(1); } }`);
  });

  it("(d) a write INSIDE the refusal branch writes first, then refuses", () => {
    red(`${HEAD}export async function a() { ${G} if (c.error) { await update(1); return c.error; } }`);
    green(`${HEAD}export async function a() { ${G} if (c.error) { console.log(c.error); return c.error; } await update(1); }`);
  });

  it("(e) the effects beyond repository/service/cloudinary: the LLM scan, the rate limiter, e-mail, a direct prisma import", () => {
    const wrap = (imp: string, call: string) => `import { requireAreaAccess } from "@/lib/areaAccess";\n${imp}\nexport async function a() { ${call} ${REFUSE} }`;
    red(wrap(`import { scanDeliveryNote } from "@/lib/deliveryNoteScan";`, "await scanDeliveryNote(1);"));
    red(wrap(`import { registerFailure } from "@/lib/rate-limit";`, "await registerFailure(1);"));
    red(wrap(`import { sendEmail } from "@/lib/email";`, "await sendEmail(1);"));
    red(wrap(`import { prisma } from "@/lib/prisma";`, "await prisma.user.update({});"));
    red(wrap(`import { prisma as db } from "@/lib/prisma";`, "await db.user.count();"));
    // a READ by name does not count, from any of those modules
    green(wrap(`import { getThing } from "@/repository/x";`, "await getThing(1);"));
    green(wrap(`import { isRateLimited } from "@/lib/rate-limit";`, "await isRateLimited(1);"));
  });

  it("(f) a namespace import and a relative path are the same effect", () => {
    red(`import { requireAreaAccess } from "@/lib/areaAccess";\nimport * as repo from "@/repository/x";\nexport async function a() { await repo.update(1); ${REFUSE} }`);
    red(`import { requireAreaAccess } from "@/lib/areaAccess";\nimport { update } from "../../repository/x";\nexport async function a() { await update(1); ${REFUSE} }`);
    red(`import { requireAreaAccess } from "@/lib/areaAccess";\nexport async function a() { const repo = await import("@/repository/x"); await repo.update(1); ${REFUSE} }`);
    green(`import { requireAreaAccess } from "@/lib/areaAccess";\nimport * as repo from "@/repository/x";\nexport async function a() { await repo.findById(1); ${REFUSE} await repo.update(1); }`);
  });

  it("(g) an action exported by `export { a }`, `export default a`, an anonymous default or a re-export is seen by both walkers", () => {
    const exportedNames = (code: string) => {
      const source = ts.createSourceFile("actions/probe/probe.ts", code, ts.ScriptTarget.Latest, true);
      return {
        fns: functionsIn(source).filter((f) => f.exported).map((f) => f.name).sort(),
        pages: pageFunctionsIn(source).filter((f) => f.exported).map((f) => f.name).sort(),
      };
    };
    expect(exportedNames(`async function a() { await update(1); }\nexport { a };`)).toEqual({ fns: ["a"], pages: ["a"] });
    expect(exportedNames(`async function a() { await update(1); }\nexport default a;`)).toEqual({ fns: ["a"], pages: ["a"] });
    expect(exportedNames(`export default async function () { await update(1); }`)).toEqual({ fns: ["default"], pages: ["default"] });
    expect(exportedNames(`export default async () => { await update(1); };`)).toEqual({ fns: ["default"], pages: ["default"] });
    expect(exportedNames(`export { a, b as c } from "./elsewhere";`)).toEqual({ fns: ["a", "c"], pages: ["a", "c"] });
    expect(exportedNames(`export * from "./elsewhere";`)).toEqual({ fns: ["*"], pages: ["*"] });
    // a helper that is NOT exported stays private, and a type-only export is not an action
    expect(exportedNames(`async function helper() {}\nexport type { T } from "./t";`)).toEqual({ fns: [], pages: [] });
    // and an unguarded re-exported action is reported by the "every exported action is gated" check
    const source = ts.createSourceFile("actions/probe/probe.ts", `export { leak } from "./elsewhere";`, ts.ScriptTarget.Latest, true);
    const fns = functionsIn(source);
    expect(guardedNames(fns, GUARD_CALLS).has("leak")).toBe(false);
  });
});
