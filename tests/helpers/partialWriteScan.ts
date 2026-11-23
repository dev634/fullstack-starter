import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PRISMA_CREATE_METHODS, PRISMA_DELETE_METHODS, PRISMA_UPDATE_METHODS, isPrismaWrite } from "./prismaMethods";

/**
 * Scans a source for the forms that fold "absent" into a value in the `data` of
 * an UPDATE write (lot 5b — tests/repository-partial-write.test.ts).
 *
 * TWO domains, one rule set:
 *  - the repository layer: `prisma.<model>.update / updateMany` (and
 *    `tx.<model>.…` inside a `$transaction`), and the `update` branch of an
 *    `upsert` — `scanWrites`;
 *  - the action layer: the arguments of a call to a repository function whose
 *    IMPORTED name starts with `update` (resolved by import, not by the local
 *    name) — `scanActionUpdates`.
 * A `create` — or the `create` branch of an `upsert` — is OUT of the domain:
 * on a create, "not provided" legitimately becomes NULL or a default.
 *
 * Flagged, anywhere inside the written value (not only at its root):
 *   X ?? <replacement>   X || <replacement>   — a literal, or a CONSTANT
 *                                               (`?? DEFAULT_TYPE`, `?? Status.OPEN`;
 *                                               `?? current.x`, a parameter's, is not)
 *   c ? … : <null|literal>   c ? <null|literal> : …    — EITHER branch
 *   a default in a parameter of a function that writes (`{ id, status = "X" }: D`,
 *   `status = "X"`), or in a destructuring whose binding reaches the data
 *   a call that is not a known pass-through (`orNull(d.a)`), `new Date(d.a)`
 *   a spread that is not `...(x !== undefined ? { … } : {})` (`...patch(d)`)
 *   a whole `data` that is a parameter or a call result, not an object literal
 * and all of those reached through a local `const` — `const t = d.x ?? null`
 * then `{ t }` — because a test that only read the object literal was one
 * refactoring away from certifying nothing. A fold onto the CURRENT value
 * (`data.x ?? current.x`) is the documented way to fall back and is not flagged.
 *
 * Whatever this scanner cannot read it REFUSES ("opaque"): the failure mode of
 * a scanner is to certify what it does not inspect.
 *
 * WHAT IS AN UPDATE: fails CLOSED on `prisma`/`tx` (tests/helpers/prismaMethods.ts).
 * Any `<model>.<method>()` that is not a read, a create or a delete is inspected
 * as an update of `data` — `updateManyAndReturn` included; a method outside the
 * known update family is also a finding ("unknown write method"). REMAINING
 * LIMITS, stated: on a receiver that is not `prisma`/`tx` only the update names
 * the client is known to expose are recognised (a made-up method on another
 * receiver is invisible: "not a read" there would flag every `list.items.push()`);
 * the action layer is recognised by the IMPORTED name `update*`, not by method.
 */

export type Finding = { line: number; kind: string; text: string };

export type WriteScan = {
  /** `prisma.<m>.update|updateMany|upsert` / `tx.<m>.…` calls whose data was inspected. */
  calls: number;
  /** Distinct top-level functions (by name) holding at least one inspected call. */
  functions: string[];
  /** Writes whose receiver root is neither `prisma` nor `tx`: they would escape the scan. */
  unknownRoot: Finding[];
  findings: Finding[];
};

export type ActionScan = {
  /** Calls to an imported repository `update*` whose arguments were inspected. */
  calls: number;
  findings: Finding[];
};

/**
 * The ONLY calls the scanner lets through as a column value / a spread. Each
 * carries its reason and the condition of its disappearance — an exemption
 * without them certifies what it exempts.
 */
