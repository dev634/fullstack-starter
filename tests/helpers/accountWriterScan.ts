import ts from "typescript";
import { posix } from "node:path";
import { PRISMA_CREATE_METHODS, PRISMA_DELETE_METHODS, isPrismaWrite } from "./prismaMethods";

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
          isPrismaWrite(e.name.text) &&
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

const CREDENTIAL_KEYS: ReadonlySet<string> = new Set(["password", "role"]);
/** Keys of a Prisma argument that only READ (a `user` under them is a filter or a projection, not a write). */
const READ_ONLY_KEYS: ReadonlySet<string> = new Set(["where", "select", "include", "omit", "orderBy"]);

export type UserWriteSite = {
  /** "repository/users.ts::updateProfile#update" — file, enclosing function, method. */
  site: string;
  /** `create`/`createMany`/`createManyAndReturn`: a NEW row, nothing earlier to invalidate: no bump required. */
  createOnly: boolean;
  /**
   * The data this write can touch `password` or `role` with on an EXISTING row:
   * an explicit key, or a spread / data object the scan cannot read (an opaque
   * value is assumed to carry them — what is not understood is refused, never
   * normalised to "safe"). False for a pure create.
   */
  writesCredentials: boolean;
  /**
   * A NEW row (a `create`, a `createMany`, an upsert's create branch) is written
   * with `password`/`role` (or data the scan cannot read). Allowed only by the
   * `create` exemption, which the test must then actually hold.
   */
  createsCredentials: boolean;
  /** The SAME data object carries a valid bump: `sessionVersion: { increment: 1 }` (or `cond ? { increment: 1 } : undefined`). */
  bumps: boolean;
  /** A `sessionVersion` key whose value is NOT a valid bump (`0`, `{ set: 0 }`, `{ decrement: 1 }`, a ternary with another else…): the counter must only ever grow. */
  badVersionWrite: boolean;
};

type DataShape = { credentials: boolean; bumps: boolean; badVersion: boolean };

function propertyName(n: ts.PropertyName): string | null {
  return ts.isIdentifier(n) || ts.isStringLiteralLike(n) ? n.text : null;
}

function unparen(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unparen(e.expression) : e;
}

/** Exactly `{ increment: 1 }` — nothing else in the object. */
function isIncrementOneObject(e: ts.Expression): boolean {
  const x = unparen(e);
  if (!ts.isObjectLiteralExpression(x) || x.properties.length !== 1) return false;
  const p = x.properties[0];
  return ts.isPropertyAssignment(p) && propertyName(p.name) === "increment" && ts.isNumericLiteral(p.initializer) && p.initializer.text === "1";
}

/** The ONLY accepted values of a `sessionVersion` key: `{ increment: 1 }`, or `<cond> ? { increment: 1 } : undefined`. */
function isValidBump(e: ts.Expression): boolean {
  const x = unparen(e);
  if (isIncrementOneObject(x)) return true;
  if (!ts.isConditionalExpression(x)) return false;
  const whenFalse = unparen(x.whenFalse);
  return isIncrementOneObject(x.whenTrue) && ts.isIdentifier(whenFalse) && whenFalse.text === "undefined";
}

function enclosingFunctionLike(n: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let cur: ts.Node | undefined = n.parent; cur; cur = cur.parent) {
    if (ts.isFunctionLike(cur) && "body" in cur) return cur as ts.FunctionLikeDeclaration;
  }
  return null;
}

/** The root identifier of `a.b[c].d` (through parentheses, `!`, `as` and `satisfies`), or null. */
function rootIdentifier(e: ts.Expression): ts.Identifier | null {
  let cur: ts.Expression = e;
  for (;;) {
    if (ts.isIdentifier(cur)) return cur;
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
    else return null;
  }
}

const OBJECT_MUTATORS: ReadonlySet<string> = new Set(["assign", "defineProperty", "defineProperties", "setPrototypeOf"]);

