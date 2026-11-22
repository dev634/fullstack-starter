import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { FOREIGN_TREE_DIRS, parseSource } from "./astScan";

/**
 * Scanning primitives for the two structural tests about who reads the
 * session (tests/session-reader-refusal.test.ts, tests/session-reader-discovery.test.ts).
 *
 * The session is read through ONE function, `auth` from lib/auth.ts — that is
 * where the account-liveness gate (lib/sessionGate.ts) is wired in. A reader
 * is found by a name, so the discovery is only as good as the set of ways a
 * file can obtain that name. Rather than track every way (a namespace import,
 * a relative path, a rename, a re-export), the scan BANS every way but one: a
 * named, unaliased `import { auth } from "@/lib/auth"` (plus the single
 * destructured dynamic import lib/areaAccess.ts needs). A form it cannot
 * follow is therefore a failing test, never a silently undiscovered reader.
 */

const AUTH_MODULE_PATH = "lib/auth";

/**
 * What lib/auth.ts exports. `auth` is the only session reader; the other
 * three are imported by the NextAuth route handler and the sign-in/out
 * actions and read nothing. A named import of anything else is refused, so a
 * new export gets reviewed instead of imported unseen.
 */
const AUTH_EXPORTS: ReadonlySet<string> = new Set(["auth", "handlers", "signIn", "signOut"]);

export type Finding = { line: number; message: string };

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * The repo-relative path (normalised, no extension, no trailing `/index`) a
 * specifier written in the file at `fromRel` resolves to, or `null` for a bare
 * package specifier. Both branches are normalised: `@/lib/./auth`,
 * `@/lib/../lib/auth` and `@/lib//auth` resolve to lib/auth for TypeScript
 * exactly as `../lib/auth` does.
 */
export function resolveSpecifier(specifier: string, fromRel: string): string | null {
  const bare = (p: string) => p.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
  if (specifier.startsWith("@/")) return bare(posix.normalize(specifier.slice(2)));
  if (specifier.startsWith(".")) return bare(posix.join(posix.dirname(fromRel), specifier));
  return null;
}

/**
 * Whether `specifier`, written in the file at repo-relative `fromRel`,
 * designates lib/auth.ts — through the `@/` alias or any relative path, with
 * or without an extension, however it is spelled.
 */
export function designatesAuthModule(specifier: string, fromRel: string): boolean {
  return resolveSpecifier(specifier, fromRel) === AUTH_MODULE_PATH;
}

function isPromiseAll(call: ts.CallExpression): boolean {
  const e = call.expression;
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Promise" && e.name.text === "all";
}

/**
 * The names a dynamic `import("…")` call is destructured into, or `null` when
 * the call is not in one of the two shapes this scan can follow:
 *
 *   const { a, b } = await import("…");
 *   const [{ x }, { a }] = await Promise.all([import("…"), import("…")]);
 *
 * Only shorthand elements count — a rename (`{ auth: whoami }`), a default
 * value or a rest element returns `null`, because the local name would no
 * longer be `auth`.
 */
function dynamicImportBinding(call: ts.CallExpression): string[] | null {
  let node: ts.Node = call;
  let index = -1;
  const holder = node.parent;
  if (ts.isArrayLiteralExpression(holder)) {
    index = holder.elements.findIndex((el) => el === node);
    const all = holder.parent;
    if (!ts.isCallExpression(all) || !isPromiseAll(all) || all.arguments[0] !== holder) return null;
    node = all;
  }
  const awaited = node.parent;
  if (!ts.isAwaitExpression(awaited)) return null;
  const declaration = awaited.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== awaited) return null;

  let pattern: ts.BindingName = declaration.name;
  if (index >= 0) {
    if (!ts.isArrayBindingPattern(pattern)) return null;
    const element = pattern.elements[index];
    if (!element || ts.isOmittedExpression(element) || element.initializer || element.dotDotDotToken) return null;
    pattern = element.name;
  }
  if (!ts.isObjectBindingPattern(pattern)) return null;
  const names: string[] = [];
  for (const el of pattern.elements) {
    if (el.propertyName || el.dotDotDotToken || el.initializer || !ts.isIdentifier(el.name)) return null;
    names.push(el.name.text);
  }
  return names;
}

