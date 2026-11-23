import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { sourceFilesIn } from "@/tests/helpers/astScan";
import {
  scanWrites,
  scanActionUpdates,
  SAFE_VALUE_CALLS,
  SAFE_SPREAD_CALLS,
  type WriteScan,
  type ActionScan,
} from "@/tests/helpers/partialWriteScan";

/**
 * "Absent is not empty", enforced at the write layer (lot 5b).
 *
 * An UPDATE payload says three different things per field — absent (leave the
 * column), null (clear it), a value (set it) — and the repository must pass the
 * three through. Folding `undefined` into `null` or into a default
 * (`x ?? null`, `x || null`, `x ? … : null`, `x ?? "AUTRE"`) writes over a
 * value nobody asked to touch; the forms always send every field, so no form
 * and no nominal-path test can show it. This test reads the source instead.
 * The forms are listed in tests/helpers/partialWriteScan.ts; beyond the plain
 * folds it refuses what it cannot read (a default in the destructured
 * parameters, an opaque helper, a spread, a `data` passed as a parameter) and
 * it also reads the ACTION layer: the arguments of every imported repository
 * `update*` (two of the lot's corrections lived there).
 *
 * Domain: every `prisma.<model>.update / updateMany` and `tx.<model>.…` in
 * `repository/**`, and the `update` branch of an `upsert`. `create` and
 * `upsert.create` are out of the domain: on a create, "not provided" is NULL
 * or the default. An exemption carries its reason and the condition of its
 * disappearance and is listed in EXEMPT below; the test fails when an entry no
 * longer matches anything (a stale exemption certifies what it exempts). The
 * scanner's own pass-through calls (SAFE_*_CALLS) follow the same rule.
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

/**
 * "<file> <finding kind> <finding text>" -> why it is not a fold, and when the
 * entry goes away. Exactly one, asserted below.
 */
const EXEMPT: ReadonlyMap<string, string> = new Map([
  [
    "repository/users.ts opaque data data",
    "updateProfile(id, data: { name: string | null; role: Role; jobFunctionId: number | null }) hands its typed parameter to Prisma: " +
      "every column is REQUIRED in that type (null = clear, never optional), so nothing can be absent. " +
      "Disappears the day updateProfile writes its columns one by one, or its type gains an optional field. " +
      "(Lot 5a file: left as is by lot 5b.)",
  ],
]);
const isExempt = (file: string, f: { kind: string; text: string }) => EXEMPT.has(`${file} ${f.kind} ${f.text}`);

const EXPECTED_FILES_WITH_UPDATES = 16;
const EXPECTED_UPDATE_FUNCTIONS = 42;
const EXPECTED_UPDATE_CALLS = 43;
const EXPECTED_ACTION_FILES_WITH_UPDATES = 13;
const EXPECTED_ACTION_UPDATE_CALLS = 20;

type Scanned = { file: string; scan: WriteScan };
type ScannedAction = { file: string; scan: ActionScan };

function scanActions(): ScannedAction[] {
  return sourceFilesIn("actions", [".ts"]).map((abs) => ({
    file: relative(".", abs).replaceAll("\\", "/"),
    scan: scanActionUpdates(readFileSync(abs, "utf8"), abs),
  }));
}

function scanRepository(): Scanned[] {
  return sourceFilesIn("repository", [".ts"]).map((abs) => ({
    file: relative(".", abs).replaceAll("\\", "/"),
    scan: scanWrites(readFileSync(abs, "utf8"), abs),
  }));
}

