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

// --- Writers of the session-killing columns (lot 3) -------------------------

const USER_WRITE_METHODS: ReadonlySet<string> = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
const CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["password", "role"]);

export type UserWriteSite = {
  /** "repository/users.ts::updatePassword#update" — file, enclosing function, method. */
  site: string;
  /** `create`/`createMany`: a NEW row, nothing earlier to invalidate. Not analysed. */
  createOnly: boolean;
  /**
   * The data this write can touch `password` or `role` with: an explicit key, or
   * a spread / data object the scan cannot read (an opaque value is assumed to
   * carry them — what is not understood is refused, never normalised to "safe").
   */
  writesCredentials: boolean;
  /** The SAME data object carries `sessionVersion: { increment: 1 }` (possibly under a conditional). */
  bumps: boolean;
};

type DataShape = { credentials: boolean; bumps: boolean };

function propertyName(n: ts.PropertyName): string | null {
  return ts.isIdentifier(n) || ts.isStringLiteralLike(n) ? n.text : null;
}

/** An object literal somewhere in `node` with `increment: 1`. */
function containsIncrementOne(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && propertyName(n.name) === "increment" && ts.isNumericLiteral(n.initializer) && n.initializer.text === "1") found = true;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The initializer of the first `const|let|var <name> = …` of the file (local constants only; a parameter is not found). */
function localInitializer(file: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (n: ts.Node) => {
    if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n.initializer;
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

/** What a data expression writes. An identifier is followed to a local object literal; anything else is opaque. */
function shapeOf(expr: ts.Expression, file: ts.SourceFile, depth = 0): DataShape {
  const opaque: DataShape = { credentials: true, bumps: false };
  if (depth > 5) return opaque;
  if (ts.isParenthesizedExpression(expr)) return shapeOf(expr.expression, file, depth + 1);
  if (ts.isIdentifier(expr)) {
    const init = localInitializer(file, expr.text);
    return init ? shapeOf(init, file, depth + 1) : opaque;
  }
  if (!ts.isObjectLiteralExpression(expr)) return opaque;
  const shape: DataShape = { credentials: false, bumps: false };
  for (const p of expr.properties) {
    if (ts.isSpreadAssignment(p)) {
      const inner = shapeOf(p.expression, file, depth + 1);
      shape.credentials ||= inner.credentials;
      shape.bumps ||= inner.bumps;
    } else if (ts.isShorthandPropertyAssignment(p)) {
      if (CREDENTIAL_KEYS.has(p.name.text)) shape.credentials = true;
    } else if (ts.isPropertyAssignment(p)) {
      const key = propertyName(p.name);
      if (key === null) shape.credentials = true; // computed key: not understood
      else if (CREDENTIAL_KEYS.has(key)) shape.credentials = true;
      else if (key === "sessionVersion" && containsIncrementOne(p.initializer)) shape.bumps = true;
    } else {
      shape.credentials = true; // method / accessor: not understood
    }
  }
  return shape;
}

/** Nested-write form (`user: { update: { data: { … } } }`): the shape is not a flat object, so search the whole subtree for the keys. */
function deepShapeOf(node: ts.Node): DataShape {
  const shape: DataShape = { credentials: false, bumps: false };
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const key = propertyName(n.name);
      if (key !== null && CREDENTIAL_KEYS.has(key)) shape.credentials = true;
      if (key === "sessionVersion" && containsIncrementOne(n.initializer)) shape.bumps = true;
    } else if (ts.isShorthandPropertyAssignment(n) && CREDENTIAL_KEYS.has(n.name.text)) shape.credentials = true;
    else if (ts.isSpreadAssignment(n)) shape.credentials = true; // not understood
    ts.forEachChild(n, visit);
  };
  visit(node);
  return shape;
}

/** The expression assigned to `key` in an object literal (a shorthand `key` counts as the identifier `key`). */
function propertyOf(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propertyName(p.name) === key) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return p.name;
  }
  return null;
}

function enclosingFunctionName(n: ts.Node): string {
  for (let cur: ts.Node | undefined = n.parent; cur; cur = cur.parent) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && cur.initializer && (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))) {
      return cur.name.text;
    }
  }
  return "<top>";
}

/**
 * Every write of the `User` model in `src`, from the WRITE CALL — `prisma.user.<w>()` /
 * `tx.user.<w>()`, and a nested `user: { … }` inside the `data` of a write on
 * another model (`prisma.contact.update({ data: { user: { update } } })`) — never
 * from a list of files. For each: does its data write `password`/`role`, and
 * does that SAME data object carry `sessionVersion: { increment: 1 }`?
 *
 * Followed: an inline object, a local `const data = { … }` (also when `data`
 * is passed shorthand), spreads of either. Opaque (a parameter spread, a call
 * result) counts as "writes credentials". Not seen by construction: a client
 * under another name than `prisma`/`tx`, raw SQL (the only raw SQL of the app is
 * a SELECT … FOR UPDATE), a writer passed as a value instead of called.
 */
export function userWriteSites(src: Source): UserWriteSite[] {
  const file = parse(src);
  const out: UserWriteSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const modelAccess = n.expression.expression;
      if (
        USER_WRITE_METHODS.has(method) &&
        ts.isPropertyAccessExpression(modelAccess) &&
        ts.isIdentifier(modelAccess.expression) &&
        CLIENT_NAMES.has(modelAccess.expression.text)
      ) {
        const where = `${src.path}::${enclosingFunctionName(n)}`;
        const arg = n.arguments[0];
        if (modelAccess.name.text === "user") {
          if (method === "create" || method === "createMany") {
            out.push({ site: `${where}#${method}`, createOnly: true, writesCredentials: false, bumps: false });
          } else {
            // upsert: only the UPDATE branch can change an existing row; its create branch is a new row.
            const dataKey = method === "upsert" ? "update" : "data";
            const data = arg && ts.isObjectLiteralExpression(arg) ? propertyOf(arg, dataKey) : null;
            const shape: DataShape = data ? shapeOf(data, file) : { credentials: true, bumps: false };
            out.push({ site: `${where}#${method}`, createOnly: false, writesCredentials: shape.credentials, bumps: shape.bumps });
          }
        } else if (arg && ts.isObjectLiteralExpression(arg)) {
          // A write on ANOTHER model: a nested `user: { … }` in its data / create / update.
          for (const key of ["data", "create", "update"]) {
            const data = propertyOf(arg, key);
            const nested = data && ts.isObjectLiteralExpression(data) ? propertyOf(data, "user") : null;
            if (nested) {
              const shape = deepShapeOf(nested);
              out.push({ site: `${where}#${modelAccess.name.text}.${method}.${key}.user`, createOnly: false, writesCredentials: shape.credentials, bumps: shape.bumps });
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}
