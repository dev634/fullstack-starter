import ts from "typescript";

/**
 * Parses TSX source and lists every JSX element whose LITERAL className holds a
 * `fixed` utility (also behind a variant: `sm:fixed`) — the overlays, banners
 * and hosts that paint over the page. "Literal" means every string fragment of
 * the attribute: a plain string, a `{"…"}` expression, the text parts of a
 * template literal, both arms of a ternary, the operands of `||` / `??`.
 * A className built from an identifier or a call is NOT resolved (limit: such
 * a class would not be seen; none of the current overlays is written that way).
 */
export type FixedElement = {
  /** Value of the `id` attribute when it is a string literal or an identifier (its name), else null. */
  id: string | null;
  tokens: string[];
  /** Highest numeric `z-…` utility without variant, or null when none is written. */
  z: number | null;
};

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function fragments(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteralLike(node)) out.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    out.push(node.head.text);
    for (const span of node.templateSpans) {
      fragments(span.expression, out);
      out.push(span.literal.text);
    }
  } else ts.forEachChild(node, (c) => fragments(c, out));
}

function zOf(tokens: string[]): number | null {
  let z: number | null = null;
  for (const token of tokens) {
    const m = /^z-(\d+)$/.exec(token) ?? /^z-\[(\d+)\]$/.exec(token);
    if (m) z = Math.max(z ?? 0, Number(m[1]));
  }
  return z;
}

function idOf(init: ts.JsxAttributeValue | undefined): string | null {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    if (ts.isIdentifier(init.expression)) return init.expression.text;
    if (ts.isStringLiteralLike(init.expression)) return init.expression.text;
  }
  return null;
}

export function fixedElementsIn(source: string, fileName = "probe.tsx"): FixedElement[] {
  const found: FixedElement[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      let className: ts.JsxAttribute | undefined;
      let id: string | null = null;
      for (const attr of n.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue;
        const name = attr.name.getText();
        if (name === "className") className = attr;
        if (name === "id") id = idOf(attr.initializer);
      }
      if (className?.initializer) {
        const parts: string[] = [];
        fragments(className.initializer, parts);
        const tokens = parts.join(" ").split(/\s+/).filter(Boolean);
        if (tokens.some((t) => t === "fixed" || t.endsWith(":fixed"))) found.push({ id, tokens, z: zOf(tokens) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(source, fileName));
  return found;
}

/** Names of the functions really called in the source (a comment or a string never counts). */
export function calledIdentifiers(source: string): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) names.add(e.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(source, "probe.tsx"));
  return names;
}

/** True when `<Name …>` is rendered as JSX somewhere in the source. */
export function rendersJsx(source: string, name: string): boolean {
  let hit = false;
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === name) hit = true;
    ts.forEachChild(n, visit);
  };
  visit(parse(source, "probe.tsx"));
  return hit;
}

/** `createPortal(x, <expression mentioning the host id, or a variable initialised from it>)` really called. */
export function portalsInto(source: string, hostIdentifier: string): boolean {
  const hostVars = new Set<string>();
  const mentions = (n: ts.Node): boolean => {
    let hit = false;
    const v = (m: ts.Node) => {
      if (ts.isIdentifier(m) && (m.text === hostIdentifier || hostVars.has(m.text))) hit = true;
      ts.forEachChild(m, v);
    };
    v(n);
    return hit;
  };
  let ok = false;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && mentions(n.initializer)) {
      hostVars.add(n.name.text);
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "createPortal" &&
      n.arguments[1] &&
      mentions(n.arguments[1])
    ) {
      ok = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(source, "probe.tsx"));
  return ok;
}

export type StackingVerdict = { overlays: FixedElement[]; hostZ: number | null; violations: string[] };

/** The one element carrying `id={hostId}` is the host; every other fixed element needs an explicit z strictly below it. */
export function checkStacking(sources: { file: string; source: string }[], hostId: string): StackingVerdict {
  const overlays: FixedElement[] = [];
  const violations: string[] = [];
  let hostZ: number | null = null;
  let hosts = 0;
  const perFile = sources.map(({ file, source }) => ({ file, elements: fixedElementsIn(source, file) }));
  for (const { elements } of perFile) {
    for (const el of elements) {
      if (el.id === hostId) {
        hosts += 1;
        hostZ = el.z;
      } else overlays.push(el);
    }
  }
  if (hosts !== 1) violations.push(`expected exactly one host (id=${hostId}), found ${hosts}`);
  if (hostZ === null) violations.push("the host carries no z-index");
  for (const { file, elements } of perFile) {
    for (const el of elements) {
      if (el.id === hostId) continue;
      if (el.z === null) violations.push(`${file}: fixed element without an explicit z-index (${el.tokens.join(" ")})`);
      else if (hostZ !== null && el.z >= hostZ) violations.push(`${file}: z-${el.z} is not below the host's z-${hostZ}`);
    }
  }
  return { overlays, hostZ, violations };
}
