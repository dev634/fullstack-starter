import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { parseSource } from "./helpers/astScan";

/**
 * Structural guarantee: nothing that ends up as a nonce-authorized `<style>`
 * element's CSS text interpolates a colour this scan cannot trace back to a
 * call to `safeHex()` from `@/lib/color` — whichever of the two JSX shapes
 * put it there.
 *
 * Why this matters (docs/CONVENTIONS.md, "Couleurs dynamiques et CSP"):
 * proxy.ts's CSP has no `unsafe-inline` for style-src. A nonce authorizes a
 * `<style>` ELEMENT, never a `style=""` ATTRIBUTE, so every colour that comes
 * from the database (app settings, per-project réserve status colours) is
 * written into the text of a nonce-authorized `<style>` and interpreted as
 * real CSS. Zod validates those colours on write, and there is a database
 * CHECK too, but a value edited straight in the database bypasses both — at
 * that point `safeHex()`, called again right before interpolation, is the
 * ONLY thing standing between whatever is in the row and this injection sink.
 * Neither Zod nor the CHECK is visible from here, so this test cannot see
 * them either — it exists purely to keep `safeHex()` itself from quietly
 * disappearing from a call site.
 *
 * `<style>` can receive its text two ways, and React treats both the same —
 * DOM text nodes inside the `<style>` element, which the browser concatenates
 * and parses as one CSS blob no matter which JSX shape produced them:
 *
 *   - `dangerouslySetInnerHTML={{ __html: <expr> }}`, what both of today's
 *     real call sites use;
 *   - one or more JSX children: `<style>{cssExpr}</style>`, or several
 *     expressions in a row (`<style>{a}{b}{c}</style>`) — arguably the more
 *     natural way to write a new one, and exactly the gap an adversarial
 *     check on this file found: a probe using this shape instead of
 *     `dangerouslySetInnerHTML` passed a first version of this test that only
 *     looked at the attribute. Both shapes are walked identically below.
 *
 * Two known call sites exist today, app/layout.tsx and
 * components/ReserveStatusStyleVars.tsx, but this test does not hard-code
 * either of them: it walks the whole repository for any `<style>` element
 * with either shape, so a third site added later without the guard fails
 * here on its own. `git grep dangerouslySetInnerHTML` would find two sites
 * today, but a regex like that would also trip on this very file's comments —
 * the two existing call sites mention `--primary` and a bare `style=""`
 * attribute by name, and this docstring now mentions the attribute name
 * itself — and it would miss the children shape entirely, which is exactly
 * why this walks the real TypeScript AST instead.
 *
 * A `safeHex` call only counts once its IMPORT is resolved back to
 * `@/lib/color` — an aliased import (`import { safeHex as sh } from
 * "@/lib/color"`) still counts, and a same-named function redeclared locally
 * in the file (shadowing the real one, or simply never importing it) does
 * not. Matching on the bare identifier "safeHex" would get both of those
 * backwards.
 *
 * Every interpolated slot must be provably derived from such a call — a
 * bare identifier, property access, or anything else this scan cannot follow
 * back to one is refused, not silently accepted. `contrastTextColor(x)` is
 * accepted specifically because `x` itself resolves to a `safeHex(...)` call
 * in the same file: the check follows one level of local variable
 * assignment, but a value that cannot be resolved at all (a function
 * parameter, a prop, an import from elsewhere) fails closed rather than
 * passing for lack of evidence. The same recursion also refuses `String(x)`
 * and `a + b` concatenation built from an unguarded value — neither gets
 * special-cased, they fall out of the existing call/binary-expression
 * handling below.
 */

const ROOT = process.cwd();

/**
 * Directories a repo-wide scan must not descend into: dependencies, VCS/build
 * metadata, and generated code that never contains JSX (`app/generated` is
 * Prisma's generated client).
 */
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".github",
  ".vercel",
  ".turbo",
  "coverage",
  "dist",
  "build",
  "out",
  "generated",
]);

function walkSourceFiles(dir: string, extensions: readonly string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || IGNORED_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSourceFiles(full, extensions, out);
    else if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
  }
  return out;
}

type HtmlSite = { line: number; expr: ts.Expression };

function propNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function isStyleTagName(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && tagName.text === "style";
}

