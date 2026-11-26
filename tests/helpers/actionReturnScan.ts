import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { FOREIGN_TREE_DIRS } from "./astScan";

/**
 * Scan of what a Server Action RETURNS (tests/server-action-return-guard.test.ts).
 *
 * What an exported function of a `"use server"` file returns is serialised to
 * the browser. Narrowing the type of the prop that receives it removes nothing
 * (structural typing): the rule is on the SOURCE of every value in the return.
 *
 * FAIL-CLOSED. The first version of this scan recognised a repository row by its
 * module of origin and followed it through an enumerated list of forms: anything
 * it did not know was green — a field of an envelope (`res.data`), `prisma`
 * imported directly, a lib/ reader, a mutation (`out.data = row`), `for…of`,
 * `rows[0]`, a template literal, an export wrapped in a call, `.js` files. Here
 * the default is inverted: a returned value is admitted only if it is built from
 * the forms below, and EVERYTHING ELSE IS RED.
 *
 *   - literals (string, number, boolean, null, undefined) and template literals
 *     whose every substitution is admitted;
 *   - the action's own parameters (its input — `...prevState` first of all) and
 *     values derived from them (`parsed.data.x`, `formData.get(…)`);
 *   - a CLOSED_LIST entry: the dictionary, a guard's refusal, a state helper, a
 *     fresh value, or the named fields of a listed source — each with its
 *     reason, below; a binding imported from schemas/ parsing admitted input;
 *   - `data`: a literal of named-field reads whose names are in DATA_FIELDS;
 *   - built-ins from BUILT_IN_CALLS / VALUE_METHODS, allowed only when every
 *     value they are given is admitted (they compute, they do not fetch);
 *   - a local helper of the file, entered with its parameters bound to the call's
 *     arguments: its own returns are judged by the same rules;
 *   - an identifier, admitted when EVERY definition of it (declaration,
 *     assignment, destructuring assignment, `for (x of …)`) and every write into
 *     it is admitted — `x.p = v`, `push`, `Object.assign`, and the same writes
 *     made THROUGH an alias of it: `const y = x`, a member taken out of it
 *     (`const { items } = x`, `const items = x.items`), a `for…of` variable, the
 *     parameter of a callback of one of its methods, the parameter (destructured
 *     or not) of a local helper it is handed to.
 * Bindings are resolved by the TypeScript checker (exact scopes, shadowing,
 * imports, parameters, catch clauses), never by name.
 *
 * Declared limits (by construction, the scan cannot see):
 *   - which `return` runs: a conditional's TEST, a comparison, a `!`, a computed
 *     key into the dictionary (`t.errors[code]`) select among admitted values —
 *     one choice, like the guard that picks the return statement. They are not
 *     inspected; every value they can select is;
 *   - a value STORED INTO ANOTHER value (`o.p = x`, `list.push(x)`, `{ a: x }`)
 *     or handed back by one of its own methods (`sort` and `reverse` return their
 *     receiver), then written through that other binding; a value handed to an IMPORTED
 *     function that writes into its argument: the scan reads the action's file,
 *     not the callee's (a built-in it does not know, a callee it cannot name and
 *     a helper reading `arguments` are red);
 *   - the parameters of a callback the scan does not enter with a binding (any
 *     callback but those of `map` / `flatMap` / `replace`) are unbound: a value
 *     they carry into the return is red, not followed;
 *   - the reasons of CLOSED_LIST: they say what the entry returns, the scan
 *     trusts them (it does not read lib/ or repository/ bodies);
 *   - what a `throw` inside the action's `try` carries to its `catch`:
 *     `getErrorMessage(error)` relays the `.message` of ANY thrown object, so
 *     `throw { message: row.email }`, `throw row` or a local helper that throws
 *     a field pass green (probed by the delta audit of f308d51). The repository's
 *     own throws carry literal messages today, and no action throws a field —
 *     but nothing here checks it;
 *   - a literal that CAPTURES a value and is written through later (`const box =
 *     { errors }; box.errors.push(row.email)`, `holder.state.leak = row`,
 *     `list[0].leak`), and an imported helper that writes into its argument
 *     (`fill(state, row)`), are the first limit's most natural forms (same probe);
 *   - `data: { id: x.id }` admits `.id` off any base: `const x = { id: u.passwordHash }`
 *     would launder a field through the name (improbable — every id of the schema
 *     is an Int — but not refused).
 * Budgets: MAX_DEPTH nested calls, MAX_STEPS steps per action — past either, red.
 */

export type Source = { path: string; text: string };

export type ReturnFinding = {
  file: string;
  action: string;
  line: number;
  /** The returned expression, collapsed to one line (120 characters at most). */
  text: string;
  reason: string;
};

// ===========================================================================
// The closed list.
// ===========================================================================

type EntryBase = { module: string; name: string; reason: string };

/**
 * What a call to a listed import yields:
 *   - dictionary: the i18n dictionary — any entry, at any depth;
 *   - guard: a guard result — only `.error` (the refusal) and `.reason`;
 *   - state: a state value, admitted when every argument it is given is — except
 *     the positions `args` names: "caught" must be the caught exception of a
 *     `catch` clause, "guard" the result of a listed guard (the helper reads
 *     them, it does not relay them);
 *   - fields: only the named fields of the result;
 *   - fresh: a value the call creates, owing nothing to any row.
 */
type SpecialArgument = "caught" | "guard";

type ClosedEntry =
  | (EntryBase & { kind: "dictionary" })
  | (EntryBase & { kind: "guard" })
  | (EntryBase & { kind: "state"; args?: Readonly<Record<number, SpecialArgument>> })
  | (EntryBase & { kind: "fields"; fields: readonly string[] })
  | (EntryBase & { kind: "fresh" });

const GUARD_REASON =
  "A guard of the action's own call: `.error` is its refusal, `{ type: \"error\", message }` built from the dictionary (or null), " +
  "`.reason` one of four refusal codes (lib/scopeRefusal.ts). Never the result as a whole: requireCapability and requireRole put " +
  "the actor's e-mail beside the refusal.";

/**
 * Recensed from the `return` statements of the 24 `"use server"` files (every
 * import a returned value reaches). An entry that no return uses any more fails
 * the test: the list stays exactly what the actions need.
 */
export const CLOSED_LIST: readonly ClosedEntry[] = [
  {
    kind: "dictionary",
    module: "lib/i18n/dictionaries",
    name: "getDictionary",
    reason: "The dictionary of the active locale: static text shipped with the app, no row in it.",
  },
  { kind: "guard", module: "lib/access", name: "requireCapability", reason: GUARD_REASON },
  { kind: "guard", module: "lib/authz", name: "requireRole", reason: GUARD_REASON },
  { kind: "guard", module: "lib/areaAccess", name: "requireAreaAccess", reason: GUARD_REASON },
  { kind: "guard", module: "lib/sectionAccess", name: "requireSectionAccess", reason: GUARD_REASON },
  { kind: "guard", module: "lib/sectionAccess", name: "requireEverySectionAccess", reason: GUARD_REASON },
  { kind: "guard", module: "lib/access", name: "requireProjectAccess", reason: GUARD_REASON },
  { kind: "guard", module: "lib/access", name: "requireTrashedProjectAccess", reason: GUARD_REASON },
  { kind: "guard", module: "lib/access", name: "requireClientAccess", reason: GUARD_REASON },
  { kind: "guard", module: "lib/access", name: "requireFullClientAccess", reason: GUARD_REASON },
  {
    kind: "state",
    module: "lib/helpers",
    name: "getErrorMessage",
    args: { 0: "caught" },
    reason:
      "Maps the caught exception (argument 0, which must be a `catch` binding) to a message: a repository error becomes the caller's " +
      "fallback, an upload error its dictionary entry. Declared limit: any other thrown object carrying a `.message` is relayed " +
      "as is (see isAppError in actions/deliveryNoteScan) — never a row, but not a filter either.",
  },
  {
    kind: "state",
    module: "lib/i18n/format",
    name: "format",
    reason: "Fills a dictionary template with the values it is given — each of them checked like the rest of the return.",
  },
  {
    kind: "state",
    module: "lib/zod",
    name: "makeObjectFromZodError",
    reason: "Field -> message map of a failed parse of the action's own input (the ZodError of that parse, the dictionary).",
  },
  {
    kind: "state",
    module: "lib/scopeRefusal",
    name: "scopeRefusalMessage",
    args: { 0: "guard" },
    reason:
      "Picks the guard's own message or the caller's invalidId (argument 1, checked): reads only the `.reason` and " +
      "`.error.message` of the guard result it is handed (argument 0, which must be a listed guard's result).",
  },
  {
    kind: "state",
    module: "lib/csvRefusal",
    name: "csvRefusalResult",
    reason: "The import state for a refused upload: dictionary text and counts read off the caller's own file.",
  },
  {
    kind: "state",
    module: "lib/helpers",
    name: "formDataToObject",
    reason: "The action's own form fields as a plain object: input, nothing read from the base.",
  },
  {
    kind: "state",
    module: "lib/csv",
    name: "readCsvUpload",
    reason: "The caller's own uploaded CSV, decoded and split into records: input.",
  },
  {
    kind: "fields",
    module: "service/clients",
    name: "createClient",
    fields: ["message"],
    reason:
      "The success state the service builds: `.message` is t.clients.messages.created. Its `.id` goes to the activity log, " +
      "never to the return.",
  },
  {
    kind: "fields",
    module: "lib/deliveryNoteScan",
    name: "extractDeliveryNoteItems",
    fields: ["items", "supplier"],
    reason:
      "The model's reading of the caller's own photo, revalidated by scannedDeliveryNoteSchema before it leaves lib/: the " +
      "preview the user reviews before anything is written — the purpose of scanDeliveryNote. `bytesSent` is logged only.",
  },
  {
    kind: "fields",
    module: "lib/rate-limit",
    name: "isRateLimited",
    fields: ["retryAfterMs"],
    reason: "How long the caller's own rate-limit window still runs (milliseconds, shown rounded to minutes).",
  },
  {
    kind: "fields",
    module: "lib/loginRateLimit",
    name: "isLoginRateLimited",
    fields: ["retryAfterMs"],
    reason: "How long the caller's own login window still runs (milliseconds, shown rounded to minutes).",
  },
  {
    kind: "fields",
    module: "repository/materialCategories",
    name: "remove",
    fields: ["unfiledCount"],
    reason: "How many materials fell back to « non classé »: the count the success message reports.",
  },
  {
    kind: "fields",
    module: "repository/tasks",
    name: "createMany",
    fields: ["count"],
    reason: "Prisma's BatchPayload: how many tasks the series created, the count the success message reports.",
  },
  {
    kind: "fields",
    module: "repository/users",
    name: "countOwnershipBlockers",
    fields: ["equipmentCount", "openLoanCount"],
    reason: "The two counts that block a deletion, reported in the refusal.",
  },
  {
    kind: "fresh",
    module: "crypto",
    name: "randomBytes",
    reason:
      "A fresh random value made by the action itself: createPortalLogin's one-time token, handed to the administrator who " +
      "sends the link — the purpose of that action.",
  },
];

