import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared TypeScript-AST scanning primitives for the structural authz-coverage
 * tests (tests/authz-coverage.test.ts, tests/portal-authz-coverage.test.ts).
 *
 * Extracted once a second file needed the same walk — a hand-rolled regex
 * over source text is trivially defeated (an aliased import, or a call
 * mentioned only in a comment) in a way a real parse is not. Kept in one
 * place so a fix to the walk (e.g. handling a new syntax form) benefits both
 * call sites instead of drifting between two near-identical copies.
 */

/**
 * Directory names no source walk enters, AT ANY DEPTH, because what they hold
 * is another tree, not this one: `node_modules` is third-party code, and
 * `.claude` holds the agents' isolated worktrees — a whole copy of the
 * repository each, its own `node_modules` included.
 *
 * Matched by NAME, not by repo-relative path. A session started from a
 * subfolder creates its worktrees there: `actions/.claude/worktrees/` held
 * 31 636 `.ts` files when this was written, which a root-anchored `.claude`
 * exclusion let through — authz-coverage then walked every one of them as if
 * it were an action of this repository, and the run never finished.
 */
export const FOREIGN_TREE_DIRS: ReadonlySet<string> = new Set(["node_modules", ".claude"]);

/** Every source file under `dir`, recursively, whose extension is in `extensions` (e.g. [".ts", ".tsx"]), minus FOREIGN_TREE_DIRS. */
export function sourceFilesIn(dir: string, extensions: readonly string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!FOREIGN_TREE_DIRS.has(name)) sourceFilesIn(full, extensions, out);
    } else if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
  }
  return out;
}

/** Every function name called anywhere inside `node` (identifier calls and `obj.method()` calls alike). */
export function callsIn(node: ts.Node): Set<string> {
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

/**
 * What a module exports BESIDES `export function f` / `export const f = …`:
 *   - `export { a, b as c }` and `export default a`: the LOCAL functions `a`, `b`
 *     are exported (an action written `async function f() {}` then `export { f }`
 *     is as reachable as one written `export async function f()`);
 *   - `export { a } from "./x"` and `export * from "./x"`: names re-exported with
 *     no body here — each is an action surface this file cannot show a gate for;
 *   - `export default async function () {}` / `export default () => {}`: an
 *     anonymous default, named "default".
 * Before lot 5b only the two `export`-modifier forms were seen, so every other
 * way of exporting an action walked past the "every exported action is gated" test.
 */
export type ExportInfo = {
  /** Local names exported through `export { … }` (no module specifier) or `export default <identifier>`. */
  locals: Set<string>;
  /** Names re-exported from another module (`"*"` for `export * from`). */
  reexports: string[];
  /** The declaration node of each re-export, for a line number / a body-less stand-in. */
  reexportNodes: ts.Node[];
  /** Bodies of anonymous default exports (a function declaration or an arrow / function expression). */
  anonymousDefaults: ts.Node[];
};

export function exportInfoOf(source: ts.SourceFile): ExportInfo {
  const info: ExportInfo = { locals: new Set(), reexports: [], reexportNodes: [], anonymousDefaults: [] };
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) continue;
      const clause = node.exportClause;
      if (node.moduleSpecifier) {
        if (!clause) {
          info.reexports.push("*");
          info.reexportNodes.push(node);
        } else if (ts.isNamespaceExport(clause)) {
          info.reexports.push(clause.name.text);
          info.reexportNodes.push(node);
        } else {
          for (const el of clause.elements) {
            if (el.isTypeOnly) continue;
            info.reexports.push(el.name.text);
            info.reexportNodes.push(node);
          }
        }
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) if (!el.isTypeOnly) info.locals.add((el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const e = node.expression;
      if (ts.isIdentifier(e)) info.locals.add(e.text);
      else if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) info.anonymousDefaults.push(e.body);
    } else if (ts.isFunctionDeclaration(node) && !node.name && node.body) {
      const mods = ts.getModifiers(node) ?? [];
      if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        info.anonymousDefaults.push(node.body);
      }
    }
  }
  return info;
}

export type Fn = { name: string; exported: boolean; calls: Set<string> };

/**
 * Every top-level named function in `source` — `function foo() {}` and
 * `const foo = () => {}` alike — plus a stand-in for each anonymous default
 * export ("default") and each re-export (its name, no calls: nothing here
 * gates it).
 */
export function functionsIn(source: ts.SourceFile): Fn[] {
  const fns: Fn[] = [];
  const info = exportInfoOf(source);
  const hasExport = (node: ts.Node) => (ts.getModifiers(node as ts.HasModifiers) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  ts.forEachChild(source, (node) => {
    // `export async function foo()` and plain `async function helper()`
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      fns.push({ name: node.name.text, exported: hasExport(node) || info.locals.has(node.name.text), calls: callsIn(node.body) });
      return;
    }
    // `const foo = async () => {}` / `export const foo = async () => {}`
    if (ts.isVariableStatement(node)) {
      const exported = hasExport(node);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
        fns.push({ name: decl.name.text, exported: exported || info.locals.has(decl.name.text), calls: callsIn(decl.initializer.body) });
      }
    }
  });
  for (const body of info.anonymousDefaults) fns.push({ name: "default", exported: true, calls: callsIn(body) });
  for (const name of info.reexports) fns.push({ name, exported: true, calls: new Set() });
  return fns;
}

/**
 * Resolve gates transitively within a file: a function counts as guarded when
 * it calls one of `guardCalls` directly, or calls a local helper that
 * (eventually) does.
 *
 * This matters — actions/users/users.ts gates through a local `requireManager()`
 * wrapper, and a checker that only looked for direct calls would report those
 * actions as unguarded. A test that cries wolf gets muted, so it must not.
 */
export function guardedNames(fns: Fn[], guardCalls: ReadonlySet<string>): Set<string> {
  const byName = new Map(fns.map((f) => [f.name, f]));
  const guarded = new Set<string>();

  const isGuarded = (fn: Fn, seen: Set<string>): boolean => {
    if (guarded.has(fn.name)) return true;
    if (seen.has(fn.name)) return false; // cycle
    seen.add(fn.name);

    for (const call of fn.calls) {
      if (guardCalls.has(call)) return true;
      const local = byName.get(call);
      if (local && isGuarded(local, seen)) return true;
    }
    return false;
  };

  for (const fn of fns) if (isGuarded(fn, new Set())) guarded.add(fn.name);
  return guarded;
}

/**
 * Every module specifier a file imports from (`import ... from "X"`, and
 * `import("X")` dynamic imports) — the raw string, unresolved. Deliberately
 * ignores WHAT is imported: an aliased named import
 * (`import { canReachProject as reach } from "@/lib/accessContext"`) still
 * pulls in the module, and a regex keyed on the original name misses it. Only
 * the source is checked here, on purpose (see the module doc on
 * FORBIDDEN_MODULES in tests/portal-authz-coverage.test.ts).
 */
export function importedModulesIn(source: ts.SourceFile): Set<string> {
  const modules = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      modules.add(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteral(arg)) modules.add(arg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return modules;
}

/** Parse a file into a ts.SourceFile, inferring script kind (.ts vs .tsx) from `relativePath`'s extension. */
export function parseSource(relativePath: string, absolutePath: string): ts.SourceFile {
  return ts.createSourceFile(relativePath, readFileSync(absolutePath, "utf8"), ts.ScriptTarget.Latest, true);
}