/** Is `n` a property write / delete / `Object.assign`-style mutation whose target is rooted at `name`? */
function mutatesName(n: ts.Node, name: string): boolean {
  const rootedAtName = (e: ts.Expression) => {
    const root = rootIdentifier(e);
    return root !== null && root.text === name && root !== e; // a property of it, not a rebinding of the name itself
  };
  if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return rootedAtName(n.left);
  if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) return rootedAtName(n.operand);
  if (ts.isDeleteExpression(n)) return rootedAtName(n.expression);
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "Object" && OBJECT_MUTATORS.has(n.expression.name.text)) {
    const first = n.arguments[0];
    return first !== undefined && rootIdentifier(first)?.text === name;
  }
  return false;
}

/** Every identifier a binding name introduces (`x`, `{ a, b: [c] }`, …). */
function boundNames(b: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(b)) out.push(b.text);
  else for (const el of b.elements) if (!ts.isOmittedExpression(el)) boundNames(el.name, out);
  return out;
}

/**
 * The initializer of the one `const <name> = …` that `site` (an identifier)
 * refers to, or null — and null means OPAQUE (assumed to write credentials).
 *
 * What the code does, exactly. The declaration is followed only when ALL hold:
 *   - it is a `const` with an initializer, in a block that encloses the use,
 *     BEFORE it, and in the SAME function as the use (a closure over an outer
 *     function's variable is not followed);
 *   - no parameter of that function (patterns included) has the name;
 *   - that `const` is the ONLY binding of the name in the function, nested
 *     blocks included: any other — `let`/`var`, a destructuring
 *     (`const { data } = input`), a `for (const data of …)`, a `catch (data)`,
 *     a function or class declaration, a second `const` in another block — makes
 *     the name opaque rather than guess which one is nearer. (Bindings in
 *     NESTED FUNCTIONS are other scopes and are ignored.)
 *   - the name is never MUTATED anywhere in the function, nested functions
 *     included: a property assignment (\`data.password = h\`, \`+=\`, \`++\`), a
 *     \`delete data.x\`, or \`Object.assign(data, …)\` (also defineProperty /
 *     defineProperties / setPrototypeOf) — the literal's keys no longer tell
 *     what is written.
 * Resolving to "the first declaration of that name in the file" let an
 * unrelated \`const data = { name }\` elsewhere make a parameter \`data\` look harmless.
 */
function localInitializer(site: ts.Identifier): ts.Expression | null {
  const fn = enclosingFunctionLike(site);
  if (fn?.parameters.some((p) => boundNames(p.name).includes(site.text))) return null;
  const file = site.getSourceFile();
  const root: ts.Node = fn?.body ?? file;
  const candidates: ts.VariableDeclaration[] = [];
  let otherBindings = 0;
  let mutated = false;
  const countBinding = () => {
    otherBindings++;
  };
  const visit = (n: ts.Node, sameFunction: boolean) => {
    if (mutatesName(n, site.text)) mutated = true; // nested functions included
    const nested = n !== root && ts.isFunctionLike(n);
    if (nested) {
      // another function's scope: only mutations (above) matter inside it
      ts.forEachChild(n, (c) => visit(c, false));
      return;
    }
    if (sameFunction) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === site.text && n.initializer && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0 && ts.isVariableStatement(n.parent.parent)) {
        candidates.push(n);
      } else if (ts.isVariableDeclaration(n) && boundNames(n.name).includes(site.text)) {
        countBinding(); // let / var / destructuring / for-of / catch / const without a followable shape
      } else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name?.text === site.text) {
        countBinding();
      }
    }
    ts.forEachChild(n, (c) => visit(c, sameFunction));
  };
  visit(root, true);
  if (mutated || otherBindings > 0) return null;
  let best: ts.VariableDeclaration | null = null;
  for (const n of candidates) {
    const scope = n.parent.parent.parent; // VariableDeclarationList -> VariableStatement -> Block | SourceFile
    if (scope.getStart() <= site.getStart() && site.getEnd() <= scope.getEnd() && n.getEnd() <= site.getStart() && (best === null || n.getStart() > best.getStart())) best = n;
  }
  if (candidates.length > 1) return null; // two consts of that name in the function: not guessed
  return (best as ts.VariableDeclaration | null)?.initializer ?? null;
}

