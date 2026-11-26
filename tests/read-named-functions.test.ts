import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { sourceFilesIn } from "@/tests/helpers/astScan";
import { PRISMA_KNOWN_WRITE_METHODS, isPrismaWrite } from "@/tests/helpers/prismaMethods";

/**
 * "A function named like a read does not write" — checked, not assumed (lot 5b).
 *
 * tests/authz-coverage.test.ts decides whether a guard comes BEFORE an effect by
 * reading the NAME of the function an action imports: find/get/count/has/is/
 * list/search/exists = a read, anything else = a write. That is a convention
 * nothing enforced: a `getOrCreateX` or a `findAndTouch` that writes would let a
 * guard placed after it pass as "before any write". This test closes it from
 * the other side: it walks the layers whose functions are imported by actions
 * (repository/, service/, lib/cloudinary.ts) and fails when a function with a
 * read name contains a Prisma write or a Cloudinary upload/destroy — directly,
 * or through a function of the same file it calls.
 *
 * Domain, by AST: every top-level `function f` and `const f = () => …` of those
 * files. A write is a call whose method is a Prisma write (on `prisma`/`tx`: anything that
 * is not a known read; elsewhere the known create/update/delete family, `*AndReturn` included;
 * and $executeRaw[Unsafe]) or whose
 * receiver chain goes through Cloudinary's `uploader` (upload_stream, destroy…).
 * Names: ^(find|get|count|has|is|list|search|exists).
 * Counts are exact and published below (method: this test's own walk, on the
 * lot 5b working tree above c934ac0, itself on main at 5eecf78 — the merge of lot
 * 5a, net +8 functions and +5 read-named ones (227 -> 235, 105 -> 110), none of which writes: the
 * "never writes" test above passed before the recount); a function added or
 * renamed changes them on purpose — recheck the new one, then update the number.
 */

const READ_NAME = /^(find|get|count|has|is|list|search|exists)/;
// Fail closed on the client: `prisma|tx.<model>.<anything that is not a known read>()` is a write
// (tests/helpers/prismaMethods.ts), so `updateManyAndReturn` or a method added tomorrow is seen. On any
// OTHER receiver only the writes the client is known to expose can be recognised.
const RAW_WRITES: ReadonlySet<string> = new Set(["$executeRaw", "$executeRawUnsafe"]);
const CLIENT_ROOTS: ReadonlySet<string> = new Set(["prisma", "tx"]);

/** `prisma.<model>.<method>()` / `tx.<model>.<method>()` with a method that is not a known read. */
function isClientModelWrite(callee: ts.PropertyAccessExpression): boolean {
  const model = callee.expression;
  return ts.isPropertyAccessExpression(model) && ts.isIdentifier(model.expression) && CLIENT_ROOTS.has(model.expression.text) && isPrismaWrite(callee.name.text);
}

const EXPECTED_FILES = 29;
// 235 -> 234 at lot 3: updatePassword and markResetTokenUsed (two functions)
// became resetPasswordWithToken (one); none of them is read-named (110 unchanged).
// 234 -> 236 (fix/photo-entreprise): repository/clients.ts gains isDuplicateEmailConflict
// (read-named: `is`, 110 -> 111, a pure predicate, no write) and duplicateEmailError.
// 2026-11-26 (fix/photo-entreprise, points 4 and 6): repository/clients.ts gains
// isPhotoUrlReferenced (read-named, a findFirst, no write) while lib/cloudinary.ts loses
// isStrippableEquipmentPhoto (read-named, merged into lib/imageMetadata.ts::isStrippableMediaType,
// a file this test does not walk): +1 and -1, the totals do not move.
// 236 -> 237 (fix/photo-entreprise, decode queue): lib/cloudinary.ts gains busyUploadError, the refusal
// thrown when lib/imageMetadata.ts's queue is full (not read-named, 111 unchanged; it writes nothing).
const EXPECTED_FUNCTIONS = 237;
const EXPECTED_READ_NAMED = 111;

type Fn = { name: string; body: ts.Node };

function topLevelFunctions(source: ts.SourceFile): Fn[] {
  const fns: Fn[] = [];
  ts.forEachChild(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) fns.push({ name: node.name.text, body: node.body });
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          fns.push({ name: d.name.text, body: d.initializer.body });
        }
      }
    }
  });
  return fns;
}

/** Whether `callee` goes through a `.uploader` (cloudinary.uploader.destroy / .upload_stream …). */
function throughUploader(callee: ts.Expression): boolean {
  let cur: ts.Expression = callee;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur) || ts.isCallExpression(cur)) {
    if (ts.isPropertyAccessExpression(cur) && cur.name.text === "uploader") return true;
    cur = cur.expression;
  }
  return false;
}