describe("repository updates never fold an absent field into null or a default", () => {
  const scanned = scanRepository();
  const actionScans = scanActions();

  it("no fold, default, opaque helper, spread or parameter-as-data reaches the data of an update", () => {
    const offenders = scanned.flatMap(({ file, scan }) =>
      scan.findings.filter((f) => !isExempt(file, f)).map((f) => `${file}:${f.line} ${f.kind}  ${f.text}`)
    );
    expect(offenders).toEqual([]);
  });

  it("every update goes through `prisma.` or `tx.` — no other receiver escapes the scan", () => {
    const escaping = scanned.flatMap(({ file, scan }) => scan.unknownRoot.map((f) => `${file}:${f.line} ${f.text}`));
    expect(escaping).toEqual([]);
  });

  it("keeps its exemptions honest: exactly the published ones, each still matching a finding", () => {
    expect(EXEMPT.size).toBe(1);
    const live = new Set(scanned.flatMap(({ file, scan }) => scan.findings.map((f) => `${file} ${f.kind} ${f.text}`)));
    for (const key of EXEMPT.keys()) expect(live.has(key), `${key} is exempt but no longer found — remove the entry`).toBe(true);
  });

  it("keeps the scanner's pass-through calls honest: each still named somewhere in repository/ or actions/", () => {
    const sources = [...sourceFilesIn("repository", [".ts"]), ...sourceFilesIn("actions", [".ts"])].map((f) => readFileSync(f, "utf8")).join("\n");
    for (const name of [...SAFE_VALUE_CALLS.keys(), ...SAFE_SPREAD_CALLS.keys()]) {
      expect(sources.includes(`${name}(`), `${name} is a scanner exemption but nothing calls it any more — remove it`).toBe(true);
    }
  });

  it("the action layer: no fold, helper or spread in the arguments of an imported repository update*", () => {
    const offenders = actionScans.flatMap(({ file, scan }) => scan.findings.map((f) => `${file}:${f.line} ${f.kind}  ${f.text}`));
    expect(offenders).toEqual([]);
  });

  it("inspects an exact, published set of action-layer updates (a file or call dropped from the walk turns this red)", () => {
    // Method: calls, in actions/**, to a function imported from @/repository/*
    // under an original name starting with "update" — counted by scanActionUpdates
    // (AST), at the commit of lot 5b (on 09fbd0b + the lot 5b changes).
    const withCalls = actionScans.filter(({ scan }) => scan.calls > 0);
    expect({ files: withCalls.length, calls: withCalls.reduce((n, { scan }) => n + scan.calls, 0) }).toEqual({
      files: EXPECTED_ACTION_FILES_WITH_UPDATES,
      calls: EXPECTED_ACTION_UPDATE_CALLS,
    });
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
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ? new Date(d.a) : null } }); }`)).toEqual(["? … : null", "opaque value"]);
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

// ---------------------------------------------------------------------------
// Probes — the neighbour forms the reviewer planted against the first scanner
// (lot 5b, point 3). Each used to stay green; each must now go red, and its
// legitimate neighbour must stay green.
// ---------------------------------------------------------------------------

describe("the scanner (probes: neighbour forms)", () => {
  it("flags a default in the DESTRUCTURED parameters of a function that updates — the exact shape of repository/clients.ts", () => {
    expect(
      findingsOf(`export async function update({ id, status = "PROSPECT" }: D) {
        return prisma.p.update({ where: { id }, data: { status } });
      }`)
    ).toEqual(["default in destructured parameter"]);
    expect(
      findingsOf(`export async function update(id: number, status = "PROSPECT") {
        return prisma.p.update({ where: { id }, data: { status } });
      }`)
    ).toEqual(["default in parameter"]);
    // the same destructuring WITHOUT a default stays green
    expect(
      findingsOf(`export async function update({ id, status }: D) {
        return prisma.p.update({ where: { id }, data: { status } });
      }`)
    ).toEqual([]);
    // a default in a local destructuring that reaches the data
    expect(
      findingsOf(`export async function f(d: D) {
        const { status = "X" } = d;
        return prisma.p.update({ where: { id: 1 }, data: { status } });
      }`)
    ).toEqual(["default in destructuring"]);
  });

  it("flags null / a literal in the TRUE branch of a ternary, and in either branch", () => {
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: !d.a ? null : g(d.a) } }); }`)).toContain("? … : null");
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ? "X" : d.b } }); }`)).toEqual(["? … : <literal>"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: d.a ? d.a : d.b } }); }`)).toEqual([]);
  });

  it("flags an opaque helper, as a value and behind a const; accepts the listed pass-throughs", () => {
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: orNull(d.a) } }); }`)).toEqual(["opaque value"]);
    expect(
      findingsOf(`export async function f(d: D) {
        const a = orNull(d.a);
        return prisma.p.update({ where: { id: 1 }, data: { a } });
      }`)
    ).toEqual(["opaque value"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { a: dateColumn(d.a) } }); }`)).toEqual([]);
    expect(findingsOf(`export async function f(ids: number[]) { return prisma.p.update({ where: { id: 1 }, data: { r: { set: ids.map((id) => ({ id })) } } }); }`)).toEqual([]);
  });

  it("flags a call spread, a spread of a parameter; accepts only the conditional spread on `!== undefined` and a validated payload", () => {
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { ...patch(d) } }); }`)).toEqual(["opaque spread"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { ...d } }); }`)).toEqual(["opaque spread"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { ...(d.a ? { a: d.a } : {}) } }); }`)).toEqual(["opaque spread"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { ...(d.a !== undefined ? { a: d.a } : {}) } }); }`)).toEqual([]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { ...quantityTargetPatch(c, d.q) } }); }`)).toEqual([]);
  });

  it("flags a fold onto a module CONSTANT or an imported name; a fold onto the current value stays green", () => {
    expect(
      findingsOf(`const DEFAULT_TYPE = "AUTRE";
      export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { type: d.type ?? DEFAULT_TYPE } }); }`)
    ).toEqual(["?? <literal>"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: { type: d.type ?? Status.OPEN } }); }`)).toEqual(["?? <literal>"]);
    expect(findingsOf(`export async function f(d: D, cur: C) { return prisma.p.update({ where: { id: 1 }, data: { type: d.type ?? cur.type } }); }`)).toEqual([]);
    expect(
      findingsOf(`export async function f(d: D) {
        const cur = await prisma.p.findUnique({ where: { id: 1 } });
        return prisma.p.update({ where: { id: 1 }, data: { type: d.type ?? cur.type } });
      }`)
    ).toEqual([]);
  });

  it("flags a `data` handed over as a parameter or a call result; a const holding an object literal is read", () => {
    expect(findingsOf(`export async function f(data: D) { return prisma.p.update({ where: { id: 1 }, data }); }`)).toEqual(["opaque data"]);
    expect(findingsOf(`export async function f(data: D) { return prisma.p.update({ where: { id: 1 }, data: data }); }`)).toEqual(["opaque data"]);
    expect(findingsOf(`export async function f(d: D) { return prisma.p.update({ where: { id: 1 }, data: build(d) }); }`)).toEqual(["opaque data"]);
    expect(
      findingsOf(`export async function f(d: D) {
        const data = { a: d.a };
        return prisma.p.update({ where: { id: 1 }, data });
      }`)
    ).toEqual([]);
  });
});

