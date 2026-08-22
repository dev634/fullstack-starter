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

/** Every source file under `dir`, recursively, whose extension is in `extensions` (e.g. [".ts", ".tsx"]). */
export function sourceFilesIn(dir: string, extensions: readonly string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFilesIn(full, extensions, out);
    else if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
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

export type Fn = { name: string; exported: boolean; calls: Set<string> };

/** Every top-level named function in `source` — `function foo() {}` and `const foo = () => {}` alike. */
export function functionsIn(source: ts.SourceFile): Fn[] {
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
