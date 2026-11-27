import { describe, it, expect } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";
import { FOREIGN_TREE_DIRS } from "./helpers/astScan";

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
 * reason stops being true. Root-relative, so `node_modules` and `.claude` are
 * NOT here: they are skipped at any depth by name (FOREIGN_TREE_DIRS in
 * helpers/astScan.ts, with the reason), since a root-only entry let
 * `actions/.claude/worktrees/<copy>/` — another tree, another package.json —
 * through.
 */
const EXCLUDED: ReadonlyArray<{ path: string; reason: string }> = [
  { path: ".next", reason: "build output; its inputs are checked instead" },
  { path: ".git", reason: "not source" },
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
function shippedScriptsIn(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/^COPY --from=builder \/app\/(scripts\/\S+)\s/gm)].map((m) => m[1]);
}

function shippedScripts(): string[] {
  return shippedScriptsIn(readFileSync(join(ROOT, "Dockerfile"), "utf8"));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const relPath = rel(full);
    if (FOREIGN_TREE_DIRS.has(name) || isExcluded(relPath)) continue;
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
  return scanModuleLoads(source).packages;
}

/** `createRequire(...)`, also as `module.createRequire(...)`. */
function isCreateRequireCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  const callee = n.expression;
  return (ts.isIdentifier(callee) && callee.text === "createRequire") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "createRequire");
}

/**
 * Every module load of `source`, FAILING CLOSED: the packages it names, and the loads whose
 * target cannot be read from the source. A load is `import()`, `require()`, `module.require()`
 * and a call of whatever `createRequire(...)` returned (bound to a name or called at once).
 * Its argument must be a string literal; anything else (a variable, a template, a
 * concatenation, a missing argument) is `unresolvable` — a scanner that cannot say what is
 * loaded must be red, not green.
 */
