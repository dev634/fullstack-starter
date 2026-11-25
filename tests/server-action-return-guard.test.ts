import { describe, it, expect } from "vitest";
import {
  actionReturnFindings,
  exportedActionCount,
  functionLevelDirectiveCount,
  hasUseServerDirective,
  repositorySources,
  serverActionSources,
  type ActionReturnFinding,
  type Source,
} from "./helpers/actionReturnScan";
import ts from "typescript";

/**
 * Structural guarantee: no Server Action returns a repository row.
 *
 * What an exported function of a `"use server"` file returns is serialised to
 * the browser. Most callers read `type` and `message` and nothing else, yet the
 * actions used to hand back the row the repository had just written
 * (`data: project`: budget, notes, deletedAt, reserveCounter; `data: loan`:
 * borrowerId, note; `data: deleted` on a job function: its whole access
 * configuration). Nothing was readable by someone who could not read it
 * elsewhere — it is hygiene, and the rule of the repository is to serialise
 * nothing the caller does not read. Narrowing the type of a prop removes no
 * data (TypeScript is structural), so the rule is on the SOURCE of the value:
 * an action returns a LITERAL of named fields (`{ id: row.id }`), never a row
 * reached through a variable, a spread, a conditional or a helper.
 *
 * Targets are DISCOVERED: every `.ts`/`.tsx` file of the repository whose
 * file-level directive prologue contains "use server" (the directive is parsed),
 * never a list of files. Its size is EXACT (below) so that a file that stops
 * being discovered turns the test red instead of being silently skipped.
 *
 * Measured at 42f0122 + this change (parsed, `exportedActionsIn` over the
 * discovered files): 24 files, 93 exported actions. At 42f0122 alone: 24 files,
 * 93 actions, 58 of them returning a `data` field built from a row.
 */

const ROOT = process.cwd();

/** Exact sizes of the discovered domain. A new action file or action is a deliberate edit here. */
const SERVER_ACTION_FILES_EXPECTED = 24;
const SERVER_ACTIONS_EXPECTED = 91;

/**
 * Actions allowed to return a row. Each carries its REASON and the CONDITION
 * that removes it; an exception that no longer matches a finding fails the
 * test (it would otherwise certify what it exempts).
 */
type ReturnException = { file: string; action: string; reason: string; until: string };

const EXCEPTIONS: readonly ReturnException[] = [];

const EXCEPTION_KEY = (file: string, action: string) => `${file}::${action}`;
const excepted = new Set(EXCEPTIONS.map((e) => EXCEPTION_KEY(e.file, e.action)));

const sources = repositorySources(ROOT);
const domain = serverActionSources(sources);

const unexcepted = (findings: ActionReturnFinding[]) => findings.filter((f) => !excepted.has(EXCEPTION_KEY(f.file, f.action)));
const describeFinding = (f: ActionReturnFinding) => `${f.file}:${f.line} ${f.action}: ${f.text}\n      <- ${f.reason}`;

