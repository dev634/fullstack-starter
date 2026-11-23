import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { sourceFilesIn } from "@/tests/helpers/astScan";
import { scanWrites, type WriteScan } from "@/tests/helpers/partialWriteScan";

/**
 * "Absent is not empty", enforced at the write layer (lot 5b).
 *
 * An UPDATE payload says three different things per field — absent (leave the
 * column), null (clear it), a value (set it) — and the repository must pass the
 * three through. Folding `undefined` into `null` or into a default
 * (`x ?? null`, `x || null`, `x ? … : null`, `x ?? "AUTRE"`) writes over a
 * value nobody asked to touch; the forms always send every field, so no form
 * and no nominal-path test can show it. This test reads the source instead.
 *
 * Domain: every `prisma.<model>.update / updateMany` and `tx.<model>.…` in
 * `repository/**`, and the `update` branch of an `upsert`. `create` and
 * `upsert.create` are out of the domain: on a create, "not provided" is NULL
 * or the default. No exemption exists. One would have to carry its reason and
 * the condition of its disappearance, and be listed in EXEMPT below — which is
 * empty, and asserted empty.
 *
 * Discovery is by walking `repository/`, not by a list of files: a repository
 * file added tomorrow is scanned tomorrow. The COUNTS below are exact, not a
 * floor (a floor stays green when a file silently leaves the walk — the same
 * dead-weight a `toBeGreaterThan` gave the report routes). Method: the number
 * of `prisma.*`/`tx.*` calls named update/updateMany/upsert in `repository/`,
 * counted by this very scanner (AST, not grep), at the commit that introduced
 * this test (lot 5b, on 4e3c633 + the lot 5b changes). A new write changes
 * the count on purpose: update the number in the same change, after checking
 * the new write for the forms above.
 */

const EXEMPT: ReadonlySet<string> = new Set();

const EXPECTED_FILES_WITH_UPDATES = 16;
const EXPECTED_UPDATE_FUNCTIONS = 42;
const EXPECTED_UPDATE_CALLS = 43;

type Scanned = { file: string; scan: WriteScan };

function scanRepository(): Scanned[] {
  return sourceFilesIn("repository", [".ts"]).map((abs) => ({
    file: relative(".", abs).replaceAll("\\", "/"),
    scan: scanWrites(readFileSync(abs, "utf8"), abs),
  }));
}

describe("repository updates never fold an absent field into null or a default", () => {
  const scanned = scanRepository();

  it("no `X ?? <literal>`, `X || <literal>` or `X ? … : null` reaches the data of an update", () => {
    const offenders = scanned.flatMap(({ file, scan }) =>
      scan.findings.filter(() => !EXEMPT.has(file)).map((f) => `${file}:${f.line} ${f.kind}  ${f.text}`)
    );
    expect(offenders).toEqual([]);
  });

  it("every update goes through `prisma.` or `tx.` — no other receiver escapes the scan", () => {
    const escaping = scanned.flatMap(({ file, scan }) => scan.unknownRoot.map((f) => `${file}:${f.line} ${f.text}`));
    expect(escaping).toEqual([]);
  });

  it("has no exemption", () => {
    expect([...EXEMPT]).toEqual([]);
  });

  it("inspects an exact, published set of updates (a repository file dropped from the walk turns this red)", () => {
    const withUpdates = scanned.filter(({ scan }) => scan.calls > 0);
    const functions = withUpdates.flatMap(({ file, scan }) => scan.functions.map((fn) => `${file}::${fn}`));
    const calls = withUpdates.reduce((sum, { scan }) => sum + scan.calls, 0);
    expect({ files: withUpdates.length, functions: functions.length, calls }).toEqual({
      files: EXPECTED_FILES_WITH_UPDATES,
      functions: EXPECTED_UPDATE_FUNCTIONS,
      calls: EXPECTED_UPDATE_CALLS,
    });
  });
});

// ---------------------------------------------------------------------------
// Probes — the scanner itself, on sources written for the occasion. Without
// these a green run could mean "the scanner sees nothing". Each forbidden form
// must go red, its neighbour forms must stay green.
// ---------------------------------------------------------------------------

function findingsOf(body: string): string[] {
  return scanWrites(`import { prisma } from "@/lib/prisma";\n${body}`).findings.map((f) => f.kind);
}