/** A binding imported from schemas/, called with one of these: what it returns is the action's own input, validated. */
const SCHEMA_MODULE_PREFIX = "schemas/";
const SCHEMA_METHODS: ReadonlySet<string> = new Set(["safeParse"]);
const SCHEMA_RULE_KEY = "schemas/*.safeParse";

/**
 * The names `data` may carry: `data` is a literal whose every value reads ONE of
 * these fields (`row.id`, or `id` destructured from a row), and nothing else.
 */
export const DATA_FIELDS: ReadonlyMap<string, string> = new Map([
  ["id", "addUser: the new account's id, which UsersManager needs to attach its project assignments."],
  ["categoryId", "addTask / addTaskSeries: the category the new task or series landed in, which the form reveals."],
]);

/**
 * Built-in functions (no declaration in the file). "checked": a pure function of
 * its arguments, admitted when every argument is; "tuple": Promise.all, the
 * array of its argument's elements; "fresh": owes nothing to any value.
 */
const BUILT_IN_CALLS: ReadonlyMap<string, "checked" | "tuple" | "fresh"> = new Map([
  ["Math.*", "checked"],
  ["String", "checked"],
  ["Number", "checked"],
  ["Boolean", "checked"],
  ["JSON.stringify", "checked"],
  ["Object.entries", "checked"],
  ["Object.fromEntries", "checked"],
  ["Object.keys", "checked"],
  ["Object.values", "checked"],
  ["Object.assign", "checked"],
  ["Number.isInteger", "checked"],
  ["Number.isFinite", "checked"],
  ["Array.isArray", "checked"],
  ["isNaN", "checked"],
  ["Promise.all", "tuple"],
  ["Date.now", "fresh"],
]);

/**
 * Built-in methods on an admitted value. "derived": the result owes everything to
 * the receiver and the (non-callback) arguments; "elements": the receiver's own
 * elements (filter, slice…); "element": one of them; "map": the callback's
 * returns, the callback entered with its parameter bound to an element.
 */
const VALUE_METHODS: ReadonlyMap<string, "derived" | "elements" | "element" | "map"> = new Map([
  ["get", "derived"],
  ["getAll", "derived"],
  ["has", "derived"],
  ["toString", "derived"],
  ["toFixed", "derived"],
  ["trim", "derived"],
  ["toLowerCase", "derived"],
  ["toUpperCase", "derived"],
  ["split", "derived"],
  ["join", "derived"],
  ["includes", "derived"],
  ["indexOf", "derived"],
  ["startsWith", "derived"],
  ["endsWith", "derived"],
  ["some", "derived"],
  ["every", "derived"],
  ["forEach", "derived"],
  ["replace", "map"],
  ["replaceAll", "map"],
  ["filter", "elements"],
  ["slice", "elements"],
  ["concat", "elements"],
  ["sort", "elements"],
  ["reverse", "elements"],
  ["find", "element"],
  ["at", "element"],
  ["map", "map"],
  ["flatMap", "map"],
]);

/** Methods that WRITE into their receiver, and the arguments that become its content. */
const MUTATING_METHODS: ReadonlyMap<string, (args: readonly ts.Expression[]) => readonly ts.Expression[]> = new Map([
  ["push", (a: readonly ts.Expression[]) => a],
  ["unshift", (a: readonly ts.Expression[]) => a],
  ["splice", (a: readonly ts.Expression[]) => a.slice(2)],
  ["fill", (a: readonly ts.Expression[]) => a.slice(0, 1)],
  ["set", (a: readonly ts.Expression[]) => a.slice(0, 2)],
  ["add", (a: readonly ts.Expression[]) => a],
]);

const closedKey = (module: string, name: string) => `${module}::${name}`;
const CLOSED_BY_KEY: ReadonlyMap<string, ClosedEntry> = new Map(CLOSED_LIST.map((e) => [closedKey(e.module, e.name), e]));

/** Every key the scan records when an entry admits a value: the closed list, the schema rule, the data fields. */
export function closedListKeys(): string[] {
  return [...CLOSED_LIST.map((e) => closedKey(e.module, e.name)), SCHEMA_RULE_KEY, ...[...DATA_FIELDS.keys()].map((f) => `data:${f}`)];
}

// ===========================================================================
// Discovery.
// ===========================================================================

const SERVER_DIRECTIVE = "use server";

/** Every extension Next compiles a module from: a `"use server"` file can be any of them. */
const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Directory NAMES never entered, at any depth: other trees (FOREIGN_TREE_DIRS —
 * node_modules, the agents' worktrees under .claude), the build output, the VCS
 * metadata. Any other directory is walked, hidden ones included.
 */
const SKIPPED_DIR_NAMES: ReadonlySet<string> = new Set([...FOREIGN_TREE_DIRS, ".next", ".git"]);

/** Repository-relative PATHS never entered: the generated Prisma client, and only it (another folder named `generated` is walked). */
const SKIPPED_PATHS: ReadonlySet<string> = new Set(["app/generated"]);

function scriptKindOf(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(source: Source): ts.SourceFile {
  return ts.createSourceFile(source.path, source.text, ts.ScriptTarget.ESNext, true, scriptKindOf(source.path));
}

/** Every source file of the tree under `root` (paths repository-relative, `/`-separated), minus SKIPPED_DIR_NAMES / SKIPPED_PATHS. */
export function repositorySources(root: string): Source[] {
  const out: Source[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) {
        if (SKIPPED_DIR_NAMES.has(name) || SKIPPED_PATHS.has(relPath)) continue;
        walk(full, relPath);
      } else if (SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
        out.push({ path: relPath, text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root, "");
  return out;
}

/** The file-level directive prologue contains "use server" (parsed, not matched in text). */
export function hasUseServerDirective(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === SERVER_DIRECTIVE) return true;
  }
  return false;
}

/** Functions carrying their own `"use server"` prologue: an inline Server Action. */
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

export function parseSource(source: Source): ts.SourceFile {
  return parse(source);
}

/** The files whose file-level directive is "use server". Cheap text pre-filter, then a real parse. */
export function serverActionSources(sources: readonly Source[]): Source[] {
  return sources.filter((s) => s.text.includes(SERVER_DIRECTIVE) && hasUseServerDirective(parse(s)));
}

// ===========================================================================
// The exports of a "use server" file — each one an action, a body or not.
// ===========================================================================

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

export type ExportedAction = {
  file: string;
  name: string;
  line: number;
  /** The function literal the export IS. Absent for an opaque export or a re-export. */
  fn?: FunctionLike;
  /** Why the export cannot be scanned (it is then a finding). */
  opaque?: string;
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

const isFunctionLiteral = (e: ts.Expression): e is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(e) || ts.isFunctionExpression(e);

function isConstDeclaration(d: ts.VariableDeclaration): boolean {
  return ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;
}

function unwrapParens(e: ts.Expression): ts.Expression {
  let c = e;
  while (ts.isParenthesizedExpression(c)) c = c.expression;
  return c;
}

/** A top-level local of the file, as `export { name }` / `export default name` reaches it. */
function localExportTarget(source: ts.SourceFile, local: string): { fn?: FunctionLike; opaque?: string; type?: true } {
  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === local && st.body) return { fn: st };
    if ((ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name.text === local) return { type: true };
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== local) continue;
        const init = d.initializer && unwrapParens(d.initializer);
        if (init && isFunctionLiteral(init) && isConstDeclaration(d)) return { fn: init };
        return { opaque: `export of "${local}", whose value is not a function literal` };
      }
    }
  }
  if (source.statements.some((st) => ts.isFunctionDeclaration(st) && st.name?.text === local)) return { type: true }; // overload signatures only
  return { opaque: `export of "${local}", which is not a function declared in this file` };
}

