import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CLOSED_LIST,
  DATA_FIELDS,
  closedListKeys,
  compilerExportCounts,
  exportedActionsOf,
  functionLevelDirectiveCount,
  hasUseServerDirective,
  parseSource,
  repositorySources,
  scanServerActions,
  serverActionSources,
  type ExportedAction,
  type ReturnFinding,
  type Source,
} from "./helpers/actionReturnScan";

/**
 * Structural guarantee: what a Server Action returns is built ONLY from what the
 * closed list admits (tests/helpers/actionReturnScan.ts) — every other value is
 * red. What an exported function of a `"use server"` file returns is serialised
 * to the browser; narrowing the type of the receiving prop removes nothing.
 *
 * Targets are DISCOVERED: every source file of the tree (.ts .tsx .mts .cts .js
 * .jsx .mjs .cjs; only app/generated, node_modules, .next, .claude and .git are
 * skipped) whose parsed directive prologue holds "use server", and in each, every
 * VALUE export — an export that is not a function literal is counted and red. Two
 * exact sizes, and an independent count: the compiler's own export table of each
 * file must agree with the discovery, file by file. Not the build manifest: CI
 * runs `npm test` before `npm run build` (.github/workflows/ci.yml), so the unit
 * suite cannot read a manifest the same run has not built — and a stale local
 * .next would agree with nothing.
 *
 * Counts, recounted with THIS scan over the "use server" files read at each
 * commit (`git show <commit>:<path>`; actions with a finding / findings):
 *   - fec63b6 (main, the base of this branch): 24 files, 93 actions — 60 / 60
 *     (59 through `data`; 1, addClient's `...error`);
 *   - 455cbff (the branch's first two commits): 93 actions — 3 / 3 (getClient,
 *     getProject, addClient);
 *   - 385d7d0 (getClient / getProject moved to lib/loaders): 91 actions — 1 / 1,
 *     addClient's `...error`, then pinned as the one exception. The commit that
 *     brings this test changes no action: same count;
 *   - the commit where addClient parses its form itself (as updateClient does)
 *     instead of relaying the refusal its service THROWS: 91 actions — 0 / 0, and
 *     the exception list below is empty.
 * The first version of this scan, replayed on the same files, counts 56 at
 * fec63b6 and 0 at 385d7d0: it did not see a field of an envelope (addMaterial's
 * `data: material`, deleteMaterialCategory's `data: category`), a field outside
 * a closed list (returnLoan's `data.returnedAt`) nor a caught exception
 * (addClient). Its header announced 58 at 42f0122 (an ancestor of fec63b6, same
 * actions/): not a count of its own method either.
 */

const ROOT = process.cwd();

/** Exact sizes of the discovered domain. A new action file or action is a deliberate edit here. */
const SERVER_ACTION_FILES_EXPECTED = 24;
const SERVER_ACTIONS_EXPECTED = 91;

/** Exact size of the closed list: adding an entry is a deliberate edit here too. */
const CLOSED_LIST_EXPECTED = 25;

/**
 * Returns the scan cannot prove and that are allowed anyway. Each one is pinned
 * to the EXACT returned expression (a change to it turns the exception stale,
 * hence red), with its REASON and the CONDITION that removes it.
 */
type ReturnException = { file: string; action: string; text: string; reason: string; until: string };

// Empty since addClient parses its own form: its former exception (`{ ...prevState,
// ...error }`, the refusal service/clients.ts::createClient THROWS, relayed by
// spreading it) disappeared with the condition it named. A new entry here is a
// deliberate, argued edit — not a way to turn a red finding green.
const EXCEPTIONS: readonly ReturnException[] = [];

const EXCEPTION_KEY = (f: { file: string; action: string; text: string }) => `${f.file}::${f.action}::${f.text}`;
const excepted = new Set(EXCEPTIONS.map(EXCEPTION_KEY));
const describeFinding = (f: ReturnFinding) => `${f.file}:${f.line} ${f.action}: ${f.text}\n      <- ${f.reason}`;

/** The exports of each file, parsed (no program): what is counted. */
function listActions(sources: readonly Source[]): ExportedAction[] {
  return sources.flatMap((s) => exportedActionsOf(s.path, parseSource(s)));
}