/**
 * Every way `source` reaches lib/auth.ts other than a named, unaliased
 * import of `auth` / `handlers` / `signIn` / `signOut` through the `@/`
 * alias (or the one destructured dynamic import `dynamicImportBinding`
 * follows). Namespace and default imports, relative paths, side-effect
 * imports, re-exports, `require`, `import x = require()`, renamed or
 * un-destructured dynamic imports: all findings.
 */
export function authImportFormViolationsIn(source: ts.SourceFile, fromRel: string): Finding[] {
  const findings: Finding[] = [];
  const flag = (node: ts.Node, message: string) => findings.push({ line: lineOf(source, node), message });

  const checkNames = (node: ts.Node, names: readonly string[]) => {
    for (const name of names) {
      if (!AUTH_EXPORTS.has(name)) flag(node, `imports "${name}", which lib/auth.ts does not export for this purpose`);
    }
  };

  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && designatesAuthModule(n.moduleSpecifier.text, fromRel)) {
      const clause = n.importClause;
      if (n.moduleSpecifier.text !== "@/lib/auth") flag(n, `non-canonical import of lib/auth ("${n.moduleSpecifier.text}") — the only accepted specifier is exactly "@/lib/auth"`);
      if (!clause) flag(n, "side-effect import of lib/auth");
      else if (clause.name) flag(n, "default import of lib/auth");
      else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) flag(n, "namespace import (`import * as …`) of lib/auth");
      else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          if (el.propertyName) flag(el, `renamed import (\`${el.propertyName.text} as ${el.name.text}\`) of lib/auth`);
          else checkNames(el, [el.name.text]);
        }
      }
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && designatesAuthModule(n.moduleSpecifier.text, fromRel)) {
      flag(n, "re-export from lib/auth");
    } else if (
      ts.isImportEqualsDeclaration(n) &&
      ts.isExternalModuleReference(n.moduleReference) &&
      ts.isStringLiteral(n.moduleReference.expression) &&
      designatesAuthModule(n.moduleReference.expression.text, fromRel)
    ) {
      flag(n, "`import x = require()` of lib/auth");
    } else if (ts.isCallExpression(n)) {
      const [arg] = n.arguments;
      const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(n.expression) && n.expression.text === "require";
      if ((dynamic || required) && arg && ts.isStringLiteralLike(arg) && designatesAuthModule(arg.text, fromRel)) {
        if (required) flag(n, "`require()` of lib/auth");
        else {
          if (arg.text !== "@/lib/auth") flag(n, `non-canonical dynamic import of lib/auth ("${arg.text}") — the only accepted specifier is exactly "@/lib/auth"`);
          const names = dynamicImportBinding(n);
          if (names === null) flag(n, "dynamic import of lib/auth not destructured into shorthand names (`const { auth } = await import(…)`)");
          else checkNames(n, names);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return findings;
}

/** Whether this file binds the local name `auth` to lib/auth's `auth`, by one of the two allowed forms. */
function bindsAuth(source: ts.SourceFile, fromRel: string): boolean {
  let bound = false;
  const visit = (n: ts.Node) => {
    if (bound) return;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && designatesAuthModule(n.moduleSpecifier.text, fromRel)) {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((el) => !el.propertyName && el.name.text === "auth")) bound = true;
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteralLike(arg) && designatesAuthModule(arg.text, fromRel) && dynamicImportBinding(n)?.includes("auth")) bound = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return bound;
}

/**
 * Whether the identifier `id` is a RUNTIME use of the name it spells, as
 * opposed to a place where the same word is only a label: a property name
 * (`x.auth`, `{ auth: 1 }`, `{ auth() {} }`, `<X auth={…}/>`), a binding or
 * parameter being declared, or an import specifier.
 */
function isRuntimeReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p)) return p.name !== id;
  if (ts.isPropertyAssignment(p) || ts.isJsxAttribute(p)) return p.name !== id;
  if (ts.isBindingElement(p)) return p.initializer === id;
  if (ts.isExportSpecifier(p)) return (p.propertyName ?? p.name) === id;
  if (ts.isImportSpecifier(p) || ts.isNamespaceImport(p) || ts.isImportClause(p)) return false;
  if (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) return p.name !== id;
  if (
    ts.isMethodDeclaration(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isMethodSignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p)
  ) {
    return p.name !== id;
  }
  return true;
}