/**
 * Every value export of a `"use server"` file: each is registered as an action.
 * A function literal is scanned; anything else (`export const f = withGuard(…)`,
 * `export const f = g`, a class, an enum, a re-export, CommonJS) is an OPAQUE
 * export — counted, and a finding. Type-only exports are not values.
 */
export function exportedActionsOf(path: string, source: ts.SourceFile): ExportedAction[] {
  const out: ExportedAction[] = [];
  const lineOf = (n: ts.Node) => source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const add = (name: string, node: ts.Node, target: { fn?: FunctionLike; opaque?: string; type?: true }) => {
    if (target.type) return;
    out.push({ file: path, name, line: lineOf(node), fn: target.fn, opaque: target.opaque });
  };
  for (const st of source.statements) {
    const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st)) {
      if (!exported || !st.body) continue; // overload signatures carry no body
      const name = hasModifier(st, ts.SyntaxKind.DefaultKeyword) ? "default" : (st.name?.text ?? "default");
      add(name, st, st.asteriskToken ? { opaque: "a generator: what it yields is not scanned" } : { fn: st });
    } else if (ts.isVariableStatement(st)) {
      if (!exported) continue;
      for (const d of st.declarationList.declarations) {
        const name = ts.isIdentifier(d.name) ? d.name.text : d.name.getText();
        const init = d.initializer && unwrapParens(d.initializer);
        if (init && isFunctionLiteral(init) && isConstDeclaration(d) && ts.isIdentifier(d.name)) add(name, d, { fn: init });
        else add(name, d, { opaque: `export const ${name} = ${init ? collapse(init.getText()).slice(0, 60) : "(no value)"}: not a function literal` });
      }
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      const clause = st.exportClause;
      if (st.moduleSpecifier) {
        const from = ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : "?";
        if (!clause || ts.isNamespaceExport(clause)) add(clause ? clause.name.text : "*", st, { opaque: `re-export from "${from}": its returns are not in this file` });
        else for (const el of clause.elements) if (!el.isTypeOnly) add(el.name.text, el, { opaque: `re-export from "${from}": its returns are not in this file` });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          if (el.isTypeOnly) continue;
          add(el.name.text, el, localExportTarget(source, (el.propertyName ?? el.name).text));
        }
      }
    } else if (ts.isExportAssignment(st)) {
      const e = unwrapParens(st.expression);
      if (st.isExportEquals) add("export=", st, { opaque: "`export =`: not a function literal" });
      else if (isFunctionLiteral(e)) add("default", st, { fn: e });
      else if (ts.isIdentifier(e)) add("default", st, localExportTarget(source, e.text));
      else add("default", st, { opaque: `export default ${collapse(e.getText()).slice(0, 60)}: not a function literal` });
    } else if (exported && !ts.isTypeAliasDeclaration(st) && !ts.isInterfaceDeclaration(st)) {
      const declName =
        ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st) || ts.isImportEqualsDeclaration(st) ? st.name : undefined;
      const name = declName && ts.isIdentifier(declName) ? declName.text : ts.SyntaxKind[st.kind];
      if (!(ts.isModuleDeclaration(st) && hasModifier(st, ts.SyntaxKind.DeclareKeyword))) {
        add(name, st, { opaque: `exported ${ts.SyntaxKind[st.kind]}: not a function literal` });
      }
    } else if (ts.isExpressionStatement(st) && isCommonJsExport(st.expression)) {
      add("module.exports", st, { opaque: "CommonJS export: not scanned" });
    }
  }
  return out;
}

function isCommonJsExport(e: ts.Expression): boolean {
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  let target: ts.Expression = e.left;
  while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = target.expression;
  return ts.isIdentifier(target) && (target.text === "exports" || (target.text === "module" && e.left.getText().startsWith("module.exports")));
}

// ===========================================================================
// The program: bindings resolved by the checker, modules never resolved.
// ===========================================================================

const COMPILER_OPTIONS: ts.CompilerOptions = {
  noResolve: true,
  noLib: true,
  allowJs: true,
  checkJs: false,
  noEmit: true,
  types: [],
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve,
};

type Scan = {
  checker: ts.TypeChecker;
  files: ReadonlyMap<string, ts.SourceFile>;
  /** Per file: every value reference of a symbol (declaration names excluded). */
  references: Map<ts.SourceFile, Map<ts.Symbol, ts.Identifier[]>>;
  symbolIds: WeakMap<ts.Symbol, number>;
  active: Set<string>;
  used: Set<string>;
  counter: number;
  /** Guarded steps spent on the current action (MAX_STEPS bounds it). */
  steps: number;
};

function createScan(sources: readonly Source[]): Scan {
  const files = new Map<string, ts.SourceFile>();
  for (const s of sources) files.set(s.path, parse(s));
  const lookup = (name: string) => files.get(name) ?? files.get(name.replace(/^\/+/, ""));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => lookup(name),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (name) => lookup(name) !== undefined,
    readFile: (name) => lookup(name)?.text,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({ rootNames: [...files.keys()], options: COMPILER_OPTIONS, host });
  return {
    checker: program.getTypeChecker(),
    files,
    references: new Map(),
    symbolIds: new WeakMap(),
    active: new Set(),
    used: new Set(),
    counter: 0,
    steps: 0,
  };
}

function symbolOf(scan: Scan, id: ts.Identifier): ts.Symbol | undefined {
  const parent = id.parent;
  if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === id) return scan.checker.getShorthandAssignmentValueSymbol(parent);
  return scan.checker.getSymbolAtLocation(id);
}

function symbolId(scan: Scan, sym: ts.Symbol): number {
  let id = scan.symbolIds.get(sym);
  if (id === undefined) {
    id = ++scan.counter;
    scan.symbolIds.set(sym, id);
  }
  return id;
}

/** An identifier that only NAMES something (a declaration, a property, a key): not a reference to a value. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isPropertyAssignment(p) && p.name === id) return true;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return true;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name === id) return true;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return true;
  if (ts.isTypeReferenceNode(p) || ts.isQualifiedName(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
  if ((ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === id) return true;
  return false;
}

function referencesOf(scan: Scan, sym: ts.Symbol, inFile: ts.SourceFile): ts.Identifier[] {
  let index = scan.references.get(inFile);
  if (!index) {
    const built = new Map<ts.Symbol, ts.Identifier[]>();
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && !isNamePosition(n)) {
        const s = symbolOf(scan, n);
        if (s) {
          const list = built.get(s);
          if (list) list.push(n);
          else built.set(s, [n]);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(inFile);
    index = built;
    scan.references.set(inFile, index);
  }
  return index.get(sym) ?? [];
}

// ===========================================================================
// The analysis: is the value at `path` inside `expr` admitted?
// ===========================================================================

type Verdict = string | null;
const ADMITTED: Verdict = null;

/** Field names read off a value; ANY = an element or a field the scan cannot name. */
type Path = readonly string[];
const ANY = "*";
const MAX_DEPTH = 60;
/**
 * Steps one action may spend. A helper is entered once per call, with that call's bindings (precise, but a
 * recursive helper multiplies the work): past this budget the action is red, never green. About 180 times
 * what the most demanding action of the repository takes (110 steps, measured on branch fix/retours-actions).
 */
const MAX_STEPS = 20_000;

type ParamBinding =
  | { kind: "arg"; expr: ts.Expression; ctx: Ctx }
  | { kind: "element"; of: ts.Expression; ctx: Ctx }
  | { kind: "value"; of: ts.Expression; ctx: Ctx }
  | { kind: "rest"; exprs: readonly ts.Expression[]; ctx: Ctx }
  | { kind: "missing" };