/** Every `__html: <expr>` inside a `dangerouslySetInnerHTML={{ ... }}` attribute of `opening`. */
function collectDangerouslySetInnerHtmlSites(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  push: (positionNode: ts.Node, expr: ts.Expression) => void
): void {
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    if (attr.name.text !== "dangerouslySetInnerHTML") continue;
    const init = attr.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) continue;
    if (!ts.isObjectLiteralExpression(init.expression)) continue;
    for (const prop of init.expression.properties) {
      if (ts.isPropertyAssignment(prop) && propNameText(prop.name) === "__html") {
        push(prop, prop.initializer);
      } else if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "__html") {
        push(prop, prop.name);
      }
    }
  }
}

/**
 * Every place a `<style>` element's actual CSS text comes from, in `source`:
 * a `dangerouslySetInnerHTML={{ __html: <expr> }}` attribute, or one or more
 * JSX-expression children (`<style>{a}{b}</style>`). Plain `JsxText` children
 * (a literal CSS string with no `{…}` at all) are fixed in source and are not
 * collected — there is nothing dynamic in them to trace.
 */
function findStyleContentSites(source: ts.SourceFile): HtmlSite[] {
  const sites: HtmlSite[] = [];
  const push = (positionNode: ts.Node, expr: ts.Expression) => {
    const { line } = source.getLineAndCharacterOfPosition(positionNode.getStart(source));
    sites.push({ line: line + 1, expr });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && isStyleTagName(node.tagName)) {
      collectDangerouslySetInnerHtmlSites(node, push);
      // Self-closing: `<style ... />` can never have JSX children.
    } else if (ts.isJsxElement(node) && isStyleTagName(node.openingElement.tagName)) {
      collectDangerouslySetInnerHtmlSites(node.openingElement, push);
      for (const child of node.children) {
        if (ts.isJsxExpression(child) && child.expression) push(child, child.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/**
 * Every `const x = <expr>` (any scope, keyed by name only) in `source`. Same
 * name-based trade-off tests/helpers/astScan.ts's `guardedNames` documents
 * for resolving a local helper by name rather than real lexical scope — fine
 * here for the same reason: it only needs to follow the handful of one-hop
 * local aliases (`primaryColor`, `openColor`...) real call sites use, and a
 * name that isn't found at all fails closed anyway.
 */
function collectVariableInitializers(source: ts.SourceFile): Map<string, ts.Expression> {
  const map = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      map.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return map;
}

const COLOR_LIB_FILE = resolve(ROOT, "lib", "color.ts").toLowerCase();

/** Whether import specifier `spec`, written in file `fromRelFile`, resolves to lib/color.ts. */
function resolvesToColorLib(spec: string, fromRelFile: string): boolean {
  let base: string | undefined;
  if (spec.startsWith("@/")) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromRelFile), spec);
  if (!base) return false; // a bare package specifier is never this local module
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
  return candidates.some((c) => c.toLowerCase() === COLOR_LIB_FILE);
}

type ColorLibBindings = {
  /** Local names bound to the named export `safeHex`, aliased or not. */
  safeHexNames: Set<string>;
  /** Local names bound to `import * as x from "@/lib/color"` — `x.safeHex(...)` counts too. */
  namespaceNames: Set<string>;
};

function collectColorLibBindings(source: ts.SourceFile, relFile: string): ColorLibBindings {
  const safeHexNames = new Set<string>();
  const namespaceNames = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!resolvesToColorLib(stmt.moduleSpecifier.text, relFile)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if ((el.propertyName ?? el.name).text === "safeHex") safeHexNames.add(el.name.text);
      }
    } else if (ts.isNamespaceImport(bindings)) {
      namespaceNames.add(bindings.name.text);
    }
  }
  return { safeHexNames, namespaceNames };
}

/**
 * Whether `expr` is provably derived from a call to the real, imported
 * `safeHex()` — the only thing this test treats as re-validated right before
 * hitting the injection sink. Deliberately fails closed: anything this walk
 * cannot reduce to a literal, a safeHex call, or a combination of the two
 * counts as unsafe, rather than being accepted for lack of evidence.
 */