/** Everything wrong with the domain discovered in `all`: its two exact sizes, and the compiler's export table, file by file. */
function domainProblems(all: readonly Source[]): string[] {
  const found = serverActionSources(all);
  const actions = listActions(found);
  const problems: string[] = [];
  if (found.length !== SERVER_ACTION_FILES_EXPECTED) {
    problems.push(`${found.length} "use server" files discovered, ${SERVER_ACTION_FILES_EXPECTED} expected`);
  }
  if (actions.length !== SERVER_ACTIONS_EXPECTED) problems.push(`${actions.length} exported actions, ${SERVER_ACTIONS_EXPECTED} expected`);
  const compiler = compilerExportCounts(found);
  for (const s of found) {
    const mine = actions.filter((a) => a.file === s.path).length;
    const theirs = compiler.get(s.path);
    if (mine !== theirs) problems.push(`${s.path}: ${mine} exports discovered, the compiler's export table has ${theirs}`);
  }
  return problems;
}

const sources = repositorySources(ROOT);
const domain = serverActionSources(sources);
const scanned = scanServerActions(domain);

describe("Server Actions return only what the closed list admits", () => {
  it("discovers the `\"use server\"` files at an exact size, and the compiler's export table agrees file by file", () => {
    expect(domainProblems(sources)).toEqual([]);
    expect(scanned.actions).toHaveLength(SERVER_ACTIONS_EXPECTED);
  });

  it("finds no function-level `\"use server\"` directive, in any file (an inline action the discovery would not see)", () => {
    const stray = sources.filter((s) => s.text.includes("use server") && functionLevelDirectiveCount(parseSource(s)) > 0).map((s) => s.path);
    expect(stray).toEqual([]);
  });

  it("every return of every action is admitted — exceptions aside", () => {
    const findings = scanned.findings.filter((f) => !excepted.has(EXCEPTION_KEY(f)));
    expect(findings.map(describeFinding)).toEqual([]);
  });

  it("each exception matches exactly one finding, with its reason and the condition of its disappearance", () => {
    for (const e of EXCEPTIONS) {
      const matches = scanned.findings.filter((f) => EXCEPTION_KEY(f) === EXCEPTION_KEY(e));
      expect(matches, `${EXCEPTION_KEY(e)} matches no finding any more: delete the exception`).toHaveLength(1);
      expect(e.reason.length).toBeGreaterThan(80);
      expect(e.until.length).toBeGreaterThan(40);
    }
    expect(EXCEPTIONS).toHaveLength(0);
  });

  it("every entry of the closed list admits at least one real return (none is dead), and says why", () => {
    const dead = closedListKeys().filter((k) => !scanned.used.has(k));
    expect(dead, "entries no return uses any more: remove them").toEqual([]);
    expect(CLOSED_LIST).toHaveLength(CLOSED_LIST_EXPECTED);
    for (const e of CLOSED_LIST) expect(e.reason.length, `${e.module}::${e.name}`).toBeGreaterThan(40);
    for (const [name, reason] of DATA_FIELDS) expect(reason.length, name).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// The scan itself, proved by probes — each one a throw-away "use server" file
// handed to the scan, never written to the tree.
// ---------------------------------------------------------------------------

const PROBE_HEADER = `"use server";
import { create, findAll } from "@/repository/things";
import * as repo from "@/repository/other";
import { createOrAccumulate } from "@/repository/projectMaterials";
import { createClient } from "@/service/clients";
import { prisma } from "@/lib/prisma";
import { getAccessContext } from "@/lib/accessContext";
import { uploadClientPhoto } from "@/lib/cloudinary";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { scopeRefusalMessage } from "@/lib/scopeRefusal";
import { getErrorMessage } from "@/lib/helpers";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/getLocale";
import { format } from "@/lib/i18n/format";
import { thingSchema } from "@/schemas/thing";
import { withGuard } from "@/lib/withGuard";
type S = { type: string; message: string };
`;

const probe = (body: string, path = "actions/probe.ts"): ReturnFinding[] =>
  scanServerActions([{ path, text: `${PROBE_HEADER}${body}\n` }]).findings;

describe("probe — red: the forms the first version let through", () => {
  const red: Record<string, string> = {
    "a field of an envelope, as data": `export async function f(prevState: S) { const { material } = await createOrAccumulate(); return { ...prevState, data: material }; }`,
    "a field of an envelope, elsewhere": `export async function f(prevState: S) { const { material } = await createOrAccumulate(); return { ...prevState, material }; }`,
    "res.data of a repository result": `export async function f(prevState: S) { const res = await create({}); return { ...prevState, rows: res.data }; }`,
    "data: (await createClient()).data": `export async function f() { return { data: (await createClient()).data }; }`,
    "a listed service, unlisted field": `export async function f() { return { type: "success", client: (await createClient()).data }; }`,
    "a listed service, spread whole": `export async function f() { return { ...(await createClient()) }; }`,
    "prisma imported directly, as data": `export async function f() { return { data: await prisma.thing.findFirst() }; }`,
    "prisma imported directly, elsewhere": `export async function f() { return { type: "success", row: await prisma.thing.findFirst() }; }`,
    "a lib/ reader (the access configuration), as data": `export async function f() { return { data: await getAccessContext() }; }`,
    "a lib/ reader, elsewhere": `export async function f() { return { type: "success", ctx: await getAccessContext() }; }`,
    "a lib/cloudinary result (its URL)": `export async function f(prevState: S, formData: FormData) { const url = await uploadClientPhoto(formData.get("photo")); return { ...prevState, message: url }; }`,
    "a mutation: out.data = row": `export async function f() { const out: Record<string, unknown> = { type: "success" }; const row = await create({}); out.data = row; return out; }`,
    "a mutation: out.extra = row": `export async function f() { const out: Record<string, unknown> = { type: "success" }; out.extra = await create({}); return out; }`,
    "a mutation: Object.assign": `export async function f() { const out = { type: "success" }; Object.assign(out, await create({})); return out; }`,
    "a mutation by a local helper": `function fill(o: Record<string, unknown>, r: unknown) { o.extra = r; }\nexport async function f() { const out = { type: "success" }; fill(out, await create({})); return out; }`,
    "an alias, then written": `export async function f() { const out: Record<string, unknown> = { type: "success" }; const alias = out; alias.extra = await create({}); return out; }`,
    "for…of over a repository result": `export async function f() { for (const row of await findAll()) { return { type: "success", message: row.name }; } return { type: "error" }; }`,
    "rows[0]": `export async function f() { const rows = await findAll(); return { type: "success", first: rows[0] }; }`,
    "a helper declared inside the action": `export async function f() { const load = async () => findAll(); return { type: "success", rows: await load() }; }`,
    "a template literal": `export async function f() { const row = await create({}); return { type: "success", message: \`\${row.email}\` }; }`,
    "a template literal of JSON.stringify": `export async function f() { const row = await create({}); return { type: "success", message: \`\${JSON.stringify(row)}\` }; }`,
    "a push in a loop": `export async function f() { const out: unknown[] = []; for (const r of await findAll()) out.push(r); return { type: "success", rows: out }; }`,
    "Object.entries": `export async function f() { const row = await create({}); return { type: "success", pairs: Object.entries(row) }; }`,
    "Object.fromEntries": `export async function f() { const row = await create({}); return { type: "success", copy: Object.fromEntries(Object.entries(row)) }; }`,
    "the original faulty form": `export async function f(prevState: S) { const thing = await create({}); return { ...prevState, type: "success", message: "ok", data: thing }; }`,
    "a namespace import": `export async function f() { return { type: "success", removed: await repo.remove(1) }; }`,
    "a local helper wrapping the row in data": `function wrap(r: unknown) { return { type: "success", data: r }; }\nexport async function f() { const row = await create({}); return wrap(row); }`,
    "the guard result as a whole (it carries the actor's e-mail)": `export async function f() { const roleCheck = await requireCapability("content.edit"); return roleCheck; }`,
    "a guard result's e-mail": `export async function f() { const roleCheck = await requireCapability("content.edit"); return { type: "success", message: roleCheck.email }; }`,
    "a caught exception spread": `export async function f(prevState: S) { try { await create({}); return prevState; } catch (error) { return { ...prevState, ...error }; } }`,
    "an unresolved global (process.env)": `export async function f() { return { type: "success", message: process.env.SECRET }; }`,
    "a literal in data (data reads named fields only)": `export async function f() { return { type: "success", data: { id: 42 } }; }`,
    "an unlisted name in data": `export async function f() { const row = await create({}); return { type: "success", data: { email: row.email } }; }`,
    "data that is not a literal": `export async function f() { const data = { id: 1 }; return { type: "success", data }; }`,
    "a schema parsing a row": `export async function f() { const parsed = thingSchema.safeParse(await create({})); return { type: "success", parsed }; }`,
    "a map callback returning the row": `export async function f() { const rows = await findAll(); return { type: "success", rows: rows.map((r) => r) }; }`,
    "an export wrapped in a call": `export const f = withGuard(async () => ({ data: await findAll() }));`,
    "an export bound to another function": `async function g() { return { type: "success" }; }\nexport const f = g;`,
    "an exported constant": `export const LIMIT = 3;`,
    "a default export": `export default async function () { return { type: "success", rows: await findAll() }; }`,
    "export { f } of a local": `async function f() { return { type: "success", rows: await findAll() }; }\nexport { f };`,
    "a re-export": `export { thing } from "./elsewhere";`,
  };
  for (const [name, body] of Object.entries(red)) {
    it(`red: ${name}`, () => {
      expect(probe(body).length, name).toBeGreaterThan(0);
    });
  }

  // Found green by a second review of this scan, before it was ever committed: each one a definition or a
  // write the first fail-closed draft did not see. Kept as probes so that they stay closed.
  const reviewRed: Record<string, string> = {
    "a destructuring assignment": `export async function f() { let message = "ok"; ({ message } = await create({})); return { type: "success", message }; }`,
    "an array destructuring assignment": `export async function f() { let a: unknown; [a] = await findAll(); return { type: "success", a }; }`,
    "for (x of rows) on an x declared earlier": `export async function f() { let x: unknown; for (x of await findAll()) { break; } return { type: "success", x }; }`,
    "getErrorMessage given a row, not a caught exception": `export async function f() { const row = await create({}); return { type: "error", message: getErrorMessage(row, "fallback") }; }`,
    "scopeRefusalMessage given a row, not a guard result": `export async function f() { const row = await create({}); return { type: "error", message: scopeRefusalMessage(row, "x") }; }`,
    "handed to a built-in that writes into it": `export async function f() { const out: unknown[] = []; Array.prototype.push.call(out, await create({})); return { type: "success", out }; }`,
    "handed to Object.assign through an alias": `export async function f() { const assign = Object.assign; const out = {}; assign(out, await create({})); return { type: "success", out }; }`,
    "a write through a for…of variable": `export async function f(input: { items: { x?: unknown }[] }) { const out = input.items; for (const r of out) r.x = await create({}); return { type: "success", out }; }`,
    "a write through a forEach callback": `export async function f(input: { items: { x?: unknown }[] }) { const out = input.items; const row = await create({}); out.forEach((r) => { r.x = row; }); return { type: "success", out }; }`,
    "a write through a destructured member": `export async function f(input: { items: unknown[] }) { const out = { items: input.items }; const { items } = out; items.push(await create({})); return { type: "success", out }; }`,
    "a write through a member alias": `export async function f(input: { items: unknown[] }) { const out = { items: input.items }; const items = out.items; items.push(await create({})); return { type: "success", out }; }`,
    "a write by a helper through a destructured parameter": `function fill({ items }: { items: unknown[] }, r: unknown) { items.push(r); }\nexport async function f(input: { items: unknown[] }) { const out = { items: input.items }; fill(out, await create({})); return { type: "success", out }; }`,
    "a write by a helper through arguments": `function fill() { const [o, r] = [arguments[0], arguments[1]]; o.x = r; }\nexport async function f() { const out = { type: "success" }; fill(out, await create({})); return out; }`,
  };
  for (const [name, body] of Object.entries(reviewRed)) {
    it(`red: ${name}`, () => {
      expect(probe(body).length, name).toBeGreaterThan(0);
    });
  }

  it("red, and fast: a recursive helper is cut by the depth limit instead of being trusted", () => {
    // The scan does not evaluate `n > 0`: every recursive call is entered, so recursion always ends here.
    const started = Date.now();
    const findings = probe(`function deep(n: number): unknown { return n > 0 ? { a: deep(n - 1), b: deep(n - 1) } : null; }
export async function f() { return { type: "success", tree: deep(3) }; }`);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toMatch(/too deep to follow/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("red, and fast: helpers whose work explodes without recursion are cut by the step budget", () => {
    // 18 distinct helpers, each calling the previous one twice: 2^17 calls, all admitted, within the depth limit.
    const helpers = Array.from({ length: 18 }, (_, i) =>
      i === 0 ? `function h0() { return null; }` : `function h${i}() { return { a: h${i - 1}(), b: h${i - 1}() }; }`
    ).join("\n");
    const started = Date.now();
    const findings = probe(`${helpers}\nexport async function f() { return { type: "success", tree: h17() }; }`);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toMatch(/too complex to follow \(step budget\)/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("red: a `.js` action file, with a relative import of a repository", () => {
    const findings = scanServerActions([
      { path: "actions/probe.js", text: `"use server";\nimport { findAll } from "../repository/things";\nexport async function f() { return { type: "success", rows: await findAll() }; }\n` },
    ]).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toMatch(/repository\/things::findAll, which is not in the closed list/);
  });
});

describe("probe — green: the admitted forms stay admitted", () => {
  const green: Record<string, string> = {
    "prevState, type and a dictionary message": `export async function f(prevState: S) { const t = getDictionary(await getLocale()); const message = t.things.done; await create({}); return { ...prevState, type: "success", message }; }`,
    "data: { id: row.id }": `export async function f() { const row = await create({}); return { type: "success", data: { id: row.id } }; }`,
    "data: { categoryId } destructured": `export async function f() { const { categoryId } = await create({}); return { type: "success", data: { categoryId } }; }`,
    "a guard refusal, spread and returned": `export async function f(prevState: S) { const roleCheck = await requireCapability("content.edit"); if (roleCheck.error) return { ...prevState, ...roleCheck.error }; return roleCheck.error; }`,
    "prevState returned as is": `export async function f(prevState: S) { await create({}); return prevState; }`,
    "an identifier assigned a state": `export async function f(prevState: S) { let result: S; await create({}); result = { ...prevState, type: "success", message: "ok" }; return result; }`,
    "getErrorMessage in a catch": `export async function f(prevState: S) { const t = getDictionary(await getLocale()); try { await create({}); return prevState; } catch (error) { return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) }; } }`,
    "format with a local counter": `export async function f() { const t = getDictionary(await getLocale()); let n = 0; for (const r of await findAll()) { void r; n++; } return { type: "success", message: format(t.things.created, { count: n }) }; }`,
    "the parsed input echoed": `export async function f(prevState: S, formData: FormData) { const parsed = thingSchema.safeParse(formData.get("name")); if (!parsed.success) return { ...prevState, type: "zodError" }; return { ...prevState, type: "success", name: parsed.data.name }; }`,
    "a local helper building a state": `function refused(message: string) { return { type: "error", message }; }\nexport async function f() { const t = getDictionary(await getLocale()); return refused(t.errors.invalidId); }`,
    "a listed field of a listed service": `export async function f(prevState: S) { const created = await createClient({}); return { ...prevState, type: "success", message: created.message }; }`,
    "a repository call that is not returned": `export async function f() { const row = await create({}); void row; return { type: "success" }; }`,
    "a repository call named in a comment": `export async function f() { // return { data: await create({}) }\n return { type: "success" }; }`,
    "scopeRefusalMessage given the guard result": `export async function f() { const scopeCheck = await requireProjectAccess(1); if (scopeCheck.error) return { type: "error", message: scopeRefusalMessage(scopeCheck, "invalid") }; return { type: "success" }; }`,
    "a destructuring assignment of admitted values": `export async function f() { const t = getDictionary(await getLocale()); let message = "x"; ({ message } = { message: t.things.done }); return { type: "success", message }; }`,
    "an alias written with admitted values": `export async function f() { const out: Record<string, unknown> = { type: "success" }; const alias = out; alias.message = "ok"; return out; }`,
    "a callback writing admitted values": `export async function f(input: { items: { x?: string }[] }) { const out = input.items; out.forEach((r) => { r.x = "ok"; }); return { type: "success", out }; }`,
  };
  for (const [name, body] of Object.entries(green)) {
    it(`green: ${name}`, () => {
      expect(probe(body).map((f) => f.reason), name).toEqual([]);
    });
  }
});

describe("probe — discovery: losing a target turns the exact count red", () => {
  const DIRECTIVE = '"use server";';
  const victim = domain.find((s) => s.text.startsWith(DIRECTIVE));

  it("a real file that loses its directive leaves the domain, and both exact sizes say so", () => {
    expect(victim).toBeDefined();
    const mutated = sources.map((s) => (s.path === victim?.path ? { ...s, text: s.text.slice(DIRECTIVE.length) } : s));
    const problems = domainProblems(mutated);
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringMatching(/"use server" files discovered/), expect.stringMatching(/exported actions, \d+ expected/)])
    );
  });

  it("a real action that loses its `export` keyword is no longer counted, and the exact size says so", () => {
    const EXPORTED = "export async function ";
    const mutated = sources.map((s) => {
      if (s.path !== victim?.path) return s;
      const at = s.text.indexOf(EXPORTED);
      return { ...s, text: s.text.slice(0, at) + "async function " + s.text.slice(at + EXPORTED.length) };
    });
    expect(domainProblems(mutated)).toEqual([expect.stringMatching(/exported actions, \d+ expected/)]);
  });

  it("an export only the discovery counts (a star re-export) breaks the agreement with the compiler", () => {
    const extra: Source = { path: "actions/probe-star.ts", text: `"use server";\nexport * from "./elsewhere";\n` };
    expect(domainProblems([...sources, extra])).toEqual(
      expect.arrayContaining([expect.stringMatching(/actions\/probe-star\.ts: 1 exports discovered, the compiler's export table has 0/)])
    );
  });

  it("walks .js and .mjs files and skips only app/generated (not every `generated` folder), node_modules, .next, .claude and .git", () => {
    const root = mkdtempSync(join(tmpdir(), "action-scan-probe-"));
    try {
      const files: Record<string, string> = {
        "actions/a.ts": `"use server";\nexport async function a() { return null; }\n`,
        "lib/b.js": `"use server";\nexport async function b() { return null; }\n`,
        "scripts/c.mjs": `"use server";\nexport async function c() { return null; }\n`,
        "lib/generated/d.ts": `"use server";\nexport async function d() { return null; }\n`,
        "x/.hidden/e.tsx": `"use server";\nexport async function e() { return null; }\n`,
        "app/generated/prisma/f.ts": `"use server";\nexport async function f() { return null; }\n`,
        "node_modules/g/index.ts": `"use server";\nexport async function g() { return null; }\n`,
        ".next/server/h.js": `"use server";\nexport async function h() { return null; }\n`,
        ".claude/worktrees/x/i.ts": `"use server";\nexport async function i() { return null; }\n`,
        ".git/j.ts": `"use server";\nexport async function j() { return null; }\n`,
        "lib/plain.ts": `export const plain = 1;\n`,
      };
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
      }
      const found = serverActionSources(repositorySources(root)).map((s) => s.path).sort();
      expect(found).toEqual(["actions/a.ts", "lib/b.js", "lib/generated/d.ts", "scripts/c.mjs", "x/.hidden/e.tsx"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the directive is parsed, not matched: a file without it is not discovered, a mention in a comment is not a directive", () => {
    expect(victim).toBeDefined();
    const stripped = victim ? victim.text.slice(DIRECTIVE.length) : "";
    expect(hasUseServerDirective(parseSource({ path: "x.ts", text: stripped }))).toBe(false);
    expect(serverActionSources([{ path: "x.ts", text: `// "use server"\nexport const s = "use server";\n` }])).toEqual([]);
  });
});
