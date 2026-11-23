import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { exportInfoOf, FOREIGN_TREE_DIRS } from "./astScan";

/**
 * Scan of what a Server Action RETURNS (tests/server-action-return-guard.test.ts).
 *
 * A value returned by an exported function of a `"use server"` file is
 * serialised to the browser. When that value is a repository row — the line the
 * write just produced, no `select` — every column goes with it, whether or not
 * anything reads it. Typing the receiving prop narrower removes nothing
 * (structural typing), so the rule is on the SOURCE of the returned value: it
 * must be built by the action as a literal of named fields.
 *
 * Everything here is parsed (TypeScript AST), never grepped: a repository call
 * named in a comment is not a leak, and a leak through an intermediate variable
 * or a spread is one.
 *
 * What counts as a leak: a returned expression (or a property / spread / array
 * element inside a returned literal, or the value an identifier resolves to)
 * whose value IS a repository result — a call on a binding imported from
 * `repository/` or `service/` — reached directly, through a variable, a
 * destructuring REST / array element, an assignment, a conditional or `??`/`||`
 * branch, a local helper, `Promise.all`, or a pass-through method
 * (`filter`, `slice`, `map` returning its element, …).
 *
 * What does NOT count: a NAMED field read off a row (`row.id`, `const { id } =
 * row`) — that is exactly the literal-of-named-fields the rule asks for.
 * Declared blind spots (a finding the scan cannot make, by construction):
 *   - a named field that is itself an object (`data: row.client`) — fields are
 *     trusted as named;
 *   - an arbitrary imported helper that returns its argument (only the
 *     pass-through callees below are followed);
 *   - a repository module loaded by `import()` / `require` instead of a static
 *     import, and a client passed in as a parameter.
 */

export type Source = { path: string; text: string };

export type ActionReturnFinding = {
  file: string;
  action: string;
  line: number;
  /** The returned expression, collapsed to one line. */
  text: string;
  reason: string;
};

const SERVER_DIRECTIVE = "use server";

/** Repository / service modules: where a row comes from. Relative and aliased specifiers alike. */
const ROW_SOURCE_MODULE = /^(@\/|(\.\.?\/)+)(repository|service)\//;

/** Free functions that hand their argument back (or a copy of it). */
const PASS_THROUGH_CALLEES: ReadonlySet<string> = new Set([
  "structuredClone",
  "Promise.all",
  "Promise.allSettled",
  "Promise.race",
  "Promise.any",
  "Promise.resolve",
  "Object.assign",
  "JSON.parse",
  "JSON.stringify",
  "Array.from",
]);

/** Methods that return (some of) the receiver's own elements. */
const PASS_THROUGH_METHODS: ReadonlySet<string> = new Set([
  "filter",
  "slice",
  "concat",
  "flat",
  "reverse",
  "sort",
  "toSorted",
  "toReversed",
  "at",
  "find",
  "findLast",
  "toJSON",
]);

type FunctionNode = ts.FunctionLikeDeclaration;

type Ctx = {
  repo: ReadonlySet<string>;
  locals: ReadonlyMap<string, FunctionNode>;
  /** The function whose declarations an identifier resolves against. */
  scope: ts.Node;
  /** Parameter names bound to an argument that leaks. */
  tainted: ReadonlySet<string>;
  /** Resolution stack: identifiers / local functions being evaluated (cycle guard). */
  seen: Set<string>;
};

// ---------- discovery ----------

/** The file-level directive prologue contains "use server" (parsed, not matched in text). */
export function hasUseServerDirective(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === SERVER_DIRECTIVE) return true;
  }
  return false;
}

/** Functions carrying their own `"use server"` prologue — an action the file-level discovery would not see. */
export function functionLevelDirectiveCount(source: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body && ts.isBlock(node.body)) {
      for (const statement of node.body.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
        if (statement.expression.text === SERVER_DIRECTIVE) count++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

function parse(source: Source): ts.SourceFile {
  return ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true);
}

/**
 * Every `.ts`/`.tsx` file of the repository, minus foreign trees
 * (FOREIGN_TREE_DIRS), hidden directories (`.next`, `.git`, the agents'
 * worktrees under `.claude`) and the generated Prisma client. The domain is NOT
 * a list of folders: a `"use server"` file created anywhere is found.
 */
export function repositorySources(root: string): Source[] {
  const out: Source[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (FOREIGN_TREE_DIRS.has(name) || name.startsWith(".") || name === "generated") continue;
        walk(full);
      } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
        out.push({ path: relative(root, full).split("\\").join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

/** The files whose file-level directive is "use server". Cheap text pre-filter, then a real parse. */
export function serverActionSources(sources: readonly Source[]): Source[] {
  return sources.filter((s) => s.text.includes(SERVER_DIRECTIVE) && hasUseServerDirective(parse(s)));
}

// ---------- actions of one file ----------

export type ActionFn = { name: string; node: FunctionNode };

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** Top-level named functions of the file, exported or not (local helpers a return may go through). */
function localFunctions(source: ts.SourceFile): Map<string, FunctionNode> {
  const out = new Map<string, FunctionNode>();
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) out.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          out.set(decl.name.text, decl.initializer);
        }
      }
    }
  }
  return out;
}