/** The first write inside `body` (own body only), described, or undefined. */
function writeIn(body: ts.Node): string | undefined {
  let found: string | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      if (PRISMA_KNOWN_WRITE_METHODS.has(n.expression.name.text) || RAW_WRITES.has(n.expression.name.text) || isClientModelWrite(n.expression) || throughUploader(n.expression)) {
        found = n.expression.getText().replace(/\s+/g, " ").slice(0, 80);
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

/** Same-file transitive: a function writes if its body does, or a local function it calls does. */
function writers(fns: readonly Fn[]): Map<string, string> {
  const direct = new Map<string, string>();
  for (const fn of fns) {
    const w = writeIn(fn.body);
    if (w) direct.set(fn.name, w);
  }
  const byName = new Map(fns.map((f) => [f.name, f]));
  const result = new Map(direct);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of fns) {
      if (result.has(fn.name)) continue;
      const visit = (n: ts.Node): boolean => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          const w = result.get(n.expression.text);
          if (w && byName.has(n.expression.text)) {
            result.set(fn.name, `${n.expression.text}() → ${w}`);
            return true;
          }
        }
        return ts.forEachChild(n, (c) => (visit(c) ? true : undefined)) ?? false;
      };
      if (visit(fn.body)) changed = true;
    }
  }
  return result;
}

type Scan = { files: number; functions: number; readNamed: number; offenders: string[] };

function scanSource(source: ts.SourceFile, file: string): Omit<Scan, "files"> {
  const fns = topLevelFunctions(source);
  const w = writers(fns);
  const readNamed = fns.filter((f) => READ_NAME.test(f.name));
  return {
    functions: fns.length,
    readNamed: readNamed.length,
    offenders: readNamed.filter((f) => w.has(f.name)).map((f) => `${file}::${f.name} — ${w.get(f.name)}`),
  };
}

function scanLayers(): Scan {
  const files = [...sourceFilesIn("repository", [".ts"]), ...sourceFilesIn("service", [".ts"]), "lib/cloudinary.ts"];
  const total: Scan = { files: files.length, functions: 0, readNamed: 0, offenders: [] };
  for (const abs of files) {
    const file = relative(".", abs).replaceAll("\\", "/");
    const one = scanSource(ts.createSourceFile(file, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true), file);
    total.functions += one.functions;
    total.readNamed += one.readNamed;
    total.offenders.push(...one.offenders);
  }
  return total;
}

describe("a function named like a read never writes (repository/, service/, lib/cloudinary.ts)", () => {
  const scan = scanLayers();

  it("no find/get/count/has/is/list/search/exists function contains a Prisma write or a Cloudinary upload/destroy", () => {
    expect(scan.offenders).toEqual([]);
  });

  it("inspects an exact, published set (a file dropped from the walk turns this red)", () => {
    expect({ files: scan.files, functions: scan.functions, readNamed: scan.readNamed }).toEqual({
      files: EXPECTED_FILES,
      functions: EXPECTED_FUNCTIONS,
      readNamed: EXPECTED_READ_NAMED,
    });
  });
});

describe("the scanner (probes)", () => {
  const offenders = (code: string) => scanSource(ts.createSourceFile("repository/probe.ts", code, ts.ScriptTarget.Latest, true), "repository/probe.ts").offenders;

  it("flags a read-named function that writes, directly, in an arrow, through a helper, or by uploading", () => {
    expect(offenders(`export async function getOrCreateX(id: number) { return prisma.x.upsert({ where: { id } }); }`)).toHaveLength(1);
    expect(offenders(`export const findAndTouch = async (id: number) => prisma.$transaction(async (tx) => tx.x.update({ where: { id } }));`)).toHaveLength(1);
    expect(offenders(`async function touch() { return prisma.x.updateMany({}); }\nexport async function findFresh() { return touch(); }`)).toHaveLength(1);
    expect(offenders(`export async function getSignedThing(id: string) { return cloudinary.uploader.destroy(id); }`)).toHaveLength(1);
    expect(offenders(`export function isUploaded(buf: Buffer) { return cloudinary.uploader.upload_stream({}, () => 1).end(buf); }`)).toHaveLength(1);
  });

  it("fails closed on the client: an AndReturn write, or a method nobody has heard of, is a write", () => {
    expect(offenders(`export async function findX() { return prisma.x.updateManyAndReturn({ data: {} }); }`)).toHaveLength(1);
    expect(offenders(`export async function findX() { return prisma.x.createManyAndReturn({ data: [] }); }`)).toHaveLength(1);
    expect(offenders(`export async function findX() { return tx.x.frobnicate({ data: {} }); }`)).toHaveLength(1);
  });

  it("stays green on a real read, and on a write whose name says so", () => {
    expect(offenders(`export async function findX(id: number) { return prisma.x.findUnique({ where: { id } }); }`)).toEqual([]);
    expect(offenders(`export async function findX() { return prisma.x.groupBy({ by: ["a"] }); }`)).toEqual([]);
    expect(offenders(`export async function findX() { return prisma.$transaction([prisma.x.findMany(), prisma.x.aggregate({})]); }`)).toEqual([]);
    expect(offenders(`export async function countX() { return prisma.x.count(); }`)).toEqual([]);
    expect(offenders(`export async function createX() { return prisma.x.create({ data: {} }); }`)).toEqual([]);
    expect(offenders(`export async function setX() { return prisma.x.update({ where: { id: 1 }, data: {} }); }`)).toEqual([]);
  });
});
