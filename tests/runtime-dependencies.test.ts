import { describe, it, expect } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";

/**
 * Structural guarantee: every npm package the SHIPPED code imports at
 * runtime is listed in package.json `dependencies` — not only in
 * `devDependencies`, and not absent.
 *
 * Why this exists: the Dockerfile builds with every dependency installed,
 * then runs `npm prune --omit=dev` before assembling the runner image. A
 * package that lives only in `devDependencies` is therefore present for
 * `tsc`, `eslint`, vitest and `next build` — every check stays green — and
 * simply absent from the image. Nothing notices until the first request that
 * reaches the `require()`: pdfkit was added as a devDependency for the docs
 * generator (scripts/build-docs-pdf.mjs), lib/reservesReport.ts then
 * imported it from application code, and the réserves PDF export answered
 * 500 in production for six weeks before anyone generated one. `npm ls
 * pdfkit --omit=dev` printed `(empty)` the whole time; nothing ran it.
 *
 * What counts as shipped code is read from the Dockerfile's runner stage,
 * the one table that says what the image contains: everything Next compiles
 * into `.next` (the app tree and every module it reaches), plus the loose
 * files the stage copies verbatim (`next.config.ts`, `prisma.config.ts`, the
 * one operational script). Rather than enumerate the app tree — a list that
 * rots the day a folder is added — the walk starts at the repository root
 * and EXCLUDES, each exclusion carrying its reason. A new top-level folder is
 * thus swept up by default; the failure direction is a false alarm that
 * gets an exclusion with a reason written next to it, never a silent miss.
 *
 * Imports are read from the TypeScript AST, never grepped: a regex fires on
 * a commented-out import and misses `export … from`, `require()` and
 * `import()`. Type-only imports (`import type`, `export type … from`, and a
 * named import whose every specifier is `type`) are exempt — the compiler
 * erases them, so they never reach the image; that exemption is exactly why
 * `@types/*` packages may (and should) stay in devDependencies.
 *
 * The three probes the global rules ask of a structural test are permanent
 * unit tests on `runtimePackagesIn` below (the original form, the
 * neighbouring forms, the neighbouring form that must stay green), and the
 * discovery walk was proven once by planting `import "vitest"` in lib/ and
 * watching this file go red before removing it.
 */

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"] as const;

/**
 * Paths (relative to the repo root, forward slashes) the walk never enters.
 * Every entry names why it is not shipped code; remove the entry the day the
 * reason stops being true.
 */
const EXCLUDED: ReadonlyArray<{ path: string; reason: string }> = [
  { path: "node_modules", reason: "third-party code, not ours to check" },
  { path: ".next", reason: "build output; its inputs are checked instead" },
  { path: ".git", reason: "not source" },
  { path: ".claude", reason: "agents' isolated worktrees live here — other trees, other package.json" },
  { path: "tests", reason: "vitest only; never copied into the image" },
  { path: "tests-integration", reason: "vitest only; never copied into the image" },
  { path: "docs", reason: "documentation sources; never copied into the image" },
  { path: "deploy", reason: "host-side VPS tooling; never copied into the image" },
  { path: "public", reason: "static assets, no modules" },
  { path: "app/generated", reason: "Prisma client, generated at build; its one runtime package (@prisma/client) is pinned by knip.jsonc" },
  { path: "prisma/seed.ts", reason: "runs through `tsx` on a developer machine only (prisma.config.ts: migrations.seed)" },
  { path: "vitest.config.ts", reason: "test tooling; never copied into the image" },
  { path: "vitest.integration.config.ts", reason: "test tooling; never copied into the image" },
  { path: "eslint.config.mjs", reason: "lint tooling; never copied into the image" },
  { path: "postcss.config.mjs", reason: "consumed by `next build` in the builder stage, before the prune" },
  // scripts/ is host-side tooling EXCEPT the files the Dockerfile copies; those
  // are re-included from the Dockerfile itself (see shippedScripts) so this
  // exclusion cannot hide a script that ships.
  { path: "scripts", reason: "host-side tooling (shell, docs generator); the shipped exceptions are read from the Dockerfile" },
];

/** Repo-relative path with forward slashes, so the exclusion table reads the same on every OS. */
function rel(absolute: string): string {
  return relative(ROOT, absolute).split(sep).join("/");
}

function isExcluded(relPath: string): boolean {
  return EXCLUDED.some(({ path }) => relPath === path || relPath.startsWith(path + "/"));
}

/**
 * The scripts the runner stage copies into the image, read from the
 * Dockerfile: `COPY --from=builder /app/scripts/<file> …`. This is the table
 * that defines "shipped script", so the test cannot drift from it.
 */