/**
 * Every runtime reference to a local called `name` inside `root` (type
 * positions are not runtime). Scope-unaware on purpose: a parameter or inner
 * variable that shadows `auth` is counted too. That can only over-report — a
 * spurious reader fails the test and asks for a probe or a rename — never
 * hide one, and tracking scopes would be code that can itself be wrong.
 */
function runtimeReferencesTo(root: ts.Node, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTypeNode(n)) return;
    if (ts.isIdentifier(n) && n.text === name && isRuntimeReference(n)) found.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

/** Names a top-level statement introduces, for the readers table: `path::name`. */
function declaredNamesOf(statement: ts.Statement, source: ts.SourceFile): string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return [statement.name?.text ?? "default"];
  if (ts.isExportAssignment(statement)) return ["default"];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .filter((decl) => runtimeReferencesTo(decl, "auth").length > 0)
      .map((decl) => decl.name.getText(source));
  }
  // `export { auth }` and anything else at module level: no name a probe could be keyed on.
  return [`<module level, line ${lineOf(source, statement)}>`];
}

/**
 * The top-level declarations of `source` that use the session reader: every
 * statement that mentions the local `auth` (call, value, re-export, or hidden
 * inside a wrapper such as `export const f = cache(async () => auth())`).
 * A declaration is attributed whole — nothing is missed for being nested in a
 * call the way a "top-level function calling `auth`" rule would miss it.
 * Empty unless the file binds `auth` by an allowed form.
 */
export function sessionReaderNamesIn(source: ts.SourceFile, fromRel: string): string[] {
  if (!bindsAuth(source, fromRel)) return [];
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (runtimeReferencesTo(statement, "auth").length === 0) continue;
    names.push(...declaredNamesOf(statement, source));
  }
  return names;
}

/**
 * Every use of the session in `source` that is NOT "read the role": a call to
 * `auth()` whose result is not bound by `const x = await auth()`, a bare
 * reference to `auth`, and any use of the bound variable other than
 * `x.user.role` / `x?.user?.role`.
 */
export function sessionReadsBeyondRoleIn(source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const flag = (node: ts.Node, message: string) => findings.push({ line: lineOf(source, node), message });
  const bound = new Set<string>();

  for (const id of runtimeReferencesTo(source, "auth")) {
    const call = id.parent;
    if (!ts.isCallExpression(call) || call.expression !== id) {
      flag(id, "`auth` is used other than by calling it");
      continue;
    }
    const awaited = ts.isAwaitExpression(call.parent) ? call.parent : call;
    const declaration = awaited.parent;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer === awaited && ts.isIdentifier(declaration.name)) {
      bound.add(declaration.name.text);
    } else {
      flag(call, "the result of `auth()` is not bound by `const x = await auth()`");
    }
  }

  for (const name of bound) {
    for (const use of runtimeReferencesTo(source, name)) {
      const user = use.parent;
      const role = user.parent;
      const readsRole =
        ts.isPropertyAccessExpression(user) &&
        user.expression === use &&
        user.name.text === "user" &&
        ts.isPropertyAccessExpression(role) &&
        role.expression === user &&
        role.name.text === "role";
      if (!readsRole) {
        // Show the whole expression the variable heads (`session?.user?.email`), not just its first hop.
        let chain: ts.Node = use;
        while (ts.isPropertyAccessExpression(chain.parent) && chain.parent.expression === chain) chain = chain.parent;
        flag(use, `\`${name}\` is read other than as \`${name}.user.role\`: \`${chain.getText(source).slice(0, 60)}\``);
      }
    }
  }
  return findings;
}

/**
 * Every `import(…)` / `require(…)` whose specifier is not a string literal —
 * `import("@/lib/" + "auth")`, `import(name)`. The scan resolves specifiers
 * textually, so a computed one reaches lib/auth (or next-auth) by a path it
 * cannot see. None exists in the domain today (the test asserts it), so the
 * form is banned rather than tolerated.
 */
