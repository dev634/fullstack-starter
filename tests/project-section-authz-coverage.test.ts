import { describe, it, expect } from "vitest";
import ts from "typescript";
import { join, relative, resolve, dirname, sep } from "node:path";
import { sourceFilesIn, callsIn, parseSource } from "./helpers/astScan";
import { PROJECT_SECTION_ROUTES } from "@/lib/projectSections";

/**
 * Structural guarantee: every project-section page — a `page.tsx` living
 * directly under a folder named after a route segment of
 * `PROJECT_SECTION_ROUTES` (`app/clients/[id]/projects/[projectId]/<segment>/...`)
 * — resolves its access through `resolveProjectSectionAccess`
 * (`lib/projectSectionGuard.ts`), the one place the canonical read-guard
 * order for a project section lives (rubrique → section → resolve the row →
 * scope). Without this, a third section page added tomorrow with no gate at
 * all — or with the four checks copied inline, in the wrong order — leaves
 * the whole suite green: the existing `authz-coverage.test.ts` only walks
 * `app/**\/route.ts` files (`.tsx` is never even collected), and its two
 * page-level checks are two hard-coded paths recognized by the bare name
 * `canAccessArea`.
 *
 * "Section page" is discovered from `lib/projectSections.ts`'s own
 * `PROJECT_SECTION_ROUTES` — the single source of truth for the route
 * segment -> section key(s) correspondence — rather than inferred from the
 * folder name matching a bare `ProjectSectionKey`. That inference used to be
 * enough (every routed section depended on exactly one key, so the folder
 * WAS the key), until `workforce` fused two keys (`subcontractors` +
 * `interims`) into one page with a name that is neither: a route can now
 * depend on one key or several, and this table is what says which. A folder
 * that names no entry of the table (the hub itself, `dashboard/`, `edit/`)
 * is deliberately not swept up: those pages pose the same preamble inline
 * today and may converge onto the shared guard later, but this test must not
 * force that convergence to stay green.
 *
 * The call must be resolved by its IMPORT, not by the bare identifier
 * "resolveProjectSectionAccess" — matching on the name alone is exactly what
 * `tests/style-color-injection-guard.test.ts` already had to defeat for
 * `safeHex()`: an aliased import (`import { resolveProjectSectionAccess as
 * guardAccess } from "@/lib/projectSectionGuard"`) must count, and a
 * same-named function redeclared locally in the page (never importing the
 * real one) must NOT — it would resolve to the local declaration, not the
 * shared guard, which is precisely the copy-pasted-checks failure mode this
 * test exists to catch.
 */

const APP_DIR = join(process.cwd(), "app");
const PROJECT_SECTION_ROOT = join(APP_DIR, "clients", "[id]", "projects", "[projectId]");
const ROOT = process.cwd();
const GUARD_LIB_FILE = resolve(ROOT, "lib", "projectSectionGuard.ts").toLowerCase();
const GUARD_EXPORT_NAME = "resolveProjectSectionAccess";
/** Next.js entry-point filenames for a page route. */
const ENTRY_FILENAMES = new Set(["page.tsx", "page.ts"]);

type SectionPage = { file: string; sectionKey: string };

/** Whether `value` names an entry of `PROJECT_SECTION_ROUTES` — a real type guard, not a cast, so `discoverSectionPages` below can index the table with it safely. */
function isProjectSectionRouteSegment(value: string): value is keyof typeof PROJECT_SECTION_ROUTES {
  return Object.prototype.hasOwnProperty.call(PROJECT_SECTION_ROUTES, value);
}

/**
 * Every `page.tsx`/`page.ts` under `app/clients/[id]/projects/[projectId]`
 * whose first path segment names a route segment of `PROJECT_SECTION_ROUTES`
 * — discovered from the filesystem and that shared table, never hard-coded
 * here. A page two levels deep under a section's route segment
 * (`<segment>/anything/page.tsx`) still counts: it's still content reached
 * only through that route.
 */
function discoverSectionPages(): SectionPage[] {
  const pages: SectionPage[] = [];
  for (const file of sourceFilesIn(PROJECT_SECTION_ROOT, [".ts", ".tsx"])) {
    const filename = file.split(sep).pop()!;
    if (!ENTRY_FILENAMES.has(filename)) continue;
    const segments = relative(PROJECT_SECTION_ROOT, file).split(sep);
    if (segments.length < 2) continue; // the hub's own page.tsx — no route segment
    const [routeSegment] = segments;
    if (isProjectSectionRouteSegment(routeSegment)) {
      pages.push({ file, sectionKey: PROJECT_SECTION_ROUTES[routeSegment].join("+") });
    }
  }
  return pages;
}

/** Whether import specifier `spec`, written in file `fromRelFile`, resolves to lib/projectSectionGuard.ts. */
function resolvesToGuardLib(spec: string, fromRelFile: string): boolean {
  let base: string | undefined;
  if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromRelFile), spec);
  if (!base) return false; // a bare package specifier is never this local module
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.some((c) => c.toLowerCase() === GUARD_LIB_FILE);
}