export function scanModuleLoads(source: ts.SourceFile): { packages: Set<string>; unresolvable: string[] } {
  const packages = new Set<string>();
  const unresolvable: string[] = [];
  const add = (specifier: string) => {
    const name = packageNameOf(specifier);
    if (name) packages.add(name);
  };
  // Names bound to a require function made by createRequire.
  const loaders = new Set<string>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isCreateRequireCall(n.initializer)) {
      loaders.add(n.name.text);
    }
    ts.forEachChild(n, collect);
  };
  collect(source);
  const isLoaderCall = (call: ts.CallExpression): boolean => {
    const callee = call.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(callee)) return callee.text === "require" || loaders.has(callee.text);
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text === "require" && ts.isIdentifier(callee.expression) && callee.expression.text === "module";
    return isCreateRequireCall(callee);
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!isTypeOnlyImport(n)) add(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) add(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && isLoaderCall(n)) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteral(arg)) add(arg.text);
      else unresolvable.push(n.getText(source));
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return { packages, unresolvable };
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
    // The image decoder is shipped too, and this is what makes its imports (sharp) scanned.
    expect(shippedScripts()).toContain("scripts/image-decode-child.mjs");
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

  // sharp is imported by ONE shipped file: the decode child (scripts/image-decode-child.mjs),
  // which the server forks and kills at a deadline. A second importer would decode inside the
  // server process, outside the deadline, the queue, the pixel ceiling and the budget; the
  // server itself importing sharp is the case that matters most (a native decode that no JS
  // timeout can interrupt would run in the process that serves everyone). Same discovery as
  // above: every shipped file, all four import shapes, the shipped scripts read from the Dockerfile.
  it("sharp is imported by scripts/image-decode-child.mjs alone among shipped files", () => {
    const importers = shippedSourceFiles()
      .map(rel)
      .filter((relPath) => runtimePackagesIn(parse(relPath, readFileSync(join(ROOT, ...relPath.split("/")), "utf8"))).has("sharp"));
    expect(importers).toEqual(["scripts/image-decode-child.mjs"]);
  });

  // Fail closed: a load whose target cannot be read from the source (a variable, a template,
  // createRequire, module.require) could load sharp without this file ever saying so. Any
  // shipped file doing that is red, not skipped.
  it("no shipped file loads a module through an argument that is not a string literal", () => {
    const offenders = shippedSourceFiles()
      .map(rel)
      .flatMap((relPath) =>
        scanModuleLoads(parse(relPath, readFileSync(join(ROOT, ...relPath.split("/")), "utf8"))).unresolvable.map((call) => `${relPath}: ${call}`),
      );
    expect(offenders).toEqual([]);
  });

  describe("the scanner fails closed (probes)", () => {
    const unresolvableIn = (text: string): string[] => scanModuleLoads(parse("probe.mts", text)).unresolvable;

    it("the original form: require / import() of a variable is red", () => {
      expect(unresolvableIn("const name = 'sharp'; require(name);")).toHaveLength(1);
      expect(unresolvableIn("const name = 'sharp'; await import(name);")).toHaveLength(1);
    });

    it("the neighbouring forms are red too: template, concatenation, createRequire, module.require", () => {
      for (const form of [
        "require(`sharp`);",
        "await import(`sha${'rp'}`);",
        "require('sha' + 'rp');",
        "import { createRequire } from 'node:module'; const r = createRequire(import.meta.url); r(name);",
        "import { createRequire } from 'node:module'; createRequire(import.meta.url)(name);",
        "module.require(name);",
        "import()",
      ]) {
        expect(unresolvableIn(form), form).toHaveLength(1);
      }
    });

    it("the neighbouring form that is legitimate stays green, and a literal through createRequire is still seen as an import", () => {
      for (const form of [
        "require('node:fs'); await import('node:path'); module.exports = {};",
        "// require(name)\nconst text = 'import(name)';",
        "import { createRequire } from 'node:module'; const r = createRequire(import.meta.url); r('sharp');",
        "const other = (x) => x; other(name);",
      ]) {
        expect(unresolvableIn(form), form).toEqual([]);
      }
      const viaCreateRequire = "import { createRequire } from 'node:module'; createRequire(import.meta.url)('sharp'); module.require('pdfkit');";
      expect(scanModuleLoads(parse("probe.mts", viaCreateRequire)).packages).toEqual(new Set(["sharp", "pdfkit"]));
    });
  });

  // The probes of that test: the form that bit, its neighbours, and the form that must stay green.
  describe("the confinement of sharp (probes)", () => {
    const importersOf = (files: Record<string, string>): string[] =>
      Object.entries(files)
        .filter(([path, text]) => runtimePackagesIn(parse(path, text)).has("sharp"))
        .map(([path]) => path);

    it("the original form: a lib module importing sharp is caught", () => {
      expect(importersOf({ "lib/other.ts": `import sharp from "sharp";` })).toEqual(["lib/other.ts"]);
    });

    it("the neighbouring forms: require, dynamic import, re-export, side-effect import", () => {
      for (const form of [
        `const sharp = require("sharp");`,
        `const load = () => import("sharp");`,
        `export { default } from "sharp";`,
        `import "sharp";`,
      ]) {
        expect(importersOf({ "lib/imageMetadata.ts": form }), form).toEqual(["lib/imageMetadata.ts"]);
      }
    });

    it("stays green on what the compiler erases and on a mention in a comment", () => {
      expect(
        importersOf({
          "lib/a.ts": `import type { Sharp } from "sharp";`,
          "lib/b.ts": `// import sharp from "sharp";`,
          "lib/c.ts": `import { fork } from "node:child_process";`,
        }),
      ).toEqual([]);
    });

    it("the discovery: a Dockerfile that stops copying the child leaves it unscanned (so the test above goes red)", () => {
      const withCopy = "COPY --from=builder /app/scripts/image-decode-child.mjs ./scripts/image-decode-child.mjs\n";
      expect(shippedScriptsIn(withCopy)).toEqual(["scripts/image-decode-child.mjs"]);
      expect(shippedScriptsIn("FROM node\n")).toEqual([]);
    });
  });
});