function actionFindingsOf(body: string): string[] {
  return scanActionUpdates(`import { update, update as updateLoan, findById } from "@/repository/x";\n${body}`).findings.map((f) => f.kind);
}

describe("the scanner, action layer (probes)", () => {
  it("flags the folds in the arguments of an imported update*, aliased or not", () => {
    expect(actionFindingsOf(`export async function a(d: D) { return update(1, { phone: d.phone || null }); }`)).toEqual(["|| <literal>"]);
    expect(actionFindingsOf(`export async function a(d: D) { return updateLoan(1, { phone: d.phone ?? null }); }`)).toEqual(["?? <literal>"]);
    expect(actionFindingsOf(`export async function a(d: D) { return update(1, { x: d.x ? d.x : null }); }`)).toEqual(["? … : null"]);
    expect(actionFindingsOf(`export async function a(d: D) { return update(1, { ...patch(d) }); }`)).toEqual(["opaque spread"]);
    expect(actionFindingsOf(`export async function a(d: D) { const phone = d.phone || null; return update(1, { phone }); }`)).toEqual(["|| <literal>"]);
  });

  it("stays green on a pass-through, a validated payload, a read, and a local function that merely looks like an update", () => {
    expect(actionFindingsOf(`export async function a(d: D) { return update(1, { phone: d.phone }); }`)).toEqual([]);
    expect(actionFindingsOf(`export async function a(raw: unknown) { const parsed = S.safeParse(raw); return update(1, { ...parsed.data, id: 1 }); }`)).toEqual([]);
    expect(actionFindingsOf(`export async function a(d: D) { return findById(d.phone || null); }`)).toEqual([]);
    const local = scanActionUpdates(`function updateThing(x: unknown) { return x; }\nexport async function a(d: D) { return updateThing(d.phone || null); }`);
    expect(local.calls).toBe(0);
    expect(local.findings).toEqual([]);
  });
});