function isSafeValue(
  expr: ts.Expression,
  varMap: ReadonlyMap<string, ts.Expression>,
  bindings: ColorLibBindings,
  seen: ReadonlySet<string> = new Set()
): boolean {
  if (ts.isParenthesizedExpression(expr)) return isSafeValue(expr.expression, varMap, bindings, seen);

  // Fixed in source code — a literal, or a no-substitution template — carries
  // no external input at all: there is nothing here an attacker could shape.
  if (ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr)) return true;

  // Template/concatenation glue is safe in itself; every dynamic slot inside
  // still needs its own proof.
  if (ts.isTemplateExpression(expr)) {
    return expr.templateSpans.every((span) => isSafeValue(span.expression, varMap, bindings, seen));
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isSafeValue(expr.left, varMap, bindings, seen) && isSafeValue(expr.right, varMap, bindings, seen);
  }

  // An identifier is only as safe as whatever it was assigned to in this same
  // file. A function parameter, a prop, or a name imported from elsewhere has
  // no local declaration to follow here, so it is refused rather than assumed
  // safe.
  if (ts.isIdentifier(expr)) {
    if (seen.has(expr.text)) return false; // cyclic alias, cannot resolve further
    const init = varMap.get(expr.text);
    if (!init) return false;
    return isSafeValue(init, varMap, bindings, new Set(seen).add(expr.text));
  }

  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee) && bindings.safeHexNames.has(callee.text)) return true;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      bindings.namespaceNames.has(callee.expression.text) &&
      callee.name.text === "safeHex"
    ) {
      return true;
    }
    // Not safeHex itself: only as safe as what it was built from —
    // contrastTextColor(openColor) is accepted because openColor itself
    // resolves to a safeHex(...) call in the same file. A call with no
    // arguments cannot be derived from anything and is refused outright.
    return expr.arguments.length > 0 && expr.arguments.every((arg) => isSafeValue(arg, varMap, bindings, seen));
  }

  // A bare property/element access, a ternary, a global, or anything else —
  // exactly the shape `settings.primaryColor` interpolated raw would take the
  // moment safeHex() is dropped from a call site. Fail closed.
  return false;
}

type StyleSite = { key: string; safe: boolean };

function collectStyleSites(): StyleSite[] {
  const sites: StyleSite[] = [];
  for (const file of walkSourceFiles(ROOT, [".ts", ".tsx"])) {
    const rel = relative(ROOT, file).split(sep).join("/");
    const source = parseSource(rel, file);
    const htmlSites = findStyleContentSites(source);
    if (htmlSites.length === 0) continue;
    const varMap = collectVariableInitializers(source);
    const bindings = collectColorLibBindings(source, rel);
    for (const site of htmlSites) {
      sites.push({ key: `${rel}:${site.line}`, safe: isSafeValue(site.expr, varMap, bindings) });
    }
  }
  return sites;
}

describe("nonce-authorized <style> elements only interpolate a colour provably re-validated by safeHex", () => {
  const sites = collectStyleSites();

  it("finds <style> elements with content, via dangerouslySetInnerHTML or JSX children (guards against a silently empty scan)", () => {
    // Not a hard-coded count of known files — just proof the walk isn't
    // vacuously empty (e.g. because IGNORED_DIR_NAMES swallowed everything).
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });

  it("requires every value interpolated there to be traceable to a safeHex(...) call imported from @/lib/color", () => {
    const unsafe = sites.filter((s) => !s.safe).map((s) => s.key);

    expect(
      unsafe,
      unsafe.length
        ? `These <style> elements (via dangerouslySetInnerHTML or a JSX child) interpolate a ` +
          `value this scan cannot trace back to a call to safeHex() imported from @/lib/color:\n` +
          unsafe.map((k) => `  - ${k}`).join("\n") +
          `\n\nThis app's CSP has no 'unsafe-inline' for style-src: whatever text lands inside a ` +
          `nonce-authorized <style> element is executed as real CSS. safeHex() is the only ` +
          `re-validation standing between a value read back from the database and that sink — ` +
          `wrap the raw value in safeHex(value, fallback) before interpolating it, the same way ` +
          `app/layout.tsx and components/ReserveStatusStyleVars.tsx already do.`
        : undefined
    ).toEqual([]);
  });
});