type Ctx = {
  scan: Scan;
  source: ts.SourceFile;
  /** The exported action under scan: its own parameters are its input. */
  action: FunctionLike;
  /** Parameters of the local functions entered on the way here, bound to what the call passed. */
  bindings: ReadonlyMap<ts.ParameterDeclaration, ParamBinding>;
  id: number;
  depth: number;
};

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
const kindName = (n: ts.Node) => ts.SyntaxKind[n.kind];

function firstOf<T>(items: readonly T[], fn: (item: T, index: number) => Verdict): Verdict {
  for (let i = 0; i < items.length; i++) {
    const r = fn(items[i], i);
    if (r) return r;
  }
  return ADMITTED;
}

function unwrap(e: ts.Expression): ts.Expression {
  let c = e;
  for (;;) {
    if (
      ts.isParenthesizedExpression(c) ||
      ts.isAwaitExpression(c) ||
      ts.isAsExpression(c) ||
      ts.isTypeAssertionExpression(c) ||
      ts.isNonNullExpression(c) ||
      ts.isSatisfiesExpression(c)
    ) {
      c = c.expression;
    } else return c;
  }
}

/** Cycle and depth guard. A cycle contributes nothing the other definitions do not already (least fixpoint). */
function guarded(ctx: Ctx, key: string, fn: () => Verdict): Verdict {
  if (ctx.depth > MAX_DEPTH) return "too deep to follow";
  if (++ctx.scan.steps > MAX_STEPS) return "too complex to follow (step budget)";
  const k = `${ctx.id}|${key}`;
  if (ctx.scan.active.has(k)) return ADMITTED;
  ctx.scan.active.add(k);
  try {
    return fn();
  } finally {
    ctx.scan.active.delete(k);
  }
}

const nodeKey = (n: ts.Node) => `${n.getSourceFile().fileName}:${n.pos}:${n.end}`;

function isLiteral(e: ts.Expression): boolean {
  return (
    ts.isStringLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  );
}

function segmentOf(arg: ts.Expression): string {
  const a = unwrapParens(arg);
  if (ts.isStringLiteral(a) || ts.isNumericLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return a.text;
  return ANY;
}

function propertyNameText(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const e = unwrapParens(name.expression);
    if (ts.isStringLiteral(e) || ts.isNumericLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return undefined;
}

function check(raw: ts.Expression, ctx: Ctx, path: Path, top: boolean): Verdict {
  const e = unwrap(raw);
  if (isLiteral(e)) return ADMITTED;
  if (ts.isTemplateExpression(e)) return firstOf(e.templateSpans, (s) => check(s.expression, ctx, [], false));
  if (ts.isIdentifier(e)) return checkIdentifier(e, ctx, path, top);
  if (ts.isPropertyAccessExpression(e)) return check(e.expression, ctx, [e.name.text, ...path], top);
  if (ts.isElementAccessExpression(e)) return check(e.expression, ctx, [segmentOf(e.argumentExpression), ...path], top);
  if (ts.isCallExpression(e)) return checkCall(e, ctx, path, top);
  if (ts.isObjectLiteralExpression(e)) return checkObject(e, ctx, path, top);
  if (ts.isArrayLiteralExpression(e)) return checkArray(e, ctx, path);
  if (ts.isConditionalExpression(e)) return check(e.whenTrue, ctx, path, top) ?? check(e.whenFalse, ctx, path, top);
  if (ts.isBinaryExpression(e)) return checkBinary(e, ctx, path, top);
  if (ts.isPrefixUnaryExpression(e)) return e.operator === ts.SyntaxKind.ExclamationToken ? ADMITTED : check(e.operand, ctx, [], false);
  if (ts.isPostfixUnaryExpression(e)) return check(e.operand, ctx, [], false);
  if (ts.isTypeOfExpression(e) || ts.isVoidExpression(e) || ts.isDeleteExpression(e)) return ADMITTED;
  if (ts.isOmittedExpression(e)) return ADMITTED;
  if (isFunctionLiteral(e)) return "a function value is not a state";
  return `${kindName(e)} is not a form the closed list admits`;
}

const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);

const PASS_THROUGH_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function checkBinary(e: ts.BinaryExpression, ctx: Ctx, path: Path, top: boolean): Verdict {
  const k = e.operatorToken.kind;
  if (PASS_THROUGH_OPERATORS.has(k)) return check(e.left, ctx, path, top) ?? check(e.right, ctx, path, top);
  if (k === ts.SyntaxKind.CommaToken || k === ts.SyntaxKind.EqualsToken) return check(e.right, ctx, path, top);
  if (COMPARISONS.has(k)) return ADMITTED;
  // Arithmetic, concatenation, bitwise, compound assignments: a primitive made of both sides.
  return check(e.left, ctx, [], false) ?? check(e.right, ctx, [], false);
}

function checkObject(obj: ts.ObjectLiteralExpression, ctx: Ctx, path: Path, top: boolean): Verdict {
  if (path.length === 0) {
    for (const p of obj.properties) {
      let r: Verdict;
      let label: string;
      if (ts.isSpreadAssignment(p)) {
        label = `spread ...${collapse(p.expression.getText()).slice(0, 40)}`;
        r = check(p.expression, ctx, [], top);
      } else if (ts.isPropertyAssignment(p)) {
        const key = propertyNameText(p.name);
        label = `property "${key ?? p.name.getText()}"`;
        if (key === undefined) r = ts.isComputedPropertyName(p.name) ? check(p.name.expression, ctx, [], false) ?? check(p.initializer, ctx, [], false) : check(p.initializer, ctx, [], false);
        else if (top && key === "data") r = dataRule(p.initializer, ctx);
        else r = check(p.initializer, ctx, [], false);
      } else if (ts.isShorthandPropertyAssignment(p)) {
        label = `property "${p.name.text}"`;
        r = top && p.name.text === "data" ? dataRule(p.name, ctx) : checkIdentifier(p.name, ctx, [], false);
      } else {
        label = kindName(p);
        r = "a method or accessor in a returned object";
      }
      if (r) return `${label}: ${r}`;
    }
    return ADMITTED;
  }
  const [head, ...rest] = path;
  for (const p of obj.properties) {
    let r: Verdict = ADMITTED;
    if (ts.isSpreadAssignment(p)) r = check(p.expression, ctx, path, top);
    else if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
      const key = propertyNameText(p.name);
      if (key !== undefined && head !== ANY && key !== head) continue;
      r = ts.isPropertyAssignment(p) ? check(p.initializer, ctx, rest, top) : checkIdentifier(p.name, ctx, rest, top);
    } else {
      const key = p.name ? propertyNameText(p.name) : undefined;
      if (key === head || head === ANY) r = "a method or accessor in a returned object";
    }
    if (r) return `field "${head}": ${r}`;
  }
  return ADMITTED; // the field is absent: undefined
}

function checkArray(arr: ts.ArrayLiteralExpression, ctx: Ctx, path: Path): Verdict {
  const elementAt = (el: ts.Expression, rest: Path) => (ts.isSpreadElement(el) ? check(el.expression, ctx, [ANY, ...rest], false) : check(el, ctx, rest, false));
  if (path.length === 0) return firstOf(arr.elements, (el) => (ts.isSpreadElement(el) ? check(el.expression, ctx, [], false) : check(el, ctx, [], false)));
  const [head, ...rest] = path;
  if (head === "length") return ADMITTED;
  const index = /^\d+$/.test(head) ? Number(head) : -1;
  const noSpreadBefore = index >= 0 && !arr.elements.slice(0, index + 1).some(ts.isSpreadElement);
  if (noSpreadBefore) {
    const el = arr.elements[index];
    return el ? elementAt(el, rest) : ADMITTED;
  }
  if (head === ANY || index >= 0) return firstOf(arr.elements, (el) => elementAt(el, rest));
  return ADMITTED; // a non-index field of an array: a method, or undefined
}

/**
 * `data` (of the returned state): a literal whose every value reads a named field
 * from DATA_FIELDS — `x.id`, or `id` destructured from a field of that name. Any
 * other form is red: no spread, no call, no literal, no conditional.
 */