function shippedScripts(): string[] {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  return [...dockerfile.matchAll(/^COPY --from=builder \/app\/(scripts\/\S+)\s/gm)].map((m) => m[1]);
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

/** Every shipped source file: the repo minus EXCLUDED, plus the scripts the Dockerfile copies. */
function shippedSourceFiles(): string[] {
  const files: string[] = [];
  walk(ROOT, files);
  for (const script of shippedScripts()) {
    const full = join(ROOT, ...script.split("/"));
    if (existsSync(full)) files.push(full);
  }
  return files;
}

const BUILTINS = new Set(builtinModules);

/**
 * The npm package a module specifier resolves to, or null when it is not a
 * package at all: relative paths, the `@/` alias (tsconfig paths → the repo
 * itself), and Node built-ins with or without the `node:` prefix.
 */
export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/")) return null;
  if (specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (BUILTINS.has(name)) return null;
  return name;
}

/** Whether an `import` declaration is fully erased by the compiler (brings no value into the module). */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  // `import "x"` (side effects only) has no clause: it IS a runtime import.
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  // `import { type A, type B } from "x"` — every specifier inline-typed and no
  // default binding: nothing survives compilation either.
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

/**
 * Every npm package `source` pulls in at runtime, in any of the four shapes
 * a module can be loaded: `import … from`, `export … from`, `import()` and
 * `require()`. Type-only forms are skipped (see the module doc).
 */
export function runtimePackagesIn(source: ts.SourceFile): Set<string> {
  const packages = new Set<string>();
  const add = (specifier: string) => {
    const name = packageNameOf(specifier);
    if (name) packages.add(name);
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!isTypeOnlyImport(n)) add(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) add(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const [arg] = n.arguments;
      const isDynamicImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteral(arg)) add(arg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return packages;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

describe("runtime dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
  const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
  const devDependencies = new Set(Object.keys(pkg.devDependencies ?? {}));

  it("reads at least one shipped script from the Dockerfile (the table this test discovers scripts from)", () => {
    // If the Dockerfile stops copying any script this assertion is what goes
    // red — so the scripts exclusion above cannot silently become total.
    expect(shippedScripts()).toContain("scripts/retype-existing-guarded-assets.mjs");
  });

  it("every package imported by shipped code is in `dependencies`", () => {
    const usedBy = new Map<string, string[]>();
    for (const file of shippedSourceFiles()) {
      const relPath = rel(file);
      for (const name of runtimePackagesIn(parse(relPath, readFileSync(file, "utf8")))) {
        if (!usedBy.has(name)) usedBy.set(name, []);
        usedBy.get(name)!.push(relPath);
      }
    }
    // Sanity: the walk actually found the app. A misplaced exclusion that
    // swallowed everything would otherwise pass vacuously.
    expect([...usedBy.keys()]).toContain("next");
    expect([...usedBy.keys()]).toContain("react");

    const offenders = [...usedBy]
      .filter(([name]) => !dependencies.has(name))
      .map(([name, files]) => {
        const where = devDependencies.has(name) ? "only in devDependencies" : "not in package.json at all";
        return `${name} (${where}) — imported by ${files.sort().join(", ")}`;
      });
    expect(offenders, `pruned from the production image by \`npm prune --omit=dev\`:\n${offenders.join("\n")}`).toEqual([]);
  });

  // The three probes, kept as permanent tests rather than run once by hand:
  // the shape that bit (a value import), the neighbouring shapes the first
  // version of a detector tends to miss, and the neighbouring shape that must
  // NOT fire — without that last one this would ban a syntax, not close a hole.
  describe("runtimePackagesIn", () => {
    it("catches the original form: a value import from a package", () => {
      expect(runtimePackagesIn(parse("probe.ts", `import PDFDocument from "pdfkit";`))).toEqual(new Set(["pdfkit"]));
    });

    it("catches the neighbouring forms: side-effect import, re-export, dynamic import, require", () => {
      const forms = [
        `import "pdfkit";`,
        `export { default } from "pdfkit";`,
        `export * from "pdfkit";`,
        `const load = () => import("pdfkit");`,
        `const PDFDocument = require("pdfkit");`,
        `import x from "pdfkit/js/data";`, // deep import still belongs to the package
        `import { a } from "@scope/pkg/sub";`,
      ];
      for (const form of forms) {
        expect(runtimePackagesIn(parse("probe.ts", form)), form).toEqual(
          new Set([form.includes("@scope") ? "@scope/pkg" : "pdfkit"])
        );
      }
    });

    it("stays green on what the compiler erases or the runtime provides itself", () => {
      const silent = [
        `import type PDFDocument from "pdfkit";`,
        `import { type A, type B } from "pdfkit";`,
        `export type { A } from "pdfkit";`,
        `import { readFileSync } from "node:fs";`,
        `import { join } from "path";`,
        `import { thing } from "@/lib/thing";`,
        `import { other } from "./other";`,
        `// import { ghost } from "pdfkit";`,
      ];
      for (const form of silent) {
        expect(runtimePackagesIn(parse("probe.ts", form)), form).toEqual(new Set());
      }
      // …but one value specifier among typed ones is a runtime import again.
      expect(runtimePackagesIn(parse("probe.ts", `import { type A, b } from "pdfkit";`))).toEqual(new Set(["pdfkit"]));
    });
  });
});