export const SAFE_VALUE_CALLS: ReadonlyMap<string, string> = new Map([
  [
    "dateColumn",
    "lib/partialWrite.ts: converts an ISO string to a Date and keeps `undefined` and `null` as they are. " +
      "Disappears if dateColumn ever folds one of the two states.",
  ],
  [
    "resolveAccessConfig",
    "actions/appSettings: normalises a REQUIRED whole value (the full config record); never receives nor returns an absent. " +
      "Disappears the day its argument becomes optional.",
  ],
  [
    "normalizeSectionOrder",
    "actions/appSettings: normalises a REQUIRED whole value (the full order list). Disappears the day its argument becomes optional.",
  ],
  [
    "normalizeHiddenAreas",
    "actions/jobFunctions: normalises a REQUIRED schema field (hiddenAreas has no .optional()). " +
      "Disappears the day that field becomes optional in the schema.",
  ],
]);
/**
 * Calls accepted by SHAPE, not by name: `x.map(…)` (an array transform: on an
 * absent value it THROWS, it does not fold — the relation `set: ids.map(...)`)
 * and `Math.<fn>(…)` (numeric: a clamp, never a null or a default).
 */
function isStructurallySafeCall(call: ts.CallExpression): boolean {
  const callee = unwrap(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text === "map") return true;
  const receiver = unwrap(callee.expression);
  return ts.isIdentifier(receiver) && receiver.text === "Math";
}
export const SAFE_SPREAD_CALLS: ReadonlyMap<string, string> = new Map([
  [
    "quantityTargetPatch",
    "lib/taskQuantity.ts: returns {} when the target is `undefined` (pinned by tests/partial-write.test.ts). " +
      "Disappears the day repository/tasks.ts::update inlines the rule or the helper stops returning {} on absent.",
  ],
]);

const KNOWN_ROOTS = new Set(["prisma", "tx"]);

/**
 * `<x>.<model>.<method>()` that writes an EXISTING row. On the client itself
 * (`prisma`/`tx`) it FAILS CLOSED: any method that is not a read, a create or a
 * delete is update-shaped — `updateManyAndReturn` included, and a method nobody
 * has heard of (refused as such below). On another receiver only the update
 * names the client is known to expose can be recognised (`list.items.push()`
 * is not a write), and they are reported as an unknown receiver.
 */
function isUpdateShapedCall(callee: ts.PropertyAccessExpression): boolean {
  const model = callee.expression;
  if (!ts.isPropertyAccessExpression(model)) return false;
  const method = callee.name.text;
  const onClient = ts.isIdentifier(model.expression) && KNOWN_ROOTS.has(model.expression.text);
  if (!onClient) return PRISMA_UPDATE_METHODS.has(method);
  return isPrismaWrite(method) && !PRISMA_CREATE_METHODS.has(method) && !PRISMA_DELETE_METHODS.has(method);
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}

/** A literal that is a REPLACEMENT value, not a computation: null, a string, a number, a boolean, `[]`, `{}`. */
function isLiteralValue(e: ts.Expression): boolean {
  const x = unwrap(e);
  return (
    x.kind === ts.SyntaxKind.NullKeyword ||
    x.kind === ts.SyntaxKind.TrueKeyword ||
    x.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isStringLiteral(x) ||
    ts.isNoSubstitutionTemplateLiteral(x) ||
    ts.isNumericLiteral(x) ||
    (ts.isPrefixUnaryExpression(x) && ts.isNumericLiteral(x.operand)) ||
    ts.isArrayLiteralExpression(x) ||
    ts.isObjectLiteralExpression(x)
  );
}

function isNullLiteral(e: ts.Expression): boolean {
  return unwrap(e).kind === ts.SyntaxKind.NullKeyword;
}

function isUndefinedIdentifier(e: ts.Expression): boolean {
  const x = unwrap(e);
  return ts.isIdentifier(x) && x.text === "undefined";
}

/** Names bound by a (possibly destructuring) binding, each with "does a default sit on its path". */
function bindingNames(name: ts.BindingName, out: Map<string, boolean>, defaulted = false): void {
  if (ts.isIdentifier(name)) {
    out.set(name.text, defaulted);
    return;
  }
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    bindingNames(el.name, out, defaulted || el.initializer !== undefined);
  }
}