function dataRule(value: ts.Expression, ctx: Ctx): Verdict {
  let v = value;
  while (ts.isParenthesizedExpression(v) || ts.isAsExpression(v) || ts.isSatisfiesExpression(v) || ts.isNonNullExpression(v)) v = v.expression;
  const names = [...DATA_FIELDS.keys()].join(", ");
  if (!ts.isObjectLiteralExpression(v)) return `data must be a literal of named fields (${names}), not ${kindName(v)} \`${collapse(v.getText()).slice(0, 50)}\``;
  for (const p of v.properties) {
    let read: ts.Expression;
    let key: string;
    if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name)) {
      read = p.initializer;
      key = p.name.getText();
    } else if (ts.isShorthandPropertyAssignment(p)) {
      read = p.name;
      key = p.name.text;
    } else return `data: ${kindName(p)} is not a named field (${names})`;
    const field = namedFieldOf(read, ctx);
    if (field === undefined) return `data.${key} is not a named field read (\`${collapse(read.getText()).slice(0, 50)}\`)`;
    if (!DATA_FIELDS.has(field)) return `data.${key} reads "${field}", which is not in DATA_FIELDS (${names})`;
    ctx.scan.used.add(`data:${field}`);
  }
  return ADMITTED;
}

function namedFieldOf(e: ts.Expression, ctx: Ctx): string | undefined {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  if (ts.isPropertyAccessExpression(x)) return x.name.text;
  if (ts.isIdentifier(x)) {
    const d = symbolOf(ctx.scan, x)?.declarations?.[0];
    if (d && ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && !d.dotDotDotToken) return propertyNameText(d.propertyName ?? d.name);
  }
  return undefined;
}

// ---------- identifiers ----------

function checkIdentifier(id: ts.Identifier, ctx: Ctx, path: Path, top: boolean): Verdict {
  const sym = symbolOf(ctx.scan, id);
  const decls = sym?.declarations ?? [];
  if (!sym || decls.length === 0) {
    if (id.text === "undefined" || id.text === "NaN" || id.text === "Infinity") return ADMITTED;
    return `unresolved identifier "${id.text}" (a global the closed list does not admit, or a binding the scan cannot see)`;
  }
  return guarded(ctx, `id:${symbolId(ctx.scan, sym)}:${path.join(".")}:${top}`, () => {
    const fromDecl = firstOf(decls, (d) => checkDeclaration(d, ctx, path, top));
    if (fromDecl) return `"${id.text}" ${fromDecl}`;
    const isValueBinding = decls.some((d) => ts.isVariableDeclaration(d) || ts.isBindingElement(d) || ts.isParameter(d));
    return isValueBinding ? checkUses(sym, id.text, ctx, path, top, false) : ADMITTED;
  });
}

function checkDeclaration(d: ts.Declaration, ctx: Ctx, path: Path, top: boolean): Verdict {
  if (ts.isParameter(d)) return checkParameter(d, ctx, path, top);
  if (ts.isVariableDeclaration(d)) {
    if (ts.isCatchClause(d.parent)) return "is a caught exception: whatever was thrown";
    return checkVariable(d, ctx, path, top);
  }
  if (ts.isBindingElement(d)) return checkBindingElement(d, ctx, path, top);
  if (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d) || ts.isImportEqualsDeclaration(d)) {
    return `is the imported binding ${describeImport(importOf(d))}, not a state`;
  }
  if (ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isClassDeclaration(d)) return "is a function or a class, not a state";
  return `is a ${kindName(d)}, not a form the closed list admits`;
}

function checkVariable(d: ts.VariableDeclaration, ctx: Ctx, path: Path, top: boolean): Verdict {
  const statement = d.parent.parent;
  if (ts.isForOfStatement(statement)) return check(statement.expression, ctx, [ANY, ...path], false);
  if (ts.isForInStatement(statement)) return check(statement.expression, ctx, [], false);
  return d.initializer ? check(d.initializer, ctx, path, top) : ADMITTED;
}

function checkBindingElement(be: ts.BindingElement, ctx: Ctx, path: Path, top: boolean): Verdict {
  // Segments from the outermost pattern to this element; defaults on the way.
  const segments: string[] = [];
  const defaults: { expr: ts.Expression; depth: number }[] = [];
  let node: ts.Node = be;
  while (ts.isBindingElement(node)) {
    const element: ts.BindingElement = node;
    const pattern = element.parent;
    if (element.initializer) defaults.push({ expr: element.initializer, depth: segments.length });
    if (ts.isObjectBindingPattern(pattern)) {
      if (!element.dotDotDotToken) segments.unshift(propertyNameText(element.propertyName ?? element.name) ?? ANY);
    } else {
      segments.unshift(element.dotDotDotToken ? ANY : String(pattern.elements.indexOf(element)));
    }
    node = pattern.parent;
  }
  const full = [...segments, ...path];
  let fromRoot: Verdict;
  if (ts.isVariableDeclaration(node)) {
    if (ts.isCatchClause(node.parent)) return "is destructured from a caught exception";
    const statement = node.parent.parent;
    if (ts.isForOfStatement(statement)) fromRoot = check(statement.expression, ctx, [ANY, ...full], false);
    else fromRoot = node.initializer ? check(node.initializer, ctx, full, top) : ADMITTED;
  } else if (ts.isParameter(node)) {
    fromRoot = checkParameter(node, ctx, full, top);
  } else return `is destructured from a ${kindName(node)}`;
  if (fromRoot) return fromRoot;
  // A default applies at the depth it is written: the path below it.
  return firstOf(defaults, (df) => check(df.expr, ctx, full.slice(segments.length - df.depth), top));
}

function checkParameter(p: ts.ParameterDeclaration, ctx: Ctx, path: Path, top: boolean): Verdict {
  const fromDefault = p.initializer ? check(p.initializer, ctx, path, top) : ADMITTED;
  const b = ctx.bindings.get(p);
  if (b) {
    let r: Verdict;
    switch (b.kind) {
      case "arg":
        r = check(b.expr, b.ctx, path, top);
        break;
      case "element":
        r = check(b.of, b.ctx, [ANY, ...path], false);
        break;
      case "value":
        r = check(b.of, b.ctx, [], false);
        break;
      case "rest": {
        const [head, ...rest] = path;
        if (path.length === 0) r = firstOf(b.exprs, (x) => check(x, b.ctx, [], false));
        else if (head === "length") r = ADMITTED;
        else if (/^\d+$/.test(head)) r = b.exprs[Number(head)] ? check(b.exprs[Number(head)], b.ctx, rest, false) : ADMITTED;
        else r = firstOf(b.exprs, (x) => check(x, b.ctx, rest, false));
        break;
      }
      case "missing":
        r = ADMITTED;
        break;
    }
    return r ?? fromDefault;
  }
  // The action's own parameter: its input (prevState, formData, an id…).
  if (p.parent === ctx.action) return fromDefault;
  return `is a parameter of ${p.parent.name ? `"${p.parent.name.getText()}"` : "a function"}, which the scan did not enter through a call`;
}

// ---------- what else is written into a binding ----------

type Use =
  /** `prefix`: where the binding sits inside `value` (a destructuring target, a `for…of` element); `defaults` written in that target. */
  | { kind: "assign"; value: ts.Expression; plain: boolean; prefix: Path; defaults: readonly ts.Expression[]; node: ts.Node }
  | { kind: "inc"; node: ts.Node }
  | { kind: "write"; chain: readonly string[]; value: ts.Expression | undefined; node: ts.Node }
  | { kind: "method"; method: string; args: readonly ts.Expression[]; node: ts.Node }
  | { kind: "argument"; call: ts.CallExpression; index: number; node: ts.Node }
  /** Bindings that now hold the value (`whole`) or a part of it (a member, an element): what is written through them is written into it. */
  | { kind: "alias"; targets: readonly ts.Identifier[]; whole: boolean; node: ts.Node }
  | { kind: "read" };

/** The identifiers a binding name declares (`a`, `{ a, b: [c] }` -> a, c). */
function boundIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((el) => (ts.isBindingElement(el) ? boundIdentifiers(el.name) : []));
}

/** The identifiers an assignment target writes (`a`, `{ a, b: [c] }`, `[a = 1, ...r]`); a property target writes into another value. */
function targetIdentifiers(e: ts.Expression): ts.Identifier[] {
  const x = unwrapParens(e);
  if (ts.isIdentifier(x)) return [x];
  if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) return targetIdentifiers(x.left);
  if (ts.isArrayLiteralExpression(x)) return x.elements.flatMap((el) => targetIdentifiers(ts.isSpreadElement(el) ? el.expression : el));
  if (ts.isObjectLiteralExpression(x)) {
    return x.properties.flatMap((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return [p.name];
      if (ts.isPropertyAssignment(p)) return targetIdentifiers(p.initializer);
      if (ts.isSpreadAssignment(p)) return targetIdentifiers(p.expression);
      return [];
    });
  }
  return [];
}

/** The identifiers a `for…of` / `for…in` initializer binds or writes. */
function loopIdentifiers(init: ts.ForInitializer): ts.Identifier[] {
  if (ts.isVariableDeclarationList(init)) return init.declarations.flatMap((d) => boundIdentifiers(d.name));
  return targetIdentifiers(init);
}