/**
 * The exported functions of a `"use server"` file, in every exported form: the
 * `export` modifier, `export { f }`, `export default <name>`, an anonymous
 * default. A re-export (`export { f } from "./x"`) has no body here: it is
 * returned separately so the caller can refuse it rather than skip it.
 */
export function exportedActionsIn(source: ts.SourceFile): { actions: ActionFn[]; reexports: string[] } {
  const info = exportInfoOf(source);
  const locals = localFunctions(source);
  const actions: ActionFn[] = [];
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      if (node.name) {
        if (hasModifier(node, ts.SyntaxKind.ExportKeyword) || info.locals.has(node.name.text)) actions.push({ name: node.name.text, node });
      } else if (hasModifier(node, ts.SyntaxKind.ExportKeyword) && hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
        actions.push({ name: "default", node });
      }
    } else if (ts.isVariableStatement(node)) {
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const fn = locals.get(decl.name.text);
        if (fn && (exported || info.locals.has(decl.name.text))) actions.push({ name: decl.name.text, node: fn });
      }
    } else if (ts.isExportAssignment(node) && !node.isExportEquals && (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression))) {
      actions.push({ name: "default", node: node.expression });
    }
  }
  return { actions, reexports: info.reexports };
}

/** Local names bound to a repository / service module by a (non type-only) static import. */
export function rowSourceBindings(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    if (!ROW_SOURCE_MODULE.test(node.moduleSpecifier.text)) continue;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) if (!el.isTypeOnly) names.add(el.name.text);
    }
  }
  return names;
}

// ---------- the analysis ----------

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** `a.b.c(...)` -> "a"; `a(...)` -> "a"; anything else -> null. */
function rootIdentifier(expr: ts.Expression): string | null {
  let current = expr;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isCallExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAwaitExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    } else return current;
  }
}

/** The return expressions of a function, not descending into nested functions. */
function returnExpressionsOf(fn: FunctionNode): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  for (const statement of fn.body.statements) visit(statement);
  return out;
}

function rootVariableDeclaration(node: ts.Node): ts.VariableDeclaration | null {
  let current: ts.Node | undefined = node;
  while (current && !ts.isVariableDeclaration(current)) {
    if (!ts.isBindingElement(current) && !ts.isObjectBindingPattern(current) && !ts.isArrayBindingPattern(current)) return null;
    current = current.parent;
  }
  return current ?? null;
}

/** Why `name` leaks within `ctx.scope`, or null. Every declaration and assignment of the name is examined. */
function identifierLeak(name: string, ctx: Ctx): string | null {
  if (ctx.tainted.has(name)) return `parameter "${name}" is bound to an argument that leaks`;
  const key = `${ctx.scope.pos}:${name}`;
  if (ctx.seen.has(key)) return null;
  ctx.seen.add(key);
  try {
    let reason: string | null = null;
    const visit = (node: ts.Node) => {
      if (reason) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
        const r = leakOf(node.initializer, ctx);
        if (r) reason = `variable "${name}" <- ${r}`;
      } else if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        const root = rootVariableDeclaration(node);
        const restOrElement = node.dotDotDotToken !== undefined || ts.isArrayBindingPattern(node.parent);
        if (root?.initializer && restOrElement) {
          const r = leakOf(root.initializer, ctx);
          if (r) reason = `"${name}" (rest / array element) <- ${r}`;
        }
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === name) {
        const r = leakOf(node.right, ctx);
        if (r) reason = `variable "${name}" <- ${r}`;
      }
      if (!reason) ts.forEachChild(node, visit);
    };
    visit(ctx.scope);
    return reason;
  } finally {
    ctx.seen.delete(key);
  }
}

function argumentLeak(args: ts.NodeArray<ts.Expression>, ctx: Ctx): string | null {
  for (const arg of args) {
    const r = leakOf(arg, ctx);
    if (r) return r;
  }
  return null;
}

/** Evaluate what `fn` returns when its parameters are bound to `tainted`. */
function returnsLeak(fn: FunctionNode, tainted: ReadonlySet<string>, ctx: Ctx, label: string): string | null {
  const key = `fn:${label}:${[...tainted].sort().join(",")}`;
  if (ctx.seen.has(key)) return null;
  ctx.seen.add(key);
  try {
    const inner: Ctx = { ...ctx, scope: fn, tainted };
    for (const expr of returnExpressionsOf(fn)) {
      const r = leakOf(expr, inner);
      if (r) return `${label}() returns ${r}`;
    }
    return null;
  } finally {
    ctx.seen.delete(key);
  }
}