describe("the scanner (probes)", () => {
  it("flags each folding form planted in an update", () => {
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ?? null } }); }`)).toEqual(["?? <literal>"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a || null } }); }`)).toEqual(["|| <literal>"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ? new Date(d.a) : null } }); }`)).toEqual(["? … : null"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ?? "AUTRE" } }); }`)).toEqual(["?? <literal>"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.updateMany({ where: {}, data: { a: d.a ?? 0 } }); }`)).toEqual(["?? <literal>"]);
  });

  it("flags the same form reached through a local const and a shorthand property", () => {
    expect(
      findingsOf(`export async function f(d: D) {
        const a = d.a ?? null;
        return prisma.p.update({ where: { id: 1 }, data: { a } });
      }`)
    ).toEqual(["?? <literal>"]);
    expect(
      findingsOf(`export async function f(d: D) {
        const quantityDone = d.t != null ? 1 : null;
        return prisma.p.update({ where: { id: 1 }, data: { quantityDone: quantityDone } });
      }`)
    ).toEqual(["? … : null"]);
    // a chain of consts, and a const holding the whole data object
    expect(
      findingsOf(`export async function f(d: D) {
        const base = d.a ?? null;
        const a = base;
        return prisma.p.update({ where: { id: 1 }, data: { a } });
      }`)
    ).toEqual(["?? <literal>"]);
    expect(
      findingsOf(`export async function f(d: D) {
        const payload = { a: d.a || null };
        return prisma.p.update({ where: { id: 1 }, data: payload });
      }`)
    ).toEqual(["|| <literal>"]);
  });

  it("flags it inside a $transaction, on tx.*, in a conditional spread, and on an upsert's update branch", () => {
    expect(
      findingsOf(`export async function f(d: D) {
        return prisma.$transaction(async (tx) => tx.p.update({ where: { id: 1 }, data: { a: d.a ?? null } }));
      }`)
    ).toEqual(["?? <literal>"]);
    expect(
      findingsOf(`export async function f(d: D) {
        return prisma.p.update({ where: { id: 1 }, data: { ...(d.a !== undefined ? { a: d.a ?? null } : {}) } });
      }`)
    ).toEqual(["?? <literal>"]);
    expect(
      findingsOf(`export async function f(d: D) {
        return prisma.p.upsert({ where: { id: 1 }, update: { a: d.a ?? null }, create: { a: d.a ?? null } });
      }`)
    ).toEqual(["?? <literal>"]);
    expect(
      findingsOf(`export async function f(d: D) {
        return prisma.$transaction([prisma.p.updateMany({ where: {}, data: { a: d.a || null } })]);
      }`)
    ).toEqual(["|| <literal>"]);
  });

  it("does NOT flag the same forms in a create, or an upsert's create branch", () => {
    expect(findingsOf(`export async function f(d: D) { return prisma.p.create({ data: { a: d.a ?? null, b: d.b || null, c: d.c ? 1 : null } }); }`)).toEqual([]);
    expect(
      findingsOf(`export async function f(d: D) {
        return prisma.p.upsert({ where: { id: 1 }, update: { a: d.a }, create: { a: d.a ?? null } });
      }`)
    ).toEqual([]);
    expect(
      findingsOf(`export async function f(d: D) {
        const a = d.a ?? null;
        return prisma.p.create({ data: { a } });
      }`)
    ).toEqual([]);
  });

  it("does NOT flag a pass-through, a conditional spread, a fold onto the current value, or an explicit clear", () => {
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a, b: dateColumn(d.b) } }); }`)).toEqual([]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { ...(d.a !== undefined ? { a: d.a } : {}) } }); }`)).toEqual([]);
    expect(findingsOf(`export async function f(d: D, cur: C) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ?? cur.a } }); }`)).toEqual([]);
    expect(findingsOf(`export async function f() { return prisma.p.update({ where: { id: 1 }, data: { deletedAt: null } }); }`)).toEqual([]);
    expect(
      findingsOf(`export async function f(d: D) {
        const a = d.a;
        return prisma.p.update({ where: { id: 1 }, data: { a } });
      }`)
    ).toEqual([]);
  });

  it("refuses a write it cannot read, and a receiver that is not prisma/tx", () => {
    expect(findingsOf(`export async function f(args: A) { return prisma.p.update(args); }`)).toEqual(["opaque write argument"]);
    const other = scanWrites(`export async function f(d: D) { return db.p.update({ where: { id: 1 }, data: { a: d.a ?? null } }); }`);
    expect(other.unknownRoot).toHaveLength(1);
    expect(other.calls).toBe(0);
  });

  it("counts the updates and the functions that hold them", () => {
    const scan = scanWrites(`
      export async function a(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a } }); }
      export async function b(d: D) {
        await prisma.p.updateMany({ where: {}, data: { a: d.a } });
        return prisma.q.update({ where: { id: 1 }, data: { a: d.a } });
      }
      export async function c() { return prisma.p.findMany({}); }
    `);
    expect(scan.calls).toBe(3);
    expect(scan.functions).toEqual(["a", "b"]);
  });
});