export function computedModuleSpecifiersIn(source: ts.SourceFile): Finding[] {
  const findings: Finding[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(n.expression) && n.expression.text === "require";
      const [arg] = n.arguments;
      if ((dynamic || required) && !(arg && ts.isStringLiteralLike(arg))) {
        findings.push({
          line: lineOf(source, n),
          message: `\`${dynamic ? "import" : "require"}()\` with a computed specifier: \`${n.getText(source).slice(0, 60)}\``,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return findings;
}

// --- The role-only exemption: HOW the role is used ---------------------------

/**
 * The functions a role may be handed to, and the module each must be imported
 * from. `hasMinRole(undefined, …)` is false, so `can(undefined, …)` and
 * `getAdminAccess(undefined)` refuse: a voided session lands in the
 * no-permission branch by construction. `role !== "VIEWER"` is the opposite —
 * an undefined role satisfies it — so a role read anywhere else is not covered.
 */
const ROLE_GUARDS: Readonly<Record<string, string>> = {
  can: "lib/access",
  getAdminAccess: "lib/adminAccess",
};

/**
 * The local names `source` binds to a ROLE_GUARDS function, resolved through
 * its imports: an alias is followed, and a same-named function that is not the
 * imported one does not count.
 */
function roleGuardLocalNames(source: ts.SourceFile, fromRel: string): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const resolved = resolveSpecifier(statement.moduleSpecifier.text, fromRel);
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (!el.isTypeOnly && ROLE_GUARDS[imported] === resolved) names.add(el.name.text);
    }
  }
  return names;
}

/** `use` (a reference to a variable bound by `auth()`) as the `x.user.role` access it heads, or `null`. */
function asRoleRead(use: ts.Identifier): ts.PropertyAccessExpression | null {
  const user = use.parent;
  const role = user.parent;
  if (
    ts.isPropertyAccessExpression(user) &&
    user.expression === use &&
    user.name.text === "user" &&
    ts.isPropertyAccessExpression(role) &&
    role.expression === user &&
    role.name.text === "role"
  ) {
    return role;
  }
  return null;
}

/** The names bound by `const x = await auth()`. */
function sessionVariableNames(source: ts.SourceFile): Set<string> {
  const bound = new Set<string>();
  for (const id of runtimeReferencesTo(source, "auth")) {
    const call = id.parent;
    if (!ts.isCallExpression(call) || call.expression !== id) continue;
    const awaited = ts.isAwaitExpression(call.parent) ? call.parent : call;
    const declaration = awaited.parent;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer === awaited && ts.isIdentifier(declaration.name)) {
      bound.add(declaration.name.text);
    }
  }
  return bound;
}

/**
 * Every read of the session's role that is NOT the first argument of a call to
 * `can` or `getAdminAccess` (each resolved by its import, see ROLE_GUARDS).
 * A comparison (`role === "CLIENT"`, `role !== "VIEWER"`), a ternary, a
 * fallback (`role ?? "X"`), a role handed to any other function: all findings,
 * the role is then used for a decision this exemption cannot vouch for.
 */
export function roleReadsOutsideGuardsIn(source: ts.SourceFile, fromRel: string): Finding[] {
  const findings: Finding[] = [];
  const guards = roleGuardLocalNames(source, fromRel);
  for (const name of sessionVariableNames(source)) {
    for (const use of runtimeReferencesTo(source, name)) {
      const read = asRoleRead(use);
      if (!read) continue;
      const call = read.parent;
      const guarded = ts.isCallExpression(call) && call.arguments[0] === read && ts.isIdentifier(call.expression) && guards.has(call.expression.text);
      if (!guarded) {
        findings.push({
          line: lineOf(source, read),
          message: `the role (\`${read.getText(source)}\`) is used other than as the first argument of can() / getAdminAccess()`,
        });
      }
    }
  }
  return findings;
}

// --- Who may build a session reader of their own -----------------------------

/**
 * lib/auth.ts is the one `NextAuth()` instance that carries the liveness gate.
 * A second `NextAuth()`, a `getToken` (next-auth/jwt), or anything built from
 * `@/auth.config` (the shared config, without the gate's `jwt` check) reads
 * sessions without it, and no discovery above would see it: it never imports
 * lib/auth. So every VALUE import of those is a finding unless the file is in
 * an allowed set the test states, each with its reason. A type-only import
 * reads nothing and is always fine.
 */
const SESSION_INFRASTRUCTURE: ReadonlyArray<{ label: string; matches: (specifier: string, fromRel: string) => boolean }> = [
  { label: "next-auth", matches: (s) => s === "next-auth" },
  { label: "next-auth/jwt", matches: (s) => s === "next-auth/jwt" },
  { label: "@/auth.config", matches: (s, fromRel) => resolveSpecifier(s, fromRel) === "auth.config" },
];

function infrastructureLabel(specifier: string, fromRel: string): string | null {
  return SESSION_INFRASTRUCTURE.find((entry) => entry.matches(specifier, fromRel))?.label ?? null;
}

