import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Structural guarantee: every `Prisma.raw(...)` call in application code
 * takes a STRING LITERAL, never a variable, a parameter, a template with a
 * substitution, or a concatenation — and `$queryRawUnsafe`/`$executeRawUnsafe`
 * are banned outright.
 *
 * Why this exists: `Prisma.raw` splices its argument into a SQL query
 * UNINTERPRETED (no parameterization, no escaping). The one call site in this
 * codebase (repository/tasks.ts::ASSIGNEE_COLUMN) is safe only because its
 * argument is always one of three fixed strings, hardcoded there — never a
 * value read from a request, a database row, or built from either — matching
 * the "closed literal table" bar that call site's own comment documents (see
 * docs/CONVENTIONS.md's "SQL brut (Prisma.raw)" section). Nothing enforced
 * that bar before this test: a second `Prisma.raw` call fed a column name
 * derived from a request parameter would compile, pass every other check, and
 * open a SQL-injection path through an identifier position `$queryRaw`'s own
 * tagged-template parameterization cannot reach (bind parameters only ever
 * substitute VALUES, never identifiers).
 *
 * `$queryRaw`/`$executeRaw` (the tagged-template, parameterized forms used
 * throughout repository/tasks.ts and repository/projectMaterials.ts) are
 * deliberately OUT of scope — this bans the *Unsafe siblings specifically,
 * plus `Prisma.raw`'s own argument shape.
 *
 * This bans the SHAPE, not a name (same move as
 * tests/schema-control-char.test.ts for CONTROL_CHAR): matched on the
 * property name alone (`.raw`, `.$queryRawUnsafe`, `.$executeRawUnsafe`)
 * regardless of the receiver's identifier, so an aliased import of `Prisma`
 * cannot dodge it. Parsed via the TypeScript AST, never grepped — a regex on
 * "Prisma.raw" would miss a destructured/aliased call and fire on a comment
 * that merely mentions it.
 *
 * Domain discovered by walking the repository from its root, EXCLUDING each
 * non-application directory with its reason written next to it (same "walk
 * everything, subtract with a reason" move as
 * tests/runtime-dependencies.test.ts, reused here rather than re-derived) —
 * so a new file under, say, `service/` or a new top-level module is swept up
 * by default instead of needing this test updated to see it.
 */

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/** Directories/files the walk never enters, each with why it isn't application code. */
const EXCLUDED: ReadonlyArray<{ path: string; reason: string }> = [
  { path: "node_modules", reason: "third-party code, not ours to check" },
  { path: ".next", reason: "build output; its inputs are checked instead" },
  { path: ".git", reason: "not source" },
  { path: ".claude", reason: "agents' isolated worktrees live here — other trees, other code" },
  { path: "tests", reason: "vitest only, including this file itself — its planted probe sources are not application code" },
  { path: "tests-integration", reason: "vitest only; already proven to use only the safe $queryRaw tagged-template form" },
  { path: "docs", reason: "documentation sources" },
  { path: "deploy", reason: "host-side VPS tooling" },
  { path: "public", reason: "static assets, no modules" },
  { path: "app/generated", reason: "Prisma client, generated at build — vendor code, not ours to check" },
  { path: "scripts", reason: "host-side tooling, never part of the running application" },
];

/** Repo-relative path with forward slashes, so the exclusion table reads the same on every OS. */
function rel(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join("/");
}

function isExcluded(relPath: string): boolean {
  return EXCLUDED.some(({ path }) => relPath === path || relPath.startsWith(path + "/"));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const relPath = rel(full);
    if (isExcluded(relPath)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))) out.push(full);
  }
}

/** Every application source file: the repo root minus EXCLUDED. */
function applicationSourceFiles(): { rel: string; abs: string }[] {
  const files: string[] = [];
  walk(ROOT, files);
  return files.map((abs) => ({ rel: rel(abs), abs }));
}

function parse(relPath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true);
}

const UNSAFE_RAW_NAMES = new Set(["$queryRawUnsafe", "$executeRawUnsafe"]);

export type RawFinding = { line: number; snippet: string };