function isAssignmentOperator(k: ts.SyntaxKind): boolean {
  return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
}

/**
 * `ref` written by a destructuring ASSIGNMENT (`({ a } = v)`, `[a] = v`) or as
 * the variable of a `for (a of v)` / `for (a in v)` it does not declare: the
 * value it receives, and where it sits inside it. Undefined when `ref` is in no
 * such target.
 */
function destructuringTarget(
  ref: ts.Identifier
): { value: ts.Expression; prefix: Path; keysOnly: boolean; defaults: readonly ts.Expression[] } | undefined {
  const segments: string[] = [];
  const defaults: ts.Expression[] = [];
  let node: ts.Node = ref;
  let inPattern = false;
  for (;;) {
    const p: ts.Node = node.parent;
    if (ts.isForOfStatement(p) && p.initializer === node) return { value: p.expression, prefix: [ANY, ...segments], keysOnly: false, defaults };
    if (ts.isForInStatement(p) && p.initializer === node) return { value: p.expression, prefix: [], keysOnly: true, defaults };
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === node) {
      const outer = p.parent;
      // `{ a: b = 1 }` / `[b = 1]`: a default inside the target, not the assignment itself.
      if ((ts.isPropertyAssignment(outer) && outer.initializer === p) || ts.isArrayLiteralExpression(outer)) {
        defaults.push(p.right);
        node = p;
        continue;
      }
      // A plain `b = v` (not in a pattern) is classified by the caller.
      return inPattern ? { value: p.right, prefix: segments, keysOnly: false, defaults } : undefined;
    }
    if (ts.isShorthandPropertyAssignment(p) && p.name === node) {
      segments.unshift(p.name.text);
      if (p.objectAssignmentInitializer) defaults.push(p.objectAssignmentInitializer);
      node = p.parent;
    } else if (ts.isPropertyAssignment(p) && p.initializer === node) {
      segments.unshift(propertyNameText(p.name) ?? ANY);
      node = p.parent;
    } else if (ts.isArrayLiteralExpression(p)) {
      const i = p.elements.findIndex((el) => el === node);
      segments.unshift(p.elements.slice(0, i + 1).some(ts.isSpreadElement) ? ANY : String(i));
      node = p;
    } else if (ts.isSpreadElement(p)) {
      node = p; // the array branch above makes it ANY
    } else if (ts.isSpreadAssignment(p)) {
      node = p.parent; // an object rest: the rest of the same value
    } else if (ts.isParenthesizedExpression(p)) {
      node = p;
      continue;
    } else return undefined;
    inPattern = true;
  }
}

function classify(ref: ts.Identifier): Use {
  const target = destructuringTarget(ref);
  if (target) {
    return target.keysOnly
      ? { kind: "assign", value: target.value, plain: false, prefix: [], defaults: target.defaults, node: ref }
      : { kind: "assign", value: target.value, plain: true, prefix: target.prefix, defaults: target.defaults, node: ref };
  }
  let node: ts.Expression = ref;
  const chain: string[] = [];
  for (;;) {
    const p: ts.Node = node.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === node) {
      chain.push(p.name.text);
      node = p;
    } else if (ts.isElementAccessExpression(p) && p.expression === node) {
      chain.push(segmentOf(p.argumentExpression));
      node = p;
    } else if ((ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) && p.expression === node) {
      node = p;
    } else break;
  }
  const p: ts.Node = node.parent;
  if (ts.isBinaryExpression(p) && p.left === node && isAssignmentOperator(p.operatorToken.kind)) {
    if (chain.length > 0) return { kind: "write", chain, value: p.right, node: p };
    const k = p.operatorToken.kind;
    return { kind: "assign", value: p.right, plain: k === ts.SyntaxKind.EqualsToken || PASS_THROUGH_OPERATORS.has(k), prefix: [], defaults: [], node: p };
  }
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) {
    return chain.length > 0 ? { kind: "write", chain, value: undefined, node: p } : { kind: "inc", node: p };
  }
  if (ts.isDeleteExpression(p) && chain.length > 0) return { kind: "write", chain, value: undefined, node: p };
  if (ts.isCallExpression(p) && p.expression === node && chain.length > 0) return { kind: "method", method: chain[chain.length - 1], args: p.arguments, node: p };
  if (ts.isCallExpression(p) && chain.length === 0) {
    const index = p.arguments.indexOf(node);
    if (index >= 0) return { kind: "argument", call: p, index, node: p };
  }
  // `const y = x`, `const { a } = x`, `const a = x.items`: y / a now hold the value or a part of it.
  if (ts.isVariableDeclaration(p) && p.initializer === node) {
    return { kind: "alias", targets: boundIdentifiers(p.name), whole: chain.length === 0 && ts.isIdentifier(p.name), node: p };
  }
  // `y = x` (an identifier target; a property target stores it into ANOTHER value — declared limit).
  if (ts.isBinaryExpression(p) && p.right === node && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const targets = targetIdentifiers(p.left);
    if (targets.length > 0) return { kind: "alias", targets, whole: chain.length === 0 && ts.isIdentifier(unwrapParens(p.left)), node: p };
  }
  // `for (const r of x)`: r holds its elements.
  if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.expression === node) {
    return { kind: "alias", targets: ts.isForOfStatement(p) ? loopIdentifiers(p.initializer) : [], whole: false, node: p };
  }
  return { kind: "read" };
}

const lineOfNode = (n: ts.Node) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;

/**
 * Every assignment of `sym` (judged at `path`, like its declaration) and every
 * write into it (judged as a whole). `writesOnly`: a parameter of a helper that
 * was handed the value — reassigning the parameter does not touch the value.
 */
function checkUses(sym: ts.Symbol, name: string, ctx: Ctx, path: Path, top: boolean, writesOnly: boolean): Verdict {
  for (const ref of referencesOf(ctx.scan, sym, ctx.source)) {
    const u = classify(ref);
    let r: Verdict = ADMITTED;
    switch (u.kind) {
      case "assign":
        if (!writesOnly) {
          r = u.plain ? check(u.value, ctx, [...u.prefix, ...path], top) : check(u.value, ctx, [], false);
          r = r ?? firstOf(u.defaults, (d) => check(d, ctx, path, top));
        }
        break;
      case "write":
        if (u.value) r = top && path.length === 0 && u.chain.length === 1 && u.chain[0] === "data" ? dataRule(u.value, ctx) : check(u.value, ctx, [], false);
        break;
      case "method": {
        const contents = MUTATING_METHODS.get(u.method);
        if (contents) r = firstOf(contents(u.args), (a) => checkArgument(a, ctx));
        else if (!VALUE_METHODS.has(u.method)) r = `method "${u.method}" called on it is not in the closed list`;
        // Its callbacks are handed its elements: what they write through their parameters is written into it.
        r = r ?? firstOf(u.args, (a) => {
          const fn = localFunctionOfCallee(unwrap(a), ctx);
          return fn ? firstOf(fn.parameters.flatMap((p) => boundIdentifiers(p.name)), (id) => followWrites(id, ctx, false)) : ADMITTED;
        });
        break;
      }
      case "argument":
        r = checkHandedOver(u.call, u.index, ctx, top);
        break;
      case "alias":
        r = firstOf(u.targets, (id) => followWrites(id, ctx, u.whole && top && path.length === 0));
        if (r) r = `is aliased: ${r}`;
        break;
      case "inc":
      case "read":
        break;
    }
    if (r) return `"${name}" (line ${lineOfNode("node" in u ? u.node : ref)}, ${u.kind}) ${r}`;
  }
  return ADMITTED;
}

/** What is written through `id` — an alias, a callback or helper parameter holding the value or a part of it — judged as written into the value. */
function followWrites(id: ts.Identifier, ctx: Ctx, top: boolean): Verdict {
  const sym = symbolOf(ctx.scan, id);
  if (!sym) return ADMITTED;
  return guarded(ctx, `writes:${symbolId(ctx.scan, sym)}:${top}`, () => checkUses(sym, id.text, ctx, [], top, true));
}