/** What a data expression writes. An identifier is followed to a local object literal; anything else is opaque. */
function shapeOf(expr: ts.Expression, depth = 0): DataShape {
  const opaque: DataShape = { credentials: true, bumps: false, badVersion: false };
  if (depth > 5) return opaque;
  if (ts.isParenthesizedExpression(expr)) return shapeOf(expr.expression, depth + 1);
  if (ts.isIdentifier(expr)) {
    const init = localInitializer(expr);
    return init ? shapeOf(init, depth + 1) : opaque;
  }
  if (!ts.isObjectLiteralExpression(expr)) return opaque;
  const shape: DataShape = { credentials: false, bumps: false, badVersion: false };
  for (const p of expr.properties) {
    if (ts.isSpreadAssignment(p)) {
      const inner = shapeOf(p.expression, depth + 1);
      shape.credentials ||= inner.credentials;
      shape.bumps ||= inner.bumps;
      shape.badVersion ||= inner.badVersion;
    } else if (ts.isShorthandPropertyAssignment(p)) {
      if (CREDENTIAL_KEYS.has(p.name.text)) shape.credentials = true;
      if (p.name.text === "sessionVersion") shape.badVersion = true; // a bare variable is not a bump
    } else if (ts.isPropertyAssignment(p)) {
      const key = propertyName(p.name);
      if (key === null) shape.credentials = true; // computed key: not understood
      else if (CREDENTIAL_KEYS.has(key)) shape.credentials = true;
      else if (key === "sessionVersion") {
        if (isValidBump(p.initializer)) shape.bumps = true;
        else shape.badVersion = true;
      }
    } else {
      shape.credentials = true; // method / accessor: not understood
    }
  }
  return shape;
}

/** Nested-write form (`user: { update: { data: { … } } }`): the shape is not a flat object, so search the whole subtree for the keys. */
function deepShapeOf(node: ts.Node): DataShape {
  const shape: DataShape = { credentials: false, bumps: false, badVersion: false };
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n)) {
      const key = propertyName(n.name);
      if (key !== null && CREDENTIAL_KEYS.has(key)) shape.credentials = true;
      if (key === "sessionVersion") {
        if (isValidBump(n.initializer)) shape.bumps = true;
        else shape.badVersion = true;
      }
    } else if (ts.isShorthandPropertyAssignment(n)) {
      if (CREDENTIAL_KEYS.has(n.name.text)) shape.credentials = true;
      if (n.name.text === "sessionVersion") shape.badVersion = true;
    } else if (ts.isSpreadAssignment(n)) shape.credentials = true; // not understood
    ts.forEachChild(n, visit);
  };
  visit(node);
  return shape;
}