function paramsBoundTo(fn: FunctionNode, args: ts.NodeArray<ts.Expression>, ctx: Ctx): Set<string> {
  const tainted = new Set<string>();
  fn.parameters.forEach((param, index) => {
    const arg = args[index];
    if (ts.isIdentifier(param.name) && arg && leakOf(arg, ctx)) tainted.add(param.name.text);
  });
  return tainted;
}

function callLeak(call: ts.CallExpression, ctx: Ctx): string | null {
  const callee = call.expression;
  const root = rootIdentifier(callee);
  if (root && ctx.repo.has(root)) return `a repository/service call (${collapse(callee.getText())})`;

  if (ts.isIdentifier(callee)) {
    const local = ctx.locals.get(callee.text);
    if (local) return returnsLeak(local, paramsBoundTo(local, call.arguments, ctx), ctx, callee.text);
    if (PASS_THROUGH_CALLEES.has(callee.text)) return argumentLeak(call.arguments, ctx);
    return null;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    if (PASS_THROUGH_CALLEES.has(collapse(callee.getText()))) return argumentLeak(call.arguments, ctx);
    const method = callee.name.text;
    if (PASS_THROUGH_METHODS.has(method)) return leakOf(callee.expression, ctx);
    if (method === "map" || method === "flatMap") {
      const receiver = leakOf(callee.expression, ctx);
      const callback = call.arguments[0];
      if (receiver && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const first = callback.parameters[0];
        const tainted = first && ts.isIdentifier(first.name) ? new Set([first.name.text]) : new Set<string>();
        return returnsLeak(callback, tainted, ctx, `${method} callback`);
      }
    }
  }
  return null;
}

/**
 * Why the VALUE of `expr` is (or contains) a repository result, or null.
 * A named field of a row (`row.id`) is not: that is the literal the rule asks for.
 */
function leakOf(raw: ts.Expression, ctx: Ctx): string | null {
  const expr = unwrap(raw);
  if (ts.isIdentifier(expr)) return identifierLeak(expr.text, ctx);
  if (ts.isCallExpression(expr)) return callLeak(expr, ctx);
  if (ts.isConditionalExpression(expr)) return leakOf(expr.whenTrue, ctx) ?? leakOf(expr.whenFalse, ctx);
  if (ts.isBinaryExpression(expr)) {
    const k = expr.operatorToken.kind;
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.CommaToken) {
      return leakOf(expr.left, ctx) ?? leakOf(expr.right, ctx);
    }
    return null;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    for (const prop of expr.properties) {
      let inner: string | null = null;
      if (ts.isPropertyAssignment(prop)) inner = leakOf(prop.initializer, ctx);
      else if (ts.isShorthandPropertyAssignment(prop)) inner = identifierLeak(prop.name.text, ctx);
      else if (ts.isSpreadAssignment(prop)) inner = leakOf(prop.expression, ctx);
      if (inner) {
        const label = ts.isSpreadAssignment(prop) ? "spread" : `property "${prop.name?.getText() ?? "?"}"`;
        return `${label}: ${inner}`;
      }
    }
    return null;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      const inner = leakOf(ts.isSpreadElement(el) ? el.expression : el, ctx);
      if (inner) return `array element: ${inner}`;
    }
    return null;
  }
  return null;
}

/** Every returned expression of every exported action of one `"use server"` file that is, or contains, a repository result. */
export function actionReturnFindings(source: Source): ActionReturnFinding[] {
  const sf = parse(source);
  const { actions, reexports } = exportedActionsIn(sf);
  const repo = rowSourceBindings(sf);
  const locals = localFunctions(sf);
  const findings: ActionReturnFinding[] = [];

  for (const name of reexports) {
    findings.push({ file: source.path, action: name, line: 1, text: `export { ${name} } from …`, reason: "re-exported action: its returns are not in this file and cannot be scanned" });
  }
  for (const action of actions) {
    for (const expr of returnExpressionsOf(action.node)) {
      const ctx: Ctx = { repo, locals, scope: action.node, tainted: new Set(), seen: new Set() };
      const reason = leakOf(expr, ctx);
      if (reason) {
        findings.push({
          file: source.path,
          action: action.name,
          line: sf.getLineAndCharacterOfPosition(expr.getStart()).line + 1,
          text: collapse(expr.getText()).slice(0, 120),
          reason,
        });
      }
    }
  }
  return findings;
}

/** How many exported actions the file holds (the exact-size assertion of the domain). */
export function exportedActionCount(source: Source): number {
  const { actions, reexports } = exportedActionsIn(parse(source));
  return actions.length + reexports.length;
}