type Binding =
  | { kind: "const"; init: ts.Expression; module: boolean }
  | { kind: "param" }
  | { kind: "local"; defaulted: boolean }
  | { kind: "none" };

/** What `name` is, seen from `from`: a const (with its initializer), a parameter, another local, or nothing in this file. */
function resolveBinding(from: ts.Node, name: string): Binding {
  for (let cur: ts.Node | undefined = from.parent; cur; cur = cur.parent) {
    if (ts.isFunctionLike(cur)) {
      const names = new Map<string, boolean>();
      for (const p of cur.parameters) bindingNames(p.name, names);
      if (names.has(name)) return { kind: "param" };
    }
    const statements = ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isModuleBlock(cur) ? cur.statements : undefined;
    if (!statements) continue;
    for (const st of statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          if (d.name.text === name) {
            return d.initializer ? { kind: "const", init: d.initializer, module: ts.isSourceFile(cur) } : { kind: "local", defaulted: false };
          }
        } else {
          const names = new Map<string, boolean>();
          bindingNames(d.name, names);
          if (names.has(name)) return { kind: "local", defaulted: names.get(name) === true };
        }
      }
    }
  }
  return { kind: "none" };
}

/**
 * A REPLACEMENT value rather than a fallback on the current one: a literal, a
 * module-level constant, an imported name (`Status.OPEN`), or a local const
 * that is itself one. A parameter's or a local's property (`current.x`) is the
 * current value, not a replacement.
 */
function isConstantLike(e: ts.Expression, seen = new Set<ts.Node>()): boolean {
  const x = unwrap(e);
  if (seen.has(x)) return false;
  seen.add(x);
  if (isLiteralValue(x)) return true;
  let root: ts.Expression = x;
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = unwrap(root.expression);
  if (!ts.isIdentifier(root) || root.text === "undefined") return false;
  const b = resolveBinding(root, root.text);
  if (b.kind === "const") return b.module || (root === x && isConstantLike(b.init, seen));
  return b.kind === "none";
}