describe("Server Actions return no repository row", () => {
  it("discovers the `\"use server\"` files by their parsed directive, at an exact size", () => {
    expect(domain.length).toBe(SERVER_ACTION_FILES_EXPECTED);
    expect(domain.reduce((n, s) => n + exportedActionCount(s), 0)).toBe(SERVER_ACTIONS_EXPECTED);
  });

  it("finds no action defined by a function-level directive outside a `\"use server\"` file", () => {
    // The file-level discovery would not see such an action: refuse it rather than miss it.
    const inDomain = new Set(domain.map((s) => s.path));
    const stray = sources
      .filter((s) => !inDomain.has(s.path) && s.text.includes("use server"))
      .filter((s) => functionLevelDirectiveCount(ts.createSourceFile(s.path, s.text, ts.ScriptTarget.Latest, true)) > 0)
      .map((s) => s.path);
    expect(stray).toEqual([]);
  });

  it("no exported action returns a value that comes from a repository call", () => {
    const findings = unexcepted(domain.flatMap((s) => actionReturnFindings(s)));
    expect(findings.map(describeFinding)).toEqual([]);
  });

  it("each exception names a real action and still matches a finding (none is stale)", () => {
    const all = domain.flatMap((s) => actionReturnFindings(s));
    for (const e of EXCEPTIONS) {
      expect(domain.some((s) => s.path === e.file), `${e.file} is not a discovered "use server" file`).toBe(true);
      expect(all.some((f) => f.file === e.file && f.action === e.action), `${e.action} no longer returns a row: delete its exception`).toBe(true);
      expect(e.reason.length).toBeGreaterThan(40);
      expect(e.until.length).toBeGreaterThan(20);
    }
    // The size of the exemption list is part of the contract: adding one is a deliberate edit.
    expect(EXCEPTIONS.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The scan itself, proved by probes. A structural test that was never seen red
// certifies what it does not inspect.
// ---------------------------------------------------------------------------

const scan = (body: string): ActionReturnFinding[] =>
  actionReturnFindings({
    path: "actions/probe.ts",
    text: `"use server";\nimport { create, findAll } from "@/repository/things";\nimport * as repo from "@/repository/other";\nimport { scanPhoto } from "@/lib/scan";\ntype S = { type: string; message: string };\n${body}\n`,
  });

describe("probe 1 — the original faulty form is red", () => {
  it("`data: row` from a repository call through a variable", () => {
    const f = scan(`export async function addThing(prevState: S) {
      const thing = await create({});
      return { ...prevState, type: "success", message: "ok", data: thing };
    }`);
    expect(f.map((x) => x.action)).toEqual(["addThing"]);
  });

  it("`data: await repoCall()` inline, and through a namespace import", () => {
    const f = scan(`export async function a() { return { type: "success", data: await create({}) }; }
    export async function b() { return { type: "success", data: await repo.remove(1) }; }`);
    expect(f.map((x) => x.action)).toEqual(["a", "b"]);
  });

  it("the whole result returned as is", () => {
    expect(scan(`export async function a() { return await create({}); }`)).toHaveLength(1);
  });
});

describe("probe 2 — the neighbouring forms are red too", () => {
  const faulty: Record<string, string> = {
    "intermediate variable": `export async function f() { const row = await create({}); const out = row; return { type: "success", data: out }; }`,
    "spread of the row": `export async function f() { const row = await create({}); return { type: "success", ...row }; }`,
    "spread inside data": `export async function f() { const row = await create({}); return { type: "success", data: { ...row, extra: 1 } }; }`,
    "variable assigned later": `export async function f(prevState: S) { let result: S; const row = await create({}); result = { ...prevState, data: row } as S; return result; }`,
    "conditional branch": `export async function f() { const row = await create({}); return { type: "success", data: row ? row : null }; }`,
    "nullish fallback": `export async function f() { const row = await create({}); return { type: "success", data: row ?? null }; }`,
    "array wrapper": `export async function f() { const row = await create({}); return { type: "success", data: [row] }; }`,
    "rest of a destructuring": `export async function f() { const { id, ...rest } = await create({}); return { type: "success", data: rest, id }; }`,
    "array destructuring of Promise.all": `export async function f() { const [a] = await Promise.all([create({}), findAll()]); return { type: "success", data: a }; }`,
    "list returned unchanged by filter": `export async function f() { const rows = await findAll(); return { type: "success", data: rows.filter(Boolean) }; }`,
    "map returning the element": `export async function f() { const rows = await findAll(); return { type: "success", data: rows.map((r) => r) }; }`,
    "local helper wrapping the row": `function wrap(r: unknown) { return { data: r }; }\nexport async function f() { const row = await create({}); return wrap(row); }`,
    "local helper that itself calls the repository": `async function load() { return await create({}); }\nexport async function f() { return { type: "success", data: await load() }; }`,
    "structuredClone copy": `export async function f() { const row = await create({}); return { type: "success", data: structuredClone(row) }; }`,
    "arrow-function action": `export const f = async () => ({ type: "success", data: await create({}) });`,
    "default export": `export default async function () { return { data: await create({}) }; }`,
    "export { f } of a local": `async function f() { return { data: await create({}) }; }\nexport { f };`,
  };
  for (const [name, source] of Object.entries(faulty)) {
    it(`red: ${name}`, () => {
      expect(scan(source).length).toBeGreaterThan(0);
    });
  }

  it("a re-exported action is refused, not skipped", () => {
    const f = actionReturnFindings({ path: "actions/probe.ts", text: `"use server";\nexport { thing } from "./elsewhere";\n` });
    expect(f).toHaveLength(1);
    expect(f[0].reason).toMatch(/re-exported/);
  });
});

describe("probe 3 — the neighbouring COMPLIANT forms stay green", () => {
  const compliant: Record<string, string> = {
    "a literal of named fields": `export async function f() { const row = await create({}); return { type: "success", data: { id: row.id } }; }`,
    "a field read off the call itself": `export async function f() { return { type: "success", data: { id: (await create({})).id } }; }`,
    "destructured named fields": `export async function f() { const { id, categoryId } = await create({}); return { type: "success", data: { id, categoryId } }; }`,
    "a field used in the message": `export async function f() { const row = await create({}); return { type: "success", message: \`done \${row.id}\` }; }`,
    "type and message only": `export async function f(prevState: S) { await create({}); return { ...prevState, type: "success", message: "ok" }; }`,
    "prevState returned as is": `export async function f(prevState: S) { await create({}); return prevState; }`,
    "a value from a non-repository call": `export async function f() { const items = await scanPhoto(); return { type: "success", items }; }`,
    "map projecting named fields": `export async function f() { const rows = await findAll(); return { data: rows.map((r) => ({ id: r.id })) }; }`,
    "a local helper building a literal": `function pick(r: { id: number }) { return { id: r.id }; }\nexport async function f() { const row = await create({}); return { data: pick(row) }; }`,
    "a repository call that is not returned": `export async function f() { const row = await create({}); void row; return { type: "success" }; }`,
    "a repository call named in a comment": `export async function f() { // return { data: await create({}) }\n return { type: "success" }; }`,
    "an unexported helper that returns a row": `async function load() { return await create({}); }\nexport async function f() { await load(); return { type: "success" }; }`,
  };
  for (const [name, source] of Object.entries(compliant)) {
    it(`green: ${name}`, () => {
      expect(scan(source)).toEqual([]);
    });
  }
});

describe("probe 4 — removing a target from the domain turns the exact count red", () => {
  it("dropping one discovered file changes both exact sizes", () => {
    const without: Source[] = domain.slice(1);
    expect(without.length).not.toBe(SERVER_ACTION_FILES_EXPECTED);
    expect(without.reduce((n, s) => n + exportedActionCount(s), 0)).not.toBe(SERVER_ACTIONS_EXPECTED);
  });

  it("a file that loses its directive is no longer discovered (the directive is parsed, not matched)", () => {
    const stripped = domain[0].text.replace(/^\s*["']use server["'];?/, "");
    expect(hasUseServerDirective(ts.createSourceFile("x.ts", stripped, ts.ScriptTarget.Latest, true))).toBe(false);
    expect(serverActionSources([{ path: domain[0].path, text: stripped }])).toEqual([]);
    // ... while a mention of the words in a comment or a string is not a directive.
    expect(serverActionSources([{ path: "x.ts", text: `// "use server"\nexport const s = "use server";\n` }])).toEqual([]);
  });
});
