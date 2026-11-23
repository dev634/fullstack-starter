import ts from "typescript";

/**
 * Scans a repository source for the forms that fold "absent" into a value in the
 * `data` of an UPDATE write (lot 5b — tests/repository-partial-write.test.ts).
 *
 * The domain is the write side of an update: `prisma.<model>.update / updateMany`
 * (and `tx.<model>.…` inside a `$transaction`), and the `update` branch of an
 * `upsert`. A `create` — or the `create` branch of an `upsert` — is OUT of the
 * domain: on a create, "not provided" legitimately becomes NULL or a default.
 *
 * Flagged, anywhere inside the written value (not only at its root):
 *   X ?? <literal>      X || <literal>      X ? … : null
 * and the same forms reached through a local `const` — `const t = d.x ?? null`
 * then `{ t }` or `{ t: t }` or `data: { ...(c ? { t } : {}) }` — because a
 * test that only read the object literal was one refactoring away from
 * certifying nothing. A fold onto a NON-literal (`data.x ?? current.x`) is the
 * documented way to fall back on the current value and is not flagged.
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

const WRITE_METHODS = new Set(["update", "updateMany", "upsert"]);
const KNOWN_ROOTS = new Set(["prisma", "tx"]);

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

/** The nearest `const <name> = …` declared in an enclosing block / function body / file. */
function resolveConst(from: ts.Node, name: string): ts.Expression | null {
  for (let cur: ts.Node | undefined = from.parent; cur; cur = cur.parent) {
    const statements = ts.isBlock(cur) || ts.isSourceFile(cur) || ts.isModuleBlock(cur) ? cur.statements : undefined;
    if (!statements) continue;
    for (const st of statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return d.initializer;
      }
    }
  }
  return null;
}

function lineOf(node: ts.Node): number {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function describe(node: ts.Node): string {
  return node.getText(node.getSourceFile()).replace(/\s+/g, " ").slice(0, 100);
}

/** Every folding node inside `root` (descendants included), without following identifiers. */
function foldsIn(root: ts.Node, out: Finding[]): void {
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.QuestionQuestionToken && isLiteralValue(n.right)) {
        out.push({ line: lineOf(n), kind: "?? <literal>", text: describe(n) });
      } else if (op === ts.SyntaxKind.BarBarToken && isLiteralValue(n.right)) {
        out.push({ line: lineOf(n), kind: "|| <literal>", text: describe(n) });
      }
    }
    if (ts.isConditionalExpression(n) && isNullLiteral(n.whenFalse)) {
      out.push({ line: lineOf(n), kind: "? … : null", text: describe(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
}

/**
 * Analyse the value written to ONE column (or one whole `data` expression):
 * folds inside it, then — when it is a bare identifier — the `const` it names.
 */
function checkValue(expr: ts.Expression, out: Finding[], seen: Set<ts.Node>): void {
  const x = unwrap(expr);
  if (seen.has(x)) return;
  seen.add(x);
  if (ts.isObjectLiteralExpression(x)) return checkData(x, out, seen);
  foldsIn(x, out);
  if (ts.isIdentifier(x)) {
    const init = resolveConst(x, x.text);
    if (init) checkValue(init, out, seen);
  }
}

/** Analyse an object literal used as (part of) a `data` payload. */
function checkData(obj: ts.ObjectLiteralExpression, out: Finding[], seen: Set<ts.Node>): void {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      checkValue(p.initializer, out, seen);
    } else if (ts.isShorthandPropertyAssignment(p)) {
      const init = resolveConst(p.name, p.name.text);
      if (init) checkValue(init, out, seen);
    } else if (ts.isSpreadAssignment(p)) {
      const s = unwrap(p.expression);
      if (ts.isConditionalExpression(s)) {
        // `...(x !== undefined ? { x } : {})` — the branches are data payloads too.
        for (const branch of [s.whenTrue, s.whenFalse]) {
          const b = unwrap(branch);
          if (ts.isObjectLiteralExpression(b)) checkData(b, out, seen);
        }
      } else if (ts.isObjectLiteralExpression(s)) {
        checkData(s, out, seen);
      } else if (ts.isIdentifier(s)) {
        const init = resolveConst(s, s.text);
        if (init) checkValue(init, out, seen);
      }
    }
  }
}

export function scanWrites(source: string, fileName = "repository/x.ts"): WriteScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const scan: WriteScan = { calls: 0, functions: [], unknownRoot: [], findings: [] };
  const functions = new Set<string>();

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
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && WRITE_METHODS.has(n.expression.name.text)) {
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
          const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined;
          if (!arg || !ts.isObjectLiteralExpression(arg)) {
            scan.findings.push({ line: lineOf(n), kind: "opaque write argument", text: describe(n) });
          } else {
            // update/updateMany write `data`; an upsert's update branch is `update`.
            const key = method === "upsert" ? "update" : "data";
            for (const p of arg.properties) {
              if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key) {
                checkValue(p.initializer, scan.findings, new Set());
              } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) {
                const init = resolveConst(p.name, key);
                if (init) checkValue(init, scan.findings, new Set());
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