type GuardBindings = {
  /** Local names bound to the named export `resolveProjectSectionAccess`, aliased or not. */
  guardNames: Set<string>;
  /** Local names bound to `import * as x from "@/lib/projectSectionGuard"` — `x.resolveProjectSectionAccess(...)` counts too. */
  namespaceNames: Set<string>;
};

function collectGuardBindings(source: ts.SourceFile, relFile: string): GuardBindings {
  const guardNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!resolvesToGuardLib(stmt.moduleSpecifier.text, relFile)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if ((el.propertyName ?? el.name).text === GUARD_EXPORT_NAME) guardNames.add(el.name.text);
      }
    } else if (ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
    }
  }
  return { guardNames, namespaceNames };
}

/** Whether a call expression anywhere inside `node` resolves — via the file's own imports, not by bare name — to the shared guard. */
function bodyCallsGuard(node: ts.Node, bindings: GuardBindings): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && bindings.guardNames.has(callee.text)) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        bindings.namespaceNames.has(callee.expression.text) &&
        callee.name.text === GUARD_EXPORT_NAME
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

type FnNode = { name: string; exported: boolean; body: ts.Node; calls: Set<string> };

/** Top-level named functions in `source`, with their body node kept (unlike tests/helpers/astScan.ts's functionsIn, which only keeps bare call names — not enough to tell an import-resolved call from a same-named local declaration). */
function functionNodesIn(source: ts.SourceFile): FnNode[] {
  const fns: FnNode[] = [];
  ts.forEachChild(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      fns.push({ name: node.name.text, exported, body: node.body, calls: callsIn(node.body) });
      return;
    }
    if (ts.isVariableStatement(node)) {
      const exported = (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
        fns.push({ name: decl.name.text, exported, body: decl.initializer.body, calls: callsIn(decl.initializer.body) });
      }
    }
  });
  return fns;
}

/**
 * Names of functions in `fns` that resolve to the guard, directly or through
 * a local helper that (eventually) does — same transitive-closure shape as
 * tests/helpers/astScan.ts's guardedNames, so a page that factors its
 * preamble into a local helper isn't punished for it, but the base case here
 * is an import-resolved call, never a bare name.
 */
function functionsCallingGuard(fns: readonly FnNode[], bindings: GuardBindings): Set<string> {
  const byName = new Map(fns.map((f) => [f.name, f]));
  const resolved = new Set<string>();

  const isResolved = (fn: FnNode, seen: Set<string>): boolean => {
    if (resolved.has(fn.name)) return true;
    if (seen.has(fn.name)) return false; // cycle
    seen.add(fn.name);
    if (bodyCallsGuard(fn.body, bindings)) return true;
    for (const call of fn.calls) {
      const local = byName.get(call);
      if (local && isResolved(local, seen)) return true;
    }
    return false;
  };

  for (const fn of fns) if (isResolved(fn, new Set())) resolved.add(fn.name);
  return resolved;
}

describe("every project-section page resolves access through the shared project-section guard", () => {
  const pages = discoverSectionPages();

  it("finds the project-section pages (guards against a silently empty scan)", () => {
    // If PROJECT_SECTION_ROUTES or the app/ tree moves, this would otherwise
    // pass vacuously — the same trap the sibling coverage tests guard against.
    expect(pages.length).toBeGreaterThan(0);
  });

  it("requires every project-section page to call resolveProjectSectionAccess, imported from @/lib/projectSectionGuard", () => {
    const ungated: string[] = [];
    for (const { file, sectionKey } of pages) {
      const rel = relative(process.cwd(), file).split(sep).join("/");
      const source = parseSource(rel, file);
      const bindings = collectGuardBindings(source, rel);
      const fns = functionNodesIn(source);
      const entryFns = fns.filter((fn) => fn.exported);

      if (entryFns.length === 0) {
        ungated.push(`${rel} (no exported entry function found — did it move?)`);
        continue;
      }

      const resolvedNames = functionsCallingGuard(fns, bindings);
      for (const fn of entryFns) {
        if (!resolvedNames.has(fn.name)) {
          ungated.push(`${rel}::${fn.name} (section "${sectionKey}")`);
        }
      }
    }

    expect(
      ungated,
      ungated.length
        ? `These project-section pages never resolve access through the shared guard:\n` +
          ungated.map((k) => `  - ${k}`).join("\n") +
          `\n\nCall resolveProjectSectionAccess({ id, projectId }, "<section>") imported from ` +
          `@/lib/projectSectionGuard — a locally redeclared function of the same name, or the ` +
          `checks copied inline, do not count: only a call resolved back to that module's own ` +
          `export does.`
        : undefined
    ).toEqual([]);
  });
});
