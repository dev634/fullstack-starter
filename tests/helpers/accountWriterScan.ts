import ts from "typescript";
import { posix } from "node:path";

/**
 * Discovery of the ACCOUNT WRITERS, from their writes — never from a list of
 * action names (docs/CONVENTIONS.md, "Personne ne modifie la contrainte qui le
 * contraint"). Pure over source text so the test can probe it with planted
 * sources, without touching the tree.
 *
 * Two layers:
 *   - a repository WRITER is an exported function of `repository/*.ts` whose
 *     body (local helpers followed) writes `User`, `JobFunction` or
 *     `PasswordResetToken` through `prisma.<model>.<write>` / `tx.<model>.<write>`;
 *   - an ACTION is an exported function of `actions/**` that reaches one of them,
 *     by module path (`@/repository/x` or a relative path) AND by binding
 *     (named import, aliased or not; `import * as ns` then `ns.writer()`), with
 *     local helpers followed.
 */

export const ACCOUNT_MODELS: ReadonlySet<string> = new Set(["user", "jobFunction", "passwordResetToken"]);
const WRITE_METHODS: ReadonlySet<string> = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const CLIENT_NAMES: ReadonlySet<string> = new Set(["prisma", "tx"]);

export type Source = { path: string; text: string };
function parse(src: Source): ts.SourceFile {
  return ts.createSourceFile(src.path, src.text, ts.ScriptTarget.Latest, true);
}

type FnInfo = {
  name: string;
  exported: boolean;
  /** Identifier calls: `foo()`. */
  idents: Set<string>;
  /** Member calls: `ns.foo()` as [object identifier, property]. */
  members: [string, string][];
  /** `prisma.model.write()` calls, as the model name. */
  writes: Set<string>;
  text: string;
};

function infoOf(name: string, exported: boolean, body: ts.Node): FnInfo {
  const info: FnInfo = { name, exported, idents: new Set(), members: [], writes: new Set(), text: body.getText() };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) info.idents.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) {
        if (ts.isIdentifier(e.expression)) info.members.push([e.expression.text, e.name.text]);
        // prisma.user.create(...) / tx.user.create(...)
        const model = e.expression;
        if (
          WRITE_METHODS.has(e.name.text) &&
          ts.isPropertyAccessExpression(model) &&
          ts.isIdentifier(model.expression) &&
          CLIENT_NAMES.has(model.expression.text)
        ) {
          info.writes.add(model.name.text);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return info;
}

function topLevelFunctions(file: ts.SourceFile): FnInfo[] {
  const out: FnInfo[] = [];
  const isExported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  ts.forEachChild(file, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      out.push(infoOf(node.name.text, isExported(node), node.body));
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          out.push(infoOf(d.name.text, isExported(node), d.initializer.body));
        }
      }
    }
  });
  return out;
}

/** Everything a function reaches through local helpers: identifier calls, member calls, writes, and the helpers' own text. */
function reach(fn: FnInfo, all: readonly FnInfo[]): FnInfo {
  const byName = new Map(all.map((f) => [f.name, f]));
  const seen = new Set<string>();
  const out: FnInfo = { name: fn.name, exported: fn.exported, idents: new Set(), members: [], writes: new Set(), text: "" };
  const walk = (f: FnInfo) => {
    if (seen.has(f.name)) return;
    seen.add(f.name);
    f.idents.forEach((i) => out.idents.add(i));
    out.members.push(...f.members);
    f.writes.forEach((w) => out.writes.add(w));
    out.text += f.text + "\n";
    for (const i of f.idents) {
      const local = byName.get(i);
      if (local) walk(local);
    }
  };
  walk(fn);
  return out;
}

/** "repository/users.ts::create" for each exported function of a repository file that writes an account model. */
export function repositoryWriters(src: Source): string[] {
  const fns = topLevelFunctions(parse(src));
  return fns
    .filter((f) => f.exported)
    .filter((f) => [...reach(f, fns).writes].some((m) => ACCOUNT_MODELS.has(m)))
    .map((f) => `${src.path}::${f.name}`);
}

/** The text of an exported repository function, followed through local helpers — for "this writer only ever touches CLIENT accounts". */
export function repositoryFunctionText(src: Source, name: string): string {
  const fns = topLevelFunctions(parse(src));
  const fn = fns.find((f) => f.name === name);
  return fn ? reach(fn, fns).text : "";
}

type Binding = { module: string; imported: string };

/** Resolve an import specifier to a repo-relative path without extension ("@/x/y" or relative), or null for a package. */
export function resolveModule(fromPath: string, spec: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith(".")) return posix.normalize(posix.join(posix.dirname(fromPath), spec));
  return null;
}