/** The function reads its arguments through `arguments`: a value handed to it can be written without any parameter. */
function readsArguments(fn: FunctionLike): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === "arguments" && !isNamePosition(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

/** `a.b.c` -> `a`; `f` -> `f`; anything else -> undefined. */
function rootIdentifierOf(e: ts.Expression): ts.Identifier | undefined {
  let c = e;
  while (ts.isPropertyAccessExpression(c) || ts.isElementAccessExpression(c)) c = unwrap(c.expression);
  return ts.isIdentifier(c) ? c : undefined;
}

/**
 * `value` handed to a call as argument `index`: what that call writes into it.
 * A local function is entered (what it writes into the parameter is written into
 * the value); Object.assign's target receives its sources; a built-in the closed
 * list does not know is red, and so is a callee the scan cannot name. An
 * imported function, or a method of ANOTHER value receiving it, is not followed
 * (declared limit: the scan reads the action's file, not the callee's).
 */
function checkHandedOver(call: ts.CallExpression, index: number, ctx: Ctx, top: boolean): Verdict {
  const callee = unwrap(call.expression);
  const root = rootIdentifierOf(callee);
  if (root && !hasDeclaration(ctx, root)) {
    const name = collapse(callee.getText());
    if (name === "Object.assign") return index === 0 ? firstOf(call.arguments.slice(1), (a) => checkArgument(a, ctx)) : ADMITTED;
    const known = BUILT_IN_CALLS.has(name) || BUILT_IN_CALLS.has(`${root.text}.*`) || root.text === "console";
    return known ? ADMITTED : `is handed to ${name}, a built-in the closed list does not know (it may write into it)`;
  }
  const fn = localFunctionOfCallee(callee, ctx);
  if (!fn) {
    if (ts.isIdentifier(callee) && !importDeclarationOf(ctx, callee)) return `is handed to "${callee.text}", which the scan cannot follow`;
    return ADMITTED; // an imported function, or a method of another value: not followed (declared limit)
  }
  if (readsArguments(fn)) return "is handed to a helper that reads `arguments`: what it writes there is not followed";
  const param = fn.parameters[index];
  if (!param) return ADMITTED; // no parameter receives it, and no `arguments` reads it
  const inner = enter(fn, call.arguments, ctx);
  if (typeof inner === "string") return inner;
  // The parameter itself (the whole value) or the bindings a destructured parameter takes out of it.
  const whole = ts.isIdentifier(param.name);
  return guarded(ctx, `handed:${nodeKey(fn)}:${index}`, () =>
    firstOf(boundIdentifiers(param.name), (id) => followWrites(id, inner, whole && top))
  );
}

// ---------- calls ----------

type Import = { module: string; name: string };

function normalizeModule(spec: string, fromFile: string): string {
  let m = spec.startsWith("node:") ? spec.slice(5) : spec;
  if (m.startsWith("@/")) m = m.slice(2);
  else if (m.startsWith("./") || m.startsWith("../")) m = posix.normalize(posix.join(posix.dirname(fromFile), m));
  return m.replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, "").replace(/\/index$/, "");
}

function importOf(d: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport | ts.ImportEqualsDeclaration): Import {
  const file = d.getSourceFile().fileName;
  if (ts.isImportEqualsDeclaration(d)) {
    const ref = d.moduleReference;
    const spec = ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression) ? ref.expression.text : ref.getText();
    return { module: normalizeModule(spec, file), name: "=" };
  }
  let decl: ts.Node = d;
  while (!ts.isImportDeclaration(decl)) decl = decl.parent;
  const spec = ts.isStringLiteral(decl.moduleSpecifier) ? decl.moduleSpecifier.text : "?";
  const name = ts.isImportSpecifier(d) ? (d.propertyName ?? d.name).text : ts.isImportClause(d) ? "default" : "*";
  return { module: normalizeModule(spec, file), name };
}

const describeImport = (imp: Import) => `${imp.module}::${imp.name}`;

function hasDeclaration(ctx: Ctx, id: ts.Identifier): boolean {
  return (symbolOf(ctx.scan, id)?.declarations ?? []).length > 0;
}

function importDeclarationOf(ctx: Ctx, id: ts.Identifier): ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport | ts.ImportEqualsDeclaration | undefined {
  const d = symbolOf(ctx.scan, id)?.declarations?.[0];
  if (d && (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d) || ts.isImportEqualsDeclaration(d))) return d;
  return undefined;
}

function localFunctionOfDeclaration(decls: readonly ts.Declaration[]): FunctionLike | undefined {
  for (const d of decls) {
    if (ts.isFunctionDeclaration(d) && d.body) return d;
    if (ts.isVariableDeclaration(d) && d.initializer && isConstDeclaration(d)) {
      const init = unwrapParens(d.initializer);
      if (isFunctionLiteral(init)) return init;
    }
  }
  return undefined;
}

function localFunctionOfCallee(callee: ts.Expression, ctx: Ctx): FunctionLike | undefined {
  if (isFunctionLiteral(callee)) return callee;
  if (!ts.isIdentifier(callee)) return undefined;
  return localFunctionOfDeclaration(symbolOf(ctx.scan, callee)?.declarations ?? []);
}

/** The return expressions of a function, not descending into nested functions. */
function returnExpressionsOf(fn: FunctionLike): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, visit);
  };
  for (const statement of fn.body.statements) visit(statement);
  return out;
}

/** A context inside `fn`, its parameters bound to `args` (evaluated where the call is). */
function enter(fn: FunctionLike, args: readonly ts.Expression[], ctx: Ctx): Ctx | string {
  if (fn.asteriskToken) return "is a generator: what it yields is not scanned";
  if (args.some(ts.isSpreadElement)) return "is called with a spread argument: its parameters cannot be bound";
  const bindings = new Map(ctx.bindings);
  fn.parameters.forEach((p, i) => {
    if (p.dotDotDotToken) bindings.set(p, { kind: "rest", exprs: args.slice(i), ctx });
    else if (args[i]) bindings.set(p, { kind: "arg", expr: args[i], ctx });
    else bindings.set(p, { kind: "missing" });
  });
  return { ...ctx, bindings, id: ++ctx.scan.counter, depth: ctx.depth + 1 };
}

function enterAndReturn(fn: FunctionLike, args: readonly ts.Expression[], ctx: Ctx, path: Path, top: boolean, label: string): Verdict {
  return guarded(ctx, `call:${nodeKey(fn)}:${path.join(".")}:${top}`, () => {
    const inner = enter(fn, args, ctx);
    if (typeof inner === "string") return `${label} ${inner}`;
    const r = firstOf(returnExpressionsOf(fn), (x) => check(x, inner, path, top));
    return r ? `${label}() returns ${r}` : ADMITTED;
  });
}

/** A binding something reassigns: a `catch` variable or a guard result written over is no longer what its declaration says. */
function reassigned(sym: ts.Symbol, ctx: Ctx): boolean {
  return referencesOf(ctx.scan, sym, ctx.source).some((ref) => classify(ref).kind === "assign");
}

/** `a` is the exception of a `catch` clause (directly, or through a parameter bound to one). */
function isCaughtException(a: ts.Expression, ctx: Ctx): boolean {
  const e = unwrap(a);
  if (!ts.isIdentifier(e)) return false;
  const sym = symbolOf(ctx.scan, e);
  const d = sym?.declarations?.[0];
  if (!sym || !d) return false;
  if (ts.isParameter(d)) {
    const b = ctx.bindings.get(d);
    return b?.kind === "arg" ? isCaughtException(b.expr, b.ctx) : false;
  }
  return ts.isVariableDeclaration(d) && ts.isCatchClause(d.parent) && !reassigned(sym, ctx);
}

function isGuardCall(e: ts.Expression, ctx: Ctx): boolean {
  const x = unwrap(e);
  if (!ts.isCallExpression(x)) return false;
  const callee = unwrap(x.expression);
  if (!ts.isIdentifier(callee)) return false;
  const imp = importDeclarationOf(ctx, callee);
  if (!imp) return false;
  const from = importOf(imp);
  return CLOSED_BY_KEY.get(closedKey(from.module, from.name))?.kind === "guard";
}

/** `a` is the result of a listed guard (the call itself, a `const` bound to it, or a parameter bound to one). */
function isGuardResult(a: ts.Expression, ctx: Ctx): boolean {
  const e = unwrap(a);
  if (isGuardCall(e, ctx)) return true;
  if (!ts.isIdentifier(e)) return false;
  const sym = symbolOf(ctx.scan, e);
  const d = sym?.declarations?.[0];
  if (!sym || !d) return false;
  if (ts.isParameter(d)) {
    const b = ctx.bindings.get(d);
    return b?.kind === "arg" ? isGuardResult(b.expr, b.ctx) : false;
  }
  if (!ts.isVariableDeclaration(d) || ts.isCatchClause(d.parent) || !d.initializer) return false;
  return isGuardCall(d.initializer, ctx) && !reassigned(sym, ctx);
}

/** An argument of a helper: a spread contributes its elements. */
function checkArgument(a: ts.Expression, ctx: Ctx): Verdict {
  return ts.isSpreadElement(a) ? check(a.expression, ctx, [], false) : check(a, ctx, [], false);
}