/** Every `user: …` property under `node` at ANY depth (not under a read-only key, not inside another `user`), with its key path from `node`. */
function nestedUserWrites(node: ts.Node): { path: string[]; value: ts.Expression }[] {
  const out: { path: string[]; value: ts.Expression }[] = [];
  const visit = (n: ts.Node, path: string[]) => {
    if (ts.isPropertyAssignment(n)) {
      const key = propertyName(n.name);
      if (key !== null && READ_ONLY_KEYS.has(key)) return;
      if (key === "user") {
        out.push({ path: [...path, key], value: n.initializer });
        return; // its whole subtree is read by deepShapeOf
      }
      ts.forEachChild(n, (c) => visit(c, key === null ? path : [...path, key]));
      return;
    }
    ts.forEachChild(n, (c) => visit(c, path));
  };
  ts.forEachChild(node, (c) => visit(c, []));
  return out;
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

const UNREADABLE: DataShape = { credentials: true, bumps: false, badVersion: false };

/**
 * Every write of the `User` model in `src`, from the WRITE CALL — `prisma.user.<w>()` /
 * `tx.user.<w>()`, and a nested `user: { … }` at ANY depth inside the argument of
 * a write on another model (`prisma.client.update({ data: { contacts: { update:
 * { data: { user: { update } } } } } })`) — never from a list of files. For each:
 * does its data write `password`/`role`, and does that SAME data object carry
 * `sessionVersion: { increment: 1 }`? Any `sessionVersion` value that is not a
 * valid bump is flagged on its own (`badVersionWrite`), credentials or not.
 *
 * Followed: an inline object, a `const data = { … }` declared before the call in
 * the SAME function (also when `data` is passed shorthand), spreads of either.
 * Opaque (a parameter, a spread of one, a call result, a `let`, a name bound
 * twice in the function, a name mutated by property assignment / delete /
 * Object.assign — see localInitializer) counts as "writes credentials".
 * WHAT IS A WRITE: fails CLOSED (tests/helpers/prismaMethods.ts). On `prisma`/`tx`, any
 * `<model>.<method>()` that is not one of the eight reads the client exposes
 * (findUnique[OrThrow], findFirst[OrThrow], findMany, count, aggregate, groupBy) is a
 * write: `updateManyAndReturn` / `createManyAndReturn` are seen, and so is a method
 * the client gains or a probe invents (read as an update of its `data`; no `data`
 * the scan can read = opaque = RED). A `create*` is a new row (the create exemption);
 * `delete`/`deleteMany` write no column and are no site. The one thing this does NOT
 * close: a NEW READ method of the client is a write here until it is added to
 * PRISMA_READ_METHODS (red, never silently green).
 * REMAINING LIMITS, stated: an alias (`const d = data; d.password = h`) or a
 * helper that mutates its argument (`fill(data)`) is not followed — the literal
 * is still read as it was written; a `const` declared in an OUTER function and
 * used in a closure is opaque (safe) but one mutated only through a reference
 * held elsewhere is not seen. NOT seen by construction: a client under another name
 * than `prisma`/`tx`, raw SQL (the only raw SQL of the app is a SELECT … FOR
 * UPDATE), a writer passed as a value instead of called, a `sessionVersion`
 * hidden inside an opaque spread, a User written through a relation FROM the
 * User model itself (`prisma.user.update({ data: { contact: { update … } } })`).
 */
export function userWriteSites(src: Source): UserWriteSite[] {
  const file = parse(src);
  const out: UserWriteSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const modelAccess = n.expression.expression;
      if (
        isPrismaWrite(method) &&
        !PRISMA_DELETE_METHODS.has(method) &&
        ts.isPropertyAccessExpression(modelAccess) &&
        ts.isIdentifier(modelAccess.expression) &&
        CLIENT_NAMES.has(modelAccess.expression.text)
      ) {
        const where = `${src.path}::${enclosingFunctionName(n)}`;
        const arg = n.arguments[0];
        const argObject = arg && ts.isObjectLiteralExpression(arg) ? arg : null;
        const shapeAt = (key: string): DataShape => {
          const data = argObject ? propertyOf(argObject, key) : null;
          return data ? shapeOf(data) : UNREADABLE;
        };
        if (modelAccess.name.text === "user") {
          if (PRISMA_CREATE_METHODS.has(method)) {
            const created = shapeAt("data");
            out.push({
              site: `${where}#${method}`,
              createOnly: true,
              writesCredentials: false,
              createsCredentials: created.credentials,
              bumps: false,
              badVersionWrite: created.badVersion,
            });
          } else if (method === "upsert") {
            // The UPDATE branch can change an existing row; the create branch is a new row.
            const updated = shapeAt("update");
            const created = shapeAt("create");
            out.push({
              site: `${where}#upsert`,
              createOnly: false,
              writesCredentials: updated.credentials,
              createsCredentials: created.credentials,
              bumps: updated.bumps,
              badVersionWrite: updated.badVersion || created.badVersion,
            });
          } else {
            const updated = shapeAt("data");
            out.push({
              site: `${where}#${method}`,
              createOnly: false,
              writesCredentials: updated.credentials,
              createsCredentials: false,
              bumps: updated.bumps,
              badVersionWrite: updated.badVersion,
            });
          }
        } else if (argObject) {
          // A write on ANOTHER model: a nested `user: { … }` anywhere in its argument.
          for (const nested of nestedUserWrites(argObject)) {
            const shape = deepShapeOf(nested.value);
            out.push({
              site: `${where}#${modelAccess.name.text}.${method}.${nested.path.join(".")}`,
              createOnly: false,
              writesCredentials: shape.credentials,
              createsCredentials: false,
              bumps: shape.bumps,
              badVersionWrite: shape.badVersion,
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(file);
  return out;
}