/** Every VALUE import (static, dynamic, `require`, `import = require`, re-export) of next-auth, next-auth/jwt or auth.config in `source`. */
export function sessionInfrastructureImportsIn(source: ts.SourceFile, fromRel: string): Finding[] {
  const findings: Finding[] = [];
  const flag = (node: ts.Node, label: string, how: string) => findings.push({ line: lineOf(source, node), message: `${how} of ${label}` });
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const label = infrastructureLabel(n.moduleSpecifier.text, fromRel);
      const clause = n.importClause;
      const typeOnly =
        !!clause &&
        (clause.isTypeOnly ||
          (!clause.name &&
            !!clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((el) => el.isTypeOnly)));
      if (label && !typeOnly) flag(n, label, "value import");
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) {
      const label = infrastructureLabel(n.moduleSpecifier.text, fromRel);
      if (label) flag(n, label, "re-export");
    } else if (
      ts.isImportEqualsDeclaration(n) &&
      !n.isTypeOnly &&
      ts.isExternalModuleReference(n.moduleReference) &&
      ts.isStringLiteral(n.moduleReference.expression)
    ) {
      const label = infrastructureLabel(n.moduleReference.expression.text, fromRel);
      if (label) flag(n, label, "`import x = require()`");
    } else if (ts.isCallExpression(n)) {
      const [arg] = n.arguments;
      const dynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(n.expression) && n.expression.text === "require";
      if ((dynamic || required) && arg && ts.isStringLiteralLike(arg)) {
        const label = infrastructureLabel(arg.text, fromRel);
        if (label) flag(n, label, dynamic ? "dynamic import" : "`require()`");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return findings;
}

// --- Domain --------------------------------------------------------------

const ROOT = process.cwd();
/** Everything tsconfig's `allowJs` lets the compiler resolve, plus the module-flavoured variants. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

/**
 * Paths the walk never enters, each with why it isn't application code
 * (repo-relative; `node_modules` and `.claude` are skipped at ANY depth by
 * name — FOREIGN_TREE_DIRS in astScan.ts). Same table, same reasons, as
 * tests/prisma-raw-literal-guard.test.ts and tests/runtime-dependencies.test.ts:
 * the domain is "the whole repository minus these", so a file in a new
 * top-level folder is swept up by default instead of needing this list
 * updated to see it.
 */
const EXCLUDED: ReadonlyArray<{ path: string; reason: string }> = [
  { path: ".next", reason: "build output; its inputs are checked instead" },
  { path: ".git", reason: "not source" },
  { path: "tests", reason: "vitest only — and its planted probe sources are not application code" },
  { path: "tests-integration", reason: "vitest only" },
  { path: "docs", reason: "documentation sources" },
  { path: "deploy", reason: "host-side VPS tooling" },
  { path: "public", reason: "static assets, no modules" },
  { path: "app/generated", reason: "Prisma client, generated at build — vendor code, not ours to check" },
  { path: "scripts", reason: "host-side tooling, never part of the running application" },
];

function rel(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join("/");
}

function isExcluded(relPath: string): boolean {
  return EXCLUDED.some(({ path }) => relPath === path || relPath.startsWith(path + "/"));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (FOREIGN_TREE_DIRS.has(name) || isExcluded(rel(full))) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))) out.push(full);
  }
}

export type DomainFile = { rel: string; source: ts.SourceFile };

/**
 * The domain: every application source file (the repository minus EXCLUDED).
 * `paths` lists all of them, for the anti-vacuity witnesses; `files` holds
 * the parsed ones that spell `auth` or call `import()` / `require()` — any
 * other file cannot reach lib/auth.ts, and skipping the parse keeps the walk cheap.
 */
export function sessionDomain(): { paths: string[]; files: DomainFile[] } {
  const absolutes: string[] = [];
  walk(ROOT, absolutes);
  const files: DomainFile[] = [];
  for (const abs of absolutes) {
    // `auth` spelled anywhere, or a call to import()/require(): a computed specifier ("@/lib/" + "au" + "th") spells no `auth` at all.
    if (!/auth|\bimport\s*\(|\brequire\s*\(/.test(readFileSync(abs, "utf8"))) continue;
    files.push({ rel: rel(abs), source: parseSource(rel(abs), abs) });
  }
  return { paths: absolutes.map(rel), files };
}