function checkCall(call: ts.CallExpression, ctx: Ctx, path: Path, top: boolean): Verdict {
  const callee = unwrap(call.expression);
  if (isFunctionLiteral(callee)) return enterAndReturn(callee, call.arguments, ctx, path, top, "an inline function");
  if (ts.isIdentifier(callee)) {
    const decls = symbolOf(ctx.scan, callee)?.declarations ?? [];
    if (decls.length === 0) return checkBuiltIn(callee.text, call, ctx, path, top);
    const imp = importDeclarationOf(ctx, callee);
    if (imp) return checkImported(importOf(imp), call, ctx, path);
    const fn = localFunctionOfDeclaration(decls);
    if (fn) return enterAndReturn(fn, call.arguments, ctx, path, top, callee.text);
    return `call of "${callee.text}" (${kindName(decls[0])}) is not a form the closed list admits`;
  }
  if (ts.isPropertyAccessExpression(callee)) return checkMethodCall(callee, call, ctx, path, top);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return "a dynamic import() is not followed";
  return `call of ${kindName(callee)} is not a form the closed list admits`;
}

function checkImported(imp: Import, call: ts.CallExpression, ctx: Ctx, path: Path): Verdict {
  const key = closedKey(imp.module, imp.name);
  const entry = CLOSED_BY_KEY.get(key);
  if (!entry) return `call to ${key}, which is not in the closed list`;
  const field = path[0];
  let r: Verdict;
  switch (entry.kind) {
    case "dictionary":
    case "fresh":
      r = ADMITTED;
      break;
    case "guard":
      r = field !== undefined && (field === "error" || field === "reason")
        ? ADMITTED
        : `${imp.name}() ${field === undefined ? "as a whole" : `field "${field}"`}: only .error and .reason of a guard are a state`;
      break;
    case "fields":
      r = field !== undefined && entry.fields.includes(field)
        ? ADMITTED
        : `${imp.name}() ${field === undefined ? "as a whole" : `field "${field}"`}: only ${entry.fields.join(", ")} may be read`;
      break;
    case "state":
      r = firstOf(call.arguments, (a, i) => {
        const special = entry.args?.[i];
        if (special === "caught") return isCaughtException(a, ctx) ? ADMITTED : `argument ${i} must be the caught exception of a catch clause`;
        if (special === "guard") return isGuardResult(a, ctx) ? ADMITTED : `argument ${i} must be the result of a listed guard`;
        return checkArgument(a, ctx);
      });
      if (r) r = `${imp.name}(…) is given ${r}`;
      break;
  }
  if (!r) ctx.scan.used.add(key);
  return r;
}

function checkBuiltIn(name: string, call: ts.CallExpression, ctx: Ctx, path: Path, top: boolean): Verdict {
  const dot = name.indexOf(".");
  const kind = BUILT_IN_CALLS.get(name) ?? (dot > 0 ? BUILT_IN_CALLS.get(`${name.slice(0, dot)}.*`) : undefined);
  if (!kind) return `${name}() is not in the closed list`;
  if (kind === "fresh") return ADMITTED;
  if (kind === "tuple") {
    const [first] = call.arguments;
    return first ? check(first, ctx, path, false) : ADMITTED;
  }
  void top;
  const r = firstOf(call.arguments, (a) => checkArgument(a, ctx));
  return r ? `${name}(…) is given ${r}` : ADMITTED;
}

function checkMethodCall(pa: ts.PropertyAccessExpression, call: ts.CallExpression, ctx: Ctx, path: Path, top: boolean): Verdict {
  const m = pa.name.text;
  const recv = unwrap(pa.expression);
  if (ts.isIdentifier(recv)) {
    if (!hasDeclaration(ctx, recv)) return checkBuiltIn(`${recv.text}.${m}`, call, ctx, path, top);
    const imp = importDeclarationOf(ctx, recv);
    if (imp && ts.isNamespaceImport(imp)) return checkImported({ module: importOf(imp).module, name: m }, call, ctx, path);
    if (imp) {
      const from = importOf(imp);
      if (from.module.startsWith(SCHEMA_MODULE_PREFIX) && SCHEMA_METHODS.has(m)) {
        const r = firstOf(call.arguments, (a) => checkArgument(a, ctx));
        if (r) return `${from.name}.${m}(…) parses ${r}`;
        ctx.scan.used.add(SCHEMA_RULE_KEY);
        return ADMITTED;
      }
      return `${describeImport(from)}.${m}() is not in the closed list`;
    }
  }
  const kind = VALUE_METHODS.get(m);
  if (!kind) return `method "${m}" is not in the closed list`;
  const otherArgs = () => firstOf(call.arguments, (a) => (isFunctionLiteral(unwrap(a)) ? ADMITTED : checkArgument(a, ctx)));
  switch (kind) {
    case "derived":
      return check(recv, ctx, [], false) ?? otherArgs();
    case "elements":
      return check(recv, ctx, path, false) ?? otherArgs();
    case "element":
      return check(recv, ctx, [ANY, ...path], false) ?? otherArgs();
    case "map": {
      const isString = m === "replace" || m === "replaceAll";
      if (isString && path[0] !== undefined) return ADMITTED; // a field of a string: a method or undefined
      const receiver = isString ? check(recv, ctx, [], false) : ADMITTED;
      if (receiver) return receiver;
      const [head, ...rest] = path;
      if (!isString && head === "length") return ADMITTED;
      const elementPath = isString || path.length === 0 ? [] : head === ANY || /^\d+$/.test(head) ? rest : path;
      return firstOf(call.arguments, (a) => {
        const arg = unwrap(a);
        const fn = localFunctionOfCallee(arg, ctx);
        if (!fn) return isString ? checkArgument(a, ctx) : `the callback of ${m}() is not a function the scan can enter`;
        return guarded(ctx, `cb:${nodeKey(fn)}:${elementPath.join(".")}`, () => {
          if (fn.asteriskToken) return `the callback of ${m}() is a generator`;
          const bindings = new Map(ctx.bindings);
          fn.parameters.forEach((p, i) =>
            bindings.set(p, isString ? { kind: "value", of: recv, ctx } : i === 0 ? { kind: "element", of: recv, ctx } : { kind: "value", of: recv, ctx })
          );
          const inner: Ctx = { ...ctx, bindings, id: ++ctx.scan.counter, depth: ctx.depth + 1 };
          const r = firstOf(returnExpressionsOf(fn), (x) => check(x, inner, m === "flatMap" ? [ANY, ...elementPath] : elementPath, false));
          return r ? `the callback of ${m}() returns ${r}` : ADMITTED;
        });
      });
    }
  }
}

// ===========================================================================
// Entry points.
// ===========================================================================

type ScanResult = {
  /** Every value export of the scanned files, in file order: the actions. */
  actions: ExportedAction[];
  findings: ReturnFinding[];
  /** Closed-list keys (closedListKeys) that admitted at least one value. */
  used: ReadonlySet<string>;
  /** The most guarded steps any one action took (to see how far MAX_STEPS is). */
  maxSteps: number;
};

/** Scan the returns of every action of these `"use server"` files (one program for all of them). */
export function scanServerActions(sources: readonly Source[]): ScanResult {
  const scan = createScan(sources);
  const actions: ExportedAction[] = [];
  const findings: ReturnFinding[] = [];
  let maxSteps = 0;
  for (const [path, source] of scan.files) {
    for (const action of exportedActionsOf(path, source)) {
      actions.push(action);
      if (action.opaque || !action.fn) {
        findings.push({ file: path, action: action.name, line: action.line, text: "(export)", reason: action.opaque ?? "opaque export" });
        continue;
      }
      scan.steps = 0;
      const ctx: Ctx = { scan, source, action: action.fn, bindings: new Map(), id: ++scan.counter, depth: 0 };
      for (const expr of returnExpressionsOf(action.fn)) {
        const reason = check(expr, ctx, [], true);
        if (reason) {
          findings.push({ file: path, action: action.name, line: lineOfNode(expr), text: collapse(expr.getText()).slice(0, 120), reason });
        }
      }
      maxSteps = Math.max(maxSteps, scan.steps);
    }
  }
  return { actions, findings, used: scan.used, maxSteps };
}

/**
 * An independent count: the compiler's own export table of each file (value
 * exports only), as `checker.getExportsOfModule` sees it. A different code path
 * from exportedActionsOf — the two must agree, file by file.
 */
export function compilerExportCounts(sources: readonly Source[]): Map<string, number> {
  const scan = createScan(sources);
  const counts = new Map<string, number>();
  for (const [path, source] of scan.files) {
    const moduleSymbol = scan.checker.getSymbolAtLocation(source);
    if (!moduleSymbol) {
      counts.set(path, 0);
      continue;
    }
    let n = 0;
    for (const exp of scan.checker.getExportsOfModule(moduleSymbol)) {
      const target = exp.flags & ts.SymbolFlags.Alias ? scan.checker.getAliasedSymbol(exp) : exp;
      if (target.flags & ts.SymbolFlags.Value) n++;
    }
    counts.set(path, n);
  }
  return counts;
}