/**
 * Every violation inside `source`: a `.raw(...)` call whose first argument is
 * not a plain string literal (StringLiteral or a no-substitution template —
 * `\`literal\`` with no `${...}` — both fixed at compile time; a
 * TemplateExpression WITH a substitution is refused, same as any other
 * non-literal), or missing entirely; plus every call to `.$queryRawUnsafe`/
 * `.$executeRawUnsafe`, banned regardless of its arguments.
 */
export function prismaRawViolationsIn(source: ts.SourceFile): RawFinding[] {
  const findings: RawFinding[] = [];
  const lineOf = (n: ts.Node) => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      if (name === "raw") {
        // ts.isStringLiteralLike covers StringLiteral and NoSubstitutionTemplateLiteral
        // (both fixed at compile time) — a TemplateExpression (has a `${...}`) already
        // fails it, same as an Identifier, a BinaryExpression (`a + b`), or no argument.
        const [arg] = n.arguments;
        if (!arg || !ts.isStringLiteralLike(arg)) {
          findings.push({ line: lineOf(n), snippet: n.getText(source).slice(0, 120) });
        }
      } else if (UNSAFE_RAW_NAMES.has(name)) {
        findings.push({ line: lineOf(n), snippet: n.getText(source).slice(0, 120) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return findings;
}

describe("Prisma.raw only ever splices a literal string; $queryRawUnsafe/$executeRawUnsafe are banned", () => {
  it("finds application source files (guards against a silently empty scan)", () => {
    expect(applicationSourceFiles().length).toBeGreaterThan(50);
  });

  it("every .raw(...) call site takes a string literal, and no $queryRawUnsafe/$executeRawUnsafe call exists", () => {
    const offenders: string[] = [];
    for (const { rel: relPath, abs } of applicationSourceFiles()) {
      const source = parse(relPath, readFileSync(abs, "utf8"));
      for (const finding of prismaRawViolationsIn(source)) {
        offenders.push(`${relPath}:${finding.line}: ${finding.snippet}`);
      }
    }
    expect(
      offenders,
      offenders.length
        ? `These calls splice something other than a fixed string literal into raw SQL, or call the *Unsafe raw variants:\n` +
          offenders.map((o) => `  - ${o}`).join("\n") +
          `\n\nPrisma.raw's argument must be a hardcoded string literal from a closed, ` +
          `in-source table (see repository/tasks.ts::ASSIGNEE_COLUMN and docs/CONVENTIONS.md's ` +
          `"SQL brut (Prisma.raw)" section) — never a variable, a request/DB value, or a ` +
          `template with a substitution. $queryRawUnsafe/$executeRawUnsafe are never allowed; ` +
          `use the parameterized $queryRaw/$executeRaw tagged-template form instead.`
        : undefined
    ).toEqual([]);
  });

  describe("probes — the scan is proven on planted sources, not assumed", () => {
    it("catches the original form: Prisma.raw(<a variable>)", () => {
      const probe = parse("probe.ts", `const col = pick(); Prisma.raw(col);`);
      expect(prismaRawViolationsIn(probe)).toHaveLength(1);
    });

    it("catches the neighbouring forms: a substituted template, and $queryRawUnsafe/$executeRawUnsafe", () => {
      const forms = [
        "Prisma.raw(`\"${col}\"`);",
        "prisma.$queryRawUnsafe(sql);",
        "tx.$executeRawUnsafe(sql, value);",
        "Prisma.raw(a + b);",
        "Prisma.raw();",
      ];
      for (const form of forms) {
        expect(prismaRawViolationsIn(parse("probe.ts", form)), form).not.toHaveLength(0);
      }
    });

    it("stays green on the correct form: a plain string literal, and on unrelated .raw()/$queryRaw calls", () => {
      expect(prismaRawViolationsIn(parse("probe.ts", `Prisma.raw('"assignedWorkerId"');`))).toEqual([]);
      // A no-substitution template literal is just as fixed at compile time.
      expect(prismaRawViolationsIn(parse("probe.ts", "Prisma.raw(`\"assignedWorkerId\"`);"))).toEqual([]);
      for (const form of [
        "await prisma.$queryRaw`SELECT 1`;",
        "await prisma.$executeRaw`UPDATE x SET y = ${value}`;",
        "someOtherLib.raw('literal is fine too');",
        "// Prisma.raw(col) — only a comment, not a call",
      ]) {
        expect(prismaRawViolationsIn(parse("probe.ts", form)), form).toEqual([]);
      }
    });
  });
});