function lineOf(node: ts.Node): number {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function describe(node: ts.Node): string {
  return node.getText(node.getSourceFile()).replace(/\s+/g, " ").slice(0, 100);
}

type Ctx = { out: Finding[]; seen: Set<ts.Node> };

/** Every folding node inside `root` (descendants included), without following identifiers. */
function foldsIn(root: ts.Node, out: Finding[]): void {
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken && isConstantLike(n.right)) {
        out.push({ line: lineOf(n), kind: "?? <literal>", text: describe(n) });
      } else if (op === ts.SyntaxKind.BarBarToken && isConstantLike(n.right)) {
        out.push({ line: lineOf(n), kind: "|| <literal>", text: describe(n) });
      }
    }
    if (ts.isConditionalExpression(n)) {
      if (isNullLiteral(n.whenFalse) || isNullLiteral(n.whenTrue)) {
        out.push({ line: lineOf(n), kind: "? … : null", text: describe(n) });
      } else if (isLiteralValue(n.whenFalse) || isLiteralValue(n.whenTrue)) {
        out.push({ line: lineOf(n), kind: "? … : <literal>", text: describe(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
}

function checkValue(expr: ts.Expression, ctx: Ctx): void {
  const x = unwrap(expr);
  if (ctx.seen.has(x)) return;
  ctx.seen.add(x);

  if (ts.isObjectLiteralExpression(x)) return checkData(x, ctx);

  foldsIn(x, ctx.out);

  if (ts.isIdentifier(x)) {
    const b = resolveBinding(x, x.text);
    if (b.kind === "const") checkValue(b.init, ctx);
    else if (b.kind === "local" && b.defaulted) {
      ctx.out.push({ line: lineOf(x), kind: "default in destructuring", text: describe(x) });
    }
  } else if (ts.isConditionalExpression(x)) {
    // The branches are values too: `c ? orNull(d.a) : undefined`.
    checkValue(x.whenTrue, ctx);
    checkValue(x.whenFalse, ctx);
  } else if (ts.isCallExpression(x)) {
    const callee = unwrap(x.expression);
    const name = ts.isIdentifier(callee) ? callee.text : null;
    if ((name === null || !SAFE_VALUE_CALLS.has(name)) && !isStructurallySafeCall(x)) {
      ctx.out.push({ line: lineOf(x), kind: "opaque value", text: describe(x) });
    }
  } else if (ts.isNewExpression(x) && (x.arguments?.length ?? 0) > 0) {
    ctx.out.push({ line: lineOf(x), kind: "opaque value", text: describe(x) });
  }
}

/** `x !== undefined` / `undefined !== x`. */
function isAbsenceGuard(cond: ts.Expression): boolean {
  const c = unwrap(cond);
  return (
    ts.isBinaryExpression(c) &&
    c.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    (isUndefinedIdentifier(c.right) || isUndefinedIdentifier(c.left))
  );
}

/**
 * The `.data` of a `schema.safeParse(…)` / `.parse(…)` result, or a const that
 * holds one: a VALIDATED payload, where an absent key stays absent. Its own
 * defaults are fenced by tests/partial-write-schemas.test.ts (no update schema
 * declares one).
 */
function isParsedData(e: ts.Expression, seen = new Set<ts.Node>()): boolean {
  const x = unwrap(e);
  if (seen.has(x)) return false;
  seen.add(x);
  if (ts.isIdentifier(x)) {
    const b = resolveBinding(x, x.text);
    return b.kind === "const" && isParsedData(b.init, seen);
  }
  if (ts.isPropertyAccessExpression(x) && x.name.text === "data" && ts.isIdentifier(unwrap(x.expression))) {
    const holder = unwrap(x.expression) as ts.Identifier;
    const b = resolveBinding(holder, holder.text);
    if (b.kind !== "const") return false;
    const init = unwrap(b.init);
    const call = ts.isAwaitExpression(init) ? unwrap(init.expression) : init;
    return (
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      (call.expression.name.text === "safeParse" || call.expression.name.text === "parse")
    );
  }
  return false;
}

function checkSpread(p: ts.SpreadAssignment, ctx: Ctx): void {
  const s = unwrap(p.expression);
  if (isParsedData(s)) return;
  if (ts.isConditionalExpression(s)) {
    const t = unwrap(s.whenTrue);
    const f = unwrap(s.whenFalse);
    // The one accepted conditional spread: `...(x !== undefined ? { x } : {})`.
    if (isAbsenceGuard(s.condition) && ts.isObjectLiteralExpression(t) && ts.isObjectLiteralExpression(f) && f.properties.length === 0) {
      return checkData(t, ctx);
    }
  } else if (ts.isObjectLiteralExpression(s)) {
    return checkData(s, ctx);
  } else if (ts.isIdentifier(s)) {
    const b = resolveBinding(s, s.text);
    if (b.kind === "const") {
      const init = unwrap(b.init);
      if (ts.isObjectLiteralExpression(init)) return checkData(init, ctx);
    }
  } else if (ts.isCallExpression(s)) {
    const callee = unwrap(s.expression);
    if (ts.isIdentifier(callee) && SAFE_SPREAD_CALLS.has(callee.text)) return;
  }
  ctx.out.push({ line: lineOf(p), kind: "opaque spread", text: describe(p) });
}

/** Analyse an object literal used as (part of) a `data` payload. */
function checkData(obj: ts.ObjectLiteralExpression, ctx: Ctx): void {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      checkValue(p.initializer, ctx);
    } else if (ts.isShorthandPropertyAssignment(p)) {
      const b = resolveBinding(p.name, p.name.text);
      if (b.kind === "const") checkValue(b.init, ctx);
      else if (b.kind === "local" && b.defaulted) {
        ctx.out.push({ line: lineOf(p), kind: "default in destructuring", text: describe(p) });
      }
    } else if (ts.isSpreadAssignment(p)) {
      checkSpread(p, ctx);
    }
  }
}

/** The WHOLE `data` of a write: an object literal, or a const holding one — never a parameter or a call. */
function checkWholeData(expr: ts.Expression, ctx: Ctx): void {
  const x = unwrap(expr);
  if (ts.isObjectLiteralExpression(x)) return checkData(x, ctx);
  if (ts.isIdentifier(x)) {
    const b = resolveBinding(x, x.text);
    if (b.kind === "const") {
      if (ctx.seen.has(b.init)) return;
      ctx.seen.add(b.init);
      return checkWholeData(b.init, ctx);
    }
  }
  ctx.out.push({ line: lineOf(x), kind: "opaque data", text: describe(x) });
}

/** A default in a parameter of `fn` (a function that writes): `status = "X"` or `{ status = "X" }: D`. */
function parameterDefaults(fn: ts.SignatureDeclaration, out: Finding[], seen: Set<ts.Node>): void {
  if (seen.has(fn)) return;
  seen.add(fn);
  const visitBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) return;
    for (const el of name.elements) {
      if (ts.isOmittedExpression(el)) continue;
      if (el.initializer) out.push({ line: lineOf(el), kind: "default in destructured parameter", text: describe(el) });
      visitBinding(el.name);
    }
  };
  for (const p of fn.parameters) {
    if (p.initializer) out.push({ line: lineOf(p), kind: "default in parameter", text: describe(p) });
    visitBinding(p.name);
  }
}