function importBindings(file: ts.SourceFile, path: string): { bindings: Map<string, Binding>; dynamic: string[] } {
  const bindings = new Map<string, Binding>();
  const dynamic: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const mod = resolveModule(path, n.moduleSpecifier.text);
      const clause = n.importClause;
      if (mod && clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          bindings.set(clause.namedBindings.name.text, { module: mod, imported: "*" });
        } else {
          for (const el of clause.namedBindings.elements) {
            bindings.set(el.name.text, { module: mod, imported: (el.propertyName ?? el.name).text });
          }
        }
      }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = n.arguments;
      const mod = arg && ts.isStringLiteral(arg) ? resolveModule(path, arg.text) : null;
      dynamic.push(mod ?? "<computed>");
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return { bindings, dynamic };
}

/** The lib/accountPolicy symbols a reached function calls, by binding. */
function policySymbolsOf(r: FnInfo, bindings: Map<string, Binding>): string[] {
  const out = new Set<string>();
  for (const ident of r.idents) {
    const b = bindings.get(ident);
    if (b?.module === "lib/accountPolicy" && b.imported !== "*") out.add(b.imported);
  }
  for (const [obj, prop] of r.members) {
    const b = bindings.get(obj);
    if (b?.module === "lib/accountPolicy" && b.imported === "*") out.add(prop);
  }
  return [...out].sort();
}

/**
 * What a LOCAL guard of `src` (e.g. refuseIfHeldByAdmin) itself reaches of
 * lib/accountPolicy — so a guard whose body was emptied, or never applies the
 * rule, is seen for what it is rather than trusted by its name. `null` if the
 * file has no such function.
 */
export function localGuardPolicySymbols(src: Source, name: string): string[] | null {
  const file = parse(src);
  const { bindings } = importBindings(file, src.path);
  const fns = topLevelFunctions(file);
  const fn = fns.find((f) => f.name === name);
  return fn ? policySymbolsOf(reach(fn, fns), bindings) : null;
}

/** Parse a reached source text (a function body, or several concatenated) as code: comments are not nodes. */
function codeOf(text: string): ts.SourceFile {
  return ts.createSourceFile("claim.ts", text, ts.ScriptTarget.Latest, true);
}

/** Does the CODE contain an object property `prop: "value"`? A comment mentioning it does not count. */
export function hasLiteralProperty(text: string, prop: string, value: string): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === prop &&
      ts.isStringLiteralLike(n.initializer) &&
      n.initializer.text === value
    ) {
      found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(codeOf(text));
  return found;
}

/** Does the CODE compare something to the string literal `value` with ===, !==, == or !=? */
export function hasComparisonWith(text: string, value: string): boolean {
  let found = false;
  const ops = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
  const isValue = (e: ts.Expression) => ts.isStringLiteralLike(e) && e.text === value;
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && ops.has(n.operatorToken.kind) && (isValue(n.left) || isValue(n.right))) found = true;
    ts.forEachChild(n, visit);
  };
  visit(codeOf(text));
  return found;
}

export type ActionReport = {
  /** "actions/x/x.ts::fn" */
  action: string;
  /** Repository writers it reaches, "repository/users.ts::create". */
  writers: string[];
  /**
   * The symbols of lib/accountPolicy it (transitively, locally) reaches, resolved by
   * BINDING (an aliased import reports its real name; `ns.fn()` of a namespace
   * import reports `fn`). Any call counts — which one is the test's business.
   */
  policySymbols: string[];
  /** The local guards (`localGuards`) it reaches. */
  localGuards: string[];
  /** The reached text, for the few exemptions that claim something about it. */
  text: string;
};

/**
 * Every exported action of `src` that reaches one of `writers` (full names,
 * "repository/users.ts::create"). Also returns any dynamic import of a
 * repository module: a form the scan does not follow, which the test bans.
 */
export function accountActionsIn(
  src: Source,
  writers: ReadonlySet<string>,
  localGuards: ReadonlySet<string>
): { reports: ActionReport[]; dynamicRepositoryImports: string[] } {
  const file = parse(src);
  const { bindings, dynamic } = importBindings(file, src.path);
  const fns = topLevelFunctions(file);
  const reports: ActionReport[] = [];
  for (const fn of fns.filter((f) => f.exported)) {
    const r = reach(fn, fns);
    const hit = new Set<string>();
    for (const ident of r.idents) {
      const b = bindings.get(ident);
      if (b && writers.has(`${b.module}.ts::${b.imported}`)) hit.add(`${b.module}.ts::${b.imported}`);
    }
    for (const [obj, prop] of r.members) {
      const b = bindings.get(obj);
      if (b?.imported === "*" && writers.has(`${b.module}.ts::${prop}`)) hit.add(`${b.module}.ts::${prop}`);
    }
    if (hit.size === 0) continue;
    reports.push({
      action: `${src.path}::${fn.name}`,
      writers: [...hit].sort(),
      policySymbols: policySymbolsOf(r, bindings),
      localGuards: [...r.idents].filter((i) => localGuards.has(i)),
      text: r.text,
    });
  }
  return { reports, dynamicRepositoryImports: dynamic.filter((m) => m.startsWith("repository/") || m === "<computed>") };
}