export function scanWrites(source: string, fileName = "repository/x.ts"): WriteScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const scan: WriteScan = { calls: 0, functions: [], unknownRoot: [], findings: [] };
  const functions = new Set<string>();
  const seenFunctions = new Set<ts.Node>();

  const topLevelName = (n: ts.Node): string => {
    let name = "<module>";
    for (let cur: ts.Node | undefined = n; cur && cur !== sf; cur = cur.parent) {
      if (ts.isFunctionDeclaration(cur) && cur.name && cur.parent === sf) name = cur.name.text;
      if (ts.isVariableStatement(cur) && cur.parent === sf) {
        const d = cur.declarationList.declarations[0];
        if (d && ts.isIdentifier(d.name)) name = d.name.text;
      }
    }
    return name;
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && isUpdateShapedCall(n.expression)) {
      const model = n.expression.expression;
      if (ts.isPropertyAccessExpression(model)) {
        const root = model.expression;
        const rootName = ts.isIdentifier(root) ? root.text : null;
        const method = n.expression.name.text;
        if (rootName === null || !KNOWN_ROOTS.has(rootName)) {
          scan.unknownRoot.push({ line: lineOf(n), kind: "unknown receiver", text: describe(n) });
        } else {
          scan.calls += 1;
          functions.add(topLevelName(n));
          if (!PRISMA_UPDATE_METHODS.has(method)) {
            scan.findings.push({ line: lineOf(n), kind: "unknown write method", text: describe(n) });
          }
          for (let cur: ts.Node | undefined = n.parent; cur; cur = cur.parent) {
            if (ts.isFunctionLike(cur)) parameterDefaults(cur, scan.findings, seenFunctions);
          }
          const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined;
          if (!arg || !ts.isObjectLiteralExpression(arg)) {
            scan.findings.push({ line: lineOf(n), kind: "opaque write argument", text: describe(n) });
          } else {
            // update/updateMany write `data`; an upsert's update branch is `update`.
            const key = method === "upsert" ? "update" : "data";
            const ctx: Ctx = { out: scan.findings, seen: new Set() };
            for (const p of arg.properties) {
              if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key) {
                checkWholeData(p.initializer, ctx);
              } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) {
                const b = resolveBinding(p.name, key);
                if (b.kind === "const") checkWholeData(b.init, ctx);
                else scan.findings.push({ line: lineOf(p), kind: "opaque data", text: describe(p) });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  scan.functions = [...functions].sort();
  return scan;
}

/**
 * The ACTION layer: every call to a function imported from `@/repository/…`
 * under an ORIGINAL name that starts with `update` (`import { update as
 * updateProject }` counts, a local helper that happens to be called
 * `updateSomething` does not). Each argument is read like the value of a
 * column: `phone || null`, `x ?? null`, a replacement ternary, an opaque helper
 * and a non-conditional spread are refused.
 *
 * Only the arguments that CARRY DATA are read. A repository update may also take
 * a guard or a callback (`updateConfig(id, data, guard)`, `updateProfile(id,
 * data, relay)`, `update(id, data, accept)`): that is not a column value. Which
 * parameter is a callback is read from the DECLARATION of the repository
 * function, not from a list of names: a parameter whose type is a function type,
 * written inline or through a local `type X = (…) => …` alias (a `| null` or
 * `| undefined` around it is ignored). A parameter whose type cannot be read as
 * a function type is data — an unreadable declaration fails closed, every
 * argument is inspected. `repositorySourceOf` returns the source of a
 * repository module from its import specifier (default: the file on disk).
 */
export function scanActionUpdates(
  source: string,
  fileName = "actions/x.ts",
  repositorySourceOf: (specifier: string) => string | undefined = readRepositorySource
): ActionScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const scan: ActionScan = { calls: 0, findings: [] };

  // local name -> indexes of the parameters that are callbacks (not data)
  const locals = new Map<string, ReadonlySet<number>>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!st.moduleSpecifier.text.startsWith("@/repository/")) continue;
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const moduleSource = repositorySourceOf(st.moduleSpecifier.text);
    const moduleFile = moduleSource === undefined ? undefined : ts.createSourceFile(st.moduleSpecifier.text, moduleSource, ts.ScriptTarget.Latest, true);
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (imported.startsWith("update")) locals.set(el.name.text, moduleFile ? callbackParameters(moduleFile, imported) : new Set());
    }
  }

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && locals.has(n.expression.text)) {
      scan.calls += 1;
      const callbacks = locals.get(n.expression.text)!;
      const ctx: Ctx = { out: scan.findings, seen: new Set() };
      n.arguments.forEach((arg, i) => {
        if (!callbacks.has(i)) checkValue(arg, ctx);
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return scan;
}

/** The repository module behind `@/repository/<name>`, read from disk (undefined when it cannot be). */
function readRepositorySource(specifier: string): string | undefined {
  const file = join(process.cwd(), specifier.replace("@/", "") + ".ts");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** Whether a parameter type is a function type: inline, or through a local `type X = (…) => …`; `| null` / `| undefined` ignored. */
function isFunctionType(type: ts.TypeNode, module: ts.SourceFile, depth = 0): boolean {
  if (depth > 5) return false;
  if (ts.isParenthesizedTypeNode(type)) return isFunctionType(type.type, module, depth + 1);
  if (ts.isFunctionTypeNode(type)) return true;
  if (ts.isUnionTypeNode(type)) {
    const real = type.types.filter((t) => !(ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) && t.kind !== ts.SyntaxKind.UndefinedKeyword);
    return real.length > 0 && real.every((t) => isFunctionType(t, module, depth + 1));
  }
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    for (const st of module.statements) {
      if (ts.isTypeAliasDeclaration(st) && st.name.text === name) return isFunctionType(st.type, module, depth + 1);
    }
  }
  return false;
}

/** Indexes of the parameters of the repository function `name` (its implementation signature) whose type is a function type. */
function callbackParameters(module: ts.SourceFile, name: string): ReadonlySet<number> {
  const out = new Set<number>();
  for (const st of module.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) {
      st.parameters.forEach((p, i) => {
        if (p.type && isFunctionType(p.type, module)) out.add(i);
      });
    }
  }
  return out;
}
