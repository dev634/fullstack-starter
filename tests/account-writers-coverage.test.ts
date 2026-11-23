import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sourceFilesIn } from "./helpers/astScan";
import {
  accountActionsIn,
  hasComparisonWith,
  hasLiteralProperty,
  localGuardPolicySymbols,
  repositoryFunctionText,
  repositoryWriters,
  userWriteSites,
  type Source,
} from "./helpers/accountWriterScan";

/**
 * Structural guarantee: every exported server action that WRITES an account
 * (a `User`, a `JobFunction`, a `PasswordResetToken`) applies THE rule that
 * closes the relay for it — and the actions are DISCOVERED from their writes,
 * not named.
 *
 * Until lot 5a this test held an action "guarded" as soon as it called ANY
 * export of lib/accountPolicy (already true with `canManageAccount` alone, which
 * is a role check, not the relay rule), and recognised `refuseIfHeldByAdmin` by
 * its name (an emptied body stayed green). It now demands, PER ACTION, the
 * symbol of the rule (REQUIRED_RULE, any-of), resolved by BINDING to
 * lib/accountPolicy, and for a local guard that the guard ITSELF reaches the
 * rule. The exemptions' claims are read in the CODE (parsed), never in a comment.
 *
 * Method — two layers, both parsed (tests/helpers/accountWriterScan.ts), never
 * grepped:
 *   1. a repository WRITER = an exported function of any `repository/*.ts`
 *      whose body (local helpers followed) calls `prisma.<m>.<write>` or
 *      `tx.<m>.<write>` with <m> in {user, jobFunction, passwordResetToken}
 *      (the client must be named `prisma` or `tx`: a writer through another
 *      name is invisible to the scan, which is why repository/users.ts names its
 *      transaction parameter `tx`);
 *   2. an ACTION = an exported function of `actions/**` that reaches a writer
 *      by MODULE PATH and by BINDING (aliased named import, `import * as ns`),
 *      local helpers followed. A dynamic import of a repository module is
 *      banned: the scan cannot follow it.
 *
 * Counted at d4594e9 + the lot 5a working tree: 13 writers in 4 repository
 * files (users 7, jobFunctions 4, contacts 1, clients 1) and 13 actions in 7
 * action files — 7 apply the relay rule (REQUIRED_RULE), 6 are exempt. The
 * sizes are EXACT, below. Not seen by construction: a write by nested relation
 * (`contact.update({ data: { user: { create } } })` — none exists), raw SQL (the
 * only `$queryRaw` of repository/ is a SELECT ... FOR UPDATE), and a writer passed
 * as a value instead of called.
 */

const ROOT = process.cwd();
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");
const read = (dir: string): Source[] =>
  sourceFilesIn(join(ROOT, dir), [".ts"]).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));

/** Local guards: applied by name inside an action file, so they must themselves reach the rule (REQUIRED_LOCAL). */
const LOCAL_GUARDS: ReadonlySet<string> = new Set(["refuseIfHeldByAdmin"]);

/** What a local guard must itself reach of lib/accountPolicy (any of). */
const REQUIRED_LOCAL: readonly string[] = ["mayChangeHeldFunction"];

const M = "mayManageAccountWithFunction";
const H = "mayChangeHeldFunction";
const P = "mayProvisionPortalLogin";

/**
 * The relay rule each action must reach, by symbol (any of the list). A role
 * check (`canAssignRole`, `canManageAccount`) is NOT the relay rule.
 */
const REQUIRED_RULE: Record<string, readonly string[]> = {
  "actions/users/users.ts::addUser": [M],
  "actions/users/users.ts::updateUser": [M],
  "actions/users/users.ts::deleteUser": [M],
  "actions/users/users.ts::setUserProjectAssignments": [M],
  "actions/jobFunctions/jobFunctions.ts::saveFunctionConfig": [H],
  "actions/jobFunctions/jobFunctions.ts::deleteJobFunction": [H],
  "actions/portal/portal.ts::createPortalLogin": [P],
};

/**
 * A fact about the code an exemption rests on. `check` runs on the PARSED text
 * of `fn` in `file` (comments are not code).
 */
type Claim = { file: string; fn: string; what: string; check: (code: string) => boolean };
const CLAIMS: Record<string, Claim> = {
  "createPortalLogin-makes-only-CLIENT": {
    file: "actions/portal/portal.ts",
    fn: "createPortalLogin",
    what: 'creates the login with role: "CLIENT"',
    check: (c) => hasLiteralProperty(c, "role", "CLIENT"),
  },
  "updateUser-never-makes-or-unmakes-CLIENT": {
    file: "actions/users/users.ts",
    fn: "updateUser",
    what: 'compares a role to "CLIENT" (refuses both directions)',
    check: (c) => hasComparisonWith(c, "CLIENT"),
  },
  "contacts.remove-deletes-only-CLIENT": {
    file: "repository/contacts.ts",
    fn: "remove",
    what: 'deletes the linked login only with role: "CLIENT"',
    check: (c) => hasLiteralProperty(c, "role", "CLIENT"),
  },
  "clients.permanentlyRemove-deletes-only-CLIENT": {
    file: "repository/clients.ts",
    fn: "permanentlyRemove",
    what: 'deletes the contacts\' logins only with role: "CLIENT"',
    check: (c) => hasLiteralProperty(c, "role", "CLIENT"),
  },
};

/**
 * Actions that write an account WITHOUT the relay rule. Each carries WHY it is
 * not a lever and WHEN the exemption must go; `claims` name what the reason
 * rests on, re-checked in the code below.
 */
const EXEMPT: Record<string, { reason: string; until: string; claims?: string[] }> = {
  "actions/auth/auth.ts::requestPasswordReset": {
    reason: "the reset link goes to the account's own mailbox, never back to the caller",
    until: "the link is ever shown to, or sent on behalf of, someone other than the account",
  },
  "actions/auth/auth.ts::resetPassword": {
    reason:
      "guarded by the emailed single-use token; the caller IS the account's owner. A token can also be minted for a CLIENT login by createPortalLogin, which applies the portal rule (mayProvisionPortalLogin) and creates only CLIENT accounts; a CLIENT is neither promoted nor made by updateUser",
    until: "a reset token can be minted for the caller to hand over by another action (createResetToken exposed to an action other than requestPasswordReset and createPortalLogin), or updateUser may change a CLIENT's role",
    claims: ["createPortalLogin-makes-only-CLIENT", "updateUser-never-makes-or-unmakes-CLIENT"],
  },
  "actions/jobFunctions/jobFunctions.ts::addJobFunction": {
    reason: "a new function constrains nobody; assigning it goes through the account policy (addUser / updateUser)",
    until: "create() takes a hiddenAreas / holders argument",
  },
  "actions/jobFunctions/jobFunctions.ts::reorderJobFunctions": {
    reason: "writes the position only",
    until: "reorder() writes anything but `position`",
  },
  "actions/contacts/contacts.ts::deleteContact": {
    reason: "contacts.remove deletes the linked login only while it is still CLIENT: it never frees a restricted account",
    until: "repository/contacts.ts::remove stops filtering on role CLIENT",
    claims: ["contacts.remove-deletes-only-CLIENT"],
  },
  "actions/clients/clients.ts::permanentlyDeleteClient": {
    reason: "clients.permanentlyRemove deletes the contacts' logins only while they are still CLIENT",
    until: "repository/clients.ts::permanentlyRemove stops filtering on role CLIENT",
    claims: ["clients.permanentlyRemove-deletes-only-CLIENT"],
  },
};

const EXPECTED_WRITERS = 13;
const EXPECTED_ACTIONS = 13;

function discover(repos: Source[], actions: Source[]) {
  const writers = new Set(repos.flatMap(repositoryWriters));
  const results = actions.map((a) => ({ src: a, ...accountActionsIn(a, writers, LOCAL_GUARDS) }));
  const reports = results.flatMap((r) => r.reports);
  const dynamic = results.flatMap((r) => r.dynamicRepositoryImports.map((m) => `${r.src.path} -> ${m}`));
  return { writers, reports, dynamic };
}

/** The violations, as readable lines. */
function violations(
  repos: Source[],
  actions: Source[],
  exempt: typeof EXEMPT,
  required: Record<string, readonly string[]>
): string[] {
  const { reports, dynamic } = discover(repos, actions);
  const out: string[] = dynamic.map((d) => `dynamic import of a repository module (not followed): ${d}`);
  for (const r of reports) {
    const rule = required[r.action];
    if (rule) {
      if (!rule.some((symbol) => r.policySymbols.includes(symbol))) {
        out.push(`${r.action} writes an account (${r.writers.join(", ")}) but never reaches ${rule.join(" / ")} from lib/accountPolicy`);
      }
      continue;
    }
    const ex = exempt[r.action];
    if (!ex) out.push(`${r.action} writes an account (${r.writers.join(", ")}) with no required rule and no exemption`);
    else if (!ex.reason.trim() || !ex.until.trim()) out.push(`${r.action}: an exemption needs a reason and a condition of disappearance`);
  }
  // A local guard is trusted by what it DOES, not by its name.
  for (const src of actions) {
    for (const guard of LOCAL_GUARDS) {
      const reached = localGuardPolicySymbols(src, guard);
      if (reached && !REQUIRED_LOCAL.some((symbol) => reached.includes(symbol))) {
        out.push(`${src.path}::${guard} never reaches ${REQUIRED_LOCAL.join(" / ")} from lib/accountPolicy`);
      }
    }
  }
  return out;
}

describe("every action that writes an account applies the relay rule", () => {
  const repos = read("repository");
  const actions = read("actions");
  const found = discover(repos, actions);

  it("the discovered domain has its EXACT size (a removed writer or action must turn this red)", () => {
    expect(found.writers.size).toBe(EXPECTED_WRITERS);
    expect(found.reports.length).toBe(EXPECTED_ACTIONS);
  });

  it("each action reaches ITS rule (or is exempt with a reason and a condition)", () => {
    expect(violations(repos, actions, EXEMPT, REQUIRED_RULE)).toEqual([]);
  });

  it("the rule table and the exemptions name exactly the discovered actions (a stale entry certifies nothing)", () => {
    const names = found.reports.map((r) => r.action);
    expect(Object.keys(REQUIRED_RULE).filter((a) => !names.includes(a))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((a) => !names.includes(a))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((a) => a in REQUIRED_RULE)).toEqual([]);
    expect(names.filter((a) => !(a in REQUIRED_RULE) && !(a in EXEMPT))).toEqual([]);
  });

  it("each exemption's claims are still true of the CODE they rest on", () => {
    const all = [...repos, ...actions];
    for (const [action, ex] of Object.entries(EXEMPT)) {
      for (const id of ex.claims ?? []) {
        const claim = CLAIMS[id];
        expect(claim, `${action}: unknown claim ${id}`).toBeDefined();
        const src = all.find((s) => s.path === claim?.file);
        const text = src ? repositoryFunctionText(src, claim?.fn ?? "") : "";
        expect(text, `${action}: ${claim?.file}::${claim?.fn} not found`).not.toBe("");
        expect(claim?.check(text), `${action}: ${claim?.file}::${claim?.fn} no longer ${claim?.what}`).toBe(true);
      }
    }
  });
});

// --- Probes, on planted SOURCES (in memory: the tree is not touched) --------
describe("the scan itself is proven by probes", () => {
  const repos: Source[] = [
    {
      path: "repository/users.ts",
      text: `import { prisma } from "@/lib/prisma";
        export async function create(d: unknown) { return prisma.user.create({ data: d }); }
        export async function removeWithHelper(id: number) { return helper(id); }
        async function helper(id: number) { return prisma.$transaction(async (tx) => tx.user.delete({ where: { id } })); }
        export async function read(id: number) { return prisma.user.findUnique({ where: { id } }); }`,
    },
  ];
  const baseline = (text: string, path = "actions/x/x.ts"): Source[] => [{ path, text }];
  const REQ = { "actions/x/x.ts::a": ["mayManageAccountWithFunction"] } as const;
  const run = (text: string, required: Record<string, readonly string[]> = REQ) => violations(repos, baseline(text), {}, required);

  it("discovers writers through a local helper, and ignores reads", () => {
    expect(repositoryWriters(repos[0]!).sort()).toEqual(["repository/users.ts::create", "repository/users.ts::removeWithHelper"]);
  });

  it("probe 1 — an action without any guard is RED", () => {
    expect(run(`import { create } from "@/repository/users";
      export async function a() { return create({}); }`)).toHaveLength(1);
  });

  it("probe 1b — a ROLE check alone, without the relay rule, is RED (what the old test accepted)", () => {
    expect(run(`import { create } from "@/repository/users";
      import { canAssignRole } from "@/lib/accountPolicy";
      export async function a() { canAssignRole("ADMIN", "EDITOR"); return create({}); }`)).toHaveLength(1);
  });

  it("probe 2 — an ALIASED import of a writer, by a relative path, in a new action, is RED (no rule, no exemption)", () => {
    expect(run(`import { create as mint } from "../../repository/users";
      export async function a() { return mint({}); }`, {})).toHaveLength(1);
  });

  it("probe 2b — a namespace import, and a writer reached through a local helper, are RED", () => {
    expect(run(`import * as u from "@/repository/users";
      export async function a() { return u.create({}); }`)).toHaveLength(1);
    expect(run(`import { removeWithHelper } from "@/repository/users";
      async function inner() { return removeWithHelper(1); }
      export async function a() { return inner(); }`)).toHaveLength(1);
  });

  it("probe 2c — a dynamic import of a repository module is RED (a form the scan cannot follow)", () => {
    expect(run(`export async function a() { const m = await import("@/repository/users"); return m.create({}); }`)).toHaveLength(1);
  });

  it("probe 3 — the correct forms stay GREEN: the rule direct, aliased, namespaced, via a local helper", () => {
    expect(run(`import { create } from "@/repository/users";
      import { mayManageAccountWithFunction } from "@/lib/accountPolicy";
      export async function a() { mayManageAccountWithFunction({ role: "ADMIN", hiddenAreas: new Set() }, []); return create({}); }`)).toEqual([]);
    expect(run(`import { create as mint } from "../../repository/users";
      import { mayManageAccountWithFunction as may } from "../../lib/accountPolicy";
      async function check() { return may({ role: "ADMIN", hiddenAreas: new Set() }, []); }
      export async function a() { await check(); return mint({}); }`)).toEqual([]);
    expect(run(`import { create } from "@/repository/users";
      import * as policy from "@/lib/accountPolicy";
      export async function a() { policy.mayManageAccountWithFunction({ role: "ADMIN", hiddenAreas: new Set() }, []); return create({}); }`)).toEqual([]);
  });

  it("probe 3b — an action that only READS, or imports a writer it never calls, is not in the domain", () => {
    expect(run(`import { read, create } from "@/repository/users";
      export async function a() { return read(1); }`)).toEqual([]);
  });

  it("probe 3c — the rule imported from somewhere else, and a comment naming it, are still RED", () => {
    expect(run(`import { create } from "@/repository/users";
      import { mayManageAccountWithFunction } from "@/lib/capabilities";
      export async function a() { mayManageAccountWithFunction(); return create({}); }`)).toHaveLength(1);
    expect(run(`import { create } from "@/repository/users";
      // mayManageAccountWithFunction from "@/lib/accountPolicy"
      export async function a() { return create({}); }`)).toHaveLength(1);
  });

  it("probe 4 — a writer removed from the domain changes the count (the exact size turns red)", () => {
    const without: Source[] = [{ path: "repository/users.ts", text: `export async function create() { return 1; }` }];
    expect(repositoryWriters(without[0]!)).toHaveLength(0);
    expect(repositoryWriters(repos[0]!)).toHaveLength(2);
  });

  it("probe 5 — a local guard whose body was EMPTIED is RED, even though the action calls it", () => {
    const text = `import { create } from "@/repository/users";
      import { mayChangeHeldFunction } from "@/lib/accountPolicy";
      async function refuseIfHeldByAdmin() { return null; }
      export async function a() { await refuseIfHeldByAdmin(); return create({}); }`;
    expect(run(text, { "actions/x/x.ts::a": ["mayChangeHeldFunction"] })).not.toEqual([]);
  });

  it("probe 5b — a local guard that reaches the rule (directly or through a helper) is GREEN", () => {
    const text = `import { create } from "@/repository/users";
      import { mayChangeHeldFunction } from "@/lib/accountPolicy";
      function decide() { return mayChangeHeldFunction({ role: "ADMIN", hiddenAreas: new Set() }, [], null); }
      async function refuseIfHeldByAdmin() { return decide() ? null : "no"; }
      export async function a() { await refuseIfHeldByAdmin(); return create({}); }`;
    expect(run(text, { "actions/x/x.ts::a": ["mayChangeHeldFunction"] })).toEqual([]);
  });

  it("probe 6 — a claim written only in a COMMENT is not code; the same claim in code is", () => {
    expect(hasLiteralProperty(`{ // role: "CLIENT"\n return create({ data: { email } }); }`, "role", "CLIENT")).toBe(false);
    expect(hasLiteralProperty(`{ /* role: "CLIENT" */ return 1; }`, "role", "CLIENT")).toBe(false);
    expect(hasLiteralProperty(`{ return create({ data: { role: "CLIENT" } }); }`, "role", "CLIENT")).toBe(true);
    expect(hasComparisonWith(`{ // x.role === "CLIENT"\n return 1; }`, "CLIENT")).toBe(false);
    expect(hasComparisonWith(`{ if ((t.role === "CLIENT") !== (r === "CLIENT")) return 1; }`, "CLIENT")).toBe(true);
  });

  it("an exemption without a reason or a condition is refused", () => {
    const text = `import { create } from "@/repository/users";
      export async function a() { return create({}); }`;
    const v = violations(repos, baseline(text), { "actions/x/x.ts::a": { reason: " ", until: "x" } }, {});
    expect(v).toHaveLength(1);
  });
});

// --- Lot 3: whoever writes the password or the role bumps sessionVersion ------
//
// lib/sessionGate.ts voids a token whose sessionVersion differs from the row's;
// the role has its own comparison there (it covers every writer of the role by
// construction), but the PASSWORD is covered only by the bump. A writer of
// `User.password` that forgets `sessionVersion: { increment: 1 }` leaves a
// stolen cookie valid after the reset — and nothing else would show it.
//
// DISCOVERED from the write calls (parsed, not grepped, no list of files): every
// `prisma.user.<w>()` / `tx.user.<w>()` (and a nested `user: { … }` inside the
// data of a write on another model) in every source file of the tree outside
// tests, generated code and docs. A write whose data carries `password` or
// `role` — explicitly, or through a spread / object the scan cannot read —
// must carry `sessionVersion: { increment: 1 }` in the SAME data object.
//
// Counted at the lot 3 commit (the commit that introduced this block): 8 write
// sites, of which 2 write credentials (repository/users.ts::updateProfile and
// ::updatePassword); the other six are 1 create, 4 seed upserts (a `create`
// branch plus an empty `update: {}`) and setUserProjects (relation only). The
// sizes are EXACT, below.
const SESSION_BUMP_EXEMPT: Record<string, { reason: string; until: string }> = {
  create: {
    reason:
      "a create (or the create branch of an upsert) writes a NEW row: it starts at the column default 0 and no earlier session exists to kill. The update branch of an upsert is still checked",
    until: "a create can land on an account that already had sessions (ids are autoincrement and never reused today)",
  },
};

const EXPECTED_USER_WRITE_SITES = 8;
const EXPECTED_CREDENTIAL_WRITERS = ["repository/users.ts::updatePassword#update", "repository/users.ts::updateProfile#update"];

const SCAN_EXCLUDED_DIRS: ReadonlySet<string> = new Set(["tests", "tests-integration", "node_modules", ".claude", ".next", ".git", "docs", "public", "deploy"]);
const SCAN_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"] as const;

/** Every application source file of the tree (root files included), by walking it — never by a list. */
function allApplicationSources(): Source[] {
  const files: string[] = [];
  for (const name of readdirSync(ROOT)) {
    const full = join(ROOT, name);
    if (statSync(full).isDirectory()) {
      if (!SCAN_EXCLUDED_DIRS.has(name)) files.push(...sourceFilesIn(full, SCAN_EXTENSIONS));
    } else if (SCAN_EXTENSIONS.some((ext) => name.endsWith(ext))) files.push(full);
  }
  return files
    .map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }))
    .filter((f) => !f.path.startsWith("app/generated/") && !f.path.endsWith(".d.ts"));
}

/** The violations, as readable lines. */
function bumpViolations(sources: Source[], exempt = SESSION_BUMP_EXEMPT): string[] {
  const out: string[] = [];
  for (const [id, ex] of Object.entries(exempt)) {
    if (!ex.reason.trim() || !ex.until.trim()) out.push(`exemption ${id} needs a reason and a condition of disappearance`);
  }
  for (const site of sources.flatMap(userWriteSites)) {
    if (site.createOnly) continue; // exempt: "create"
    if (site.writesCredentials && !site.bumps) {
      out.push(`${site.site} writes the password or the role (or data the scan cannot read) without sessionVersion: { increment: 1 } in the same data`);
    }
  }
  return out;
}

describe("every writer of User.password / User.role bumps sessionVersion in the same statement", () => {
  const sources = allApplicationSources();
  const sites = sources.flatMap(userWriteSites);

  it("the discovered domain has its EXACT size (a removed writer turns this red)", () => {
    expect(sites.length).toBe(EXPECTED_USER_WRITE_SITES);
    expect(sites.filter((s) => s.writesCredentials).map((s) => s.site).sort()).toEqual(EXPECTED_CREDENTIAL_WRITERS);
  });

  it("each of them carries the bump (a create is exempt, with a reason and a condition)", () => {
    expect(bumpViolations(sources)).toEqual([]);
  });

  describe("probes, on planted sources", () => {
    const planted = (text: string): Source[] => [{ path: "repository/probe.ts", text: `import { prisma } from "@/lib/prisma";\n${text}` }];

    it("probe a — a password write WITHOUT the bump is RED", () => {
      expect(
        bumpViolations(planted(`export async function updatePassword(id: number, h: string) { return prisma.user.update({ where: { id }, data: { password: h } }); }`))
      ).toHaveLength(1);
    });

    it("probe b — a role writer in the NEIGHBOURING forms (local const, shorthand) without the bump is RED", () => {
      expect(bumpViolations(planted(`export async function f(id: number) { const data = { role: "VIEWER" }; return prisma.user.update({ where: { id }, data }); }`))).toHaveLength(1);
      expect(bumpViolations(planted(`export async function f(id: number) { const payload = { role: "VIEWER" }; return prisma.user.update({ where: { id }, data: payload }); }`))).toHaveLength(1);
      expect(bumpViolations(planted(`export async function f(id: number, role: string) { return prisma.user.update({ where: { id }, data: { role } }); }`))).toHaveLength(1);
    });

    it("probe b2 — data the scan cannot read (a parameter, a spread of one) is RED, never assumed safe", () => {
      expect(bumpViolations(planted(`export async function f(id: number, d: object) { return prisma.user.update({ where: { id }, data: d }); }`))).toHaveLength(1);
      expect(bumpViolations(planted(`export async function f(id: number, d: object) { return prisma.user.update({ where: { id }, data: { ...d } }); }`))).toHaveLength(1);
    });

    it("probe b3 — a nested write through another model, a tx client and an upsert's update branch are seen", () => {
      expect(
        bumpViolations(planted(`export async function f(id: number) { return prisma.contact.update({ where: { id }, data: { user: { update: { data: { role: "ADMIN" } } } } }); }`))
      ).toHaveLength(1);
      expect(
        bumpViolations(planted(`export async function f(id: number) { return prisma.$transaction(async (tx) => tx.user.updateMany({ where: { id }, data: { password: "x" } })); }`))
      ).toHaveLength(1);
      expect(
        bumpViolations(planted(`export async function f(id: number) { return prisma.user.upsert({ where: { id }, create: { password: "x" }, update: { password: "y" } }); }`))
      ).toHaveLength(1);
    });

    it("probe c — the same neighbouring forms WITH the bump stay GREEN", () => {
      expect(
        bumpViolations(planted(`export async function f(id: number) { const data = { role: "VIEWER", sessionVersion: { increment: 1 } }; return prisma.user.update({ where: { id }, data }); }`))
      ).toEqual([]);
      expect(
        bumpViolations(planted(`export async function f(id: number, d: object, c: boolean) { return prisma.user.update({ where: { id }, data: { ...d, sessionVersion: c ? { increment: 1 } : undefined } }); }`))
      ).toEqual([]);
      expect(
        bumpViolations(
          planted(`export async function f(id: number) { return prisma.contact.update({ where: { id }, data: { user: { update: { data: { role: "ADMIN", sessionVersion: { increment: 1 } } } } } }); }`)
        )
      ).toEqual([]);
    });

    it("probe c2 — a bump that is not an increment of 1, or that sits in ANOTHER statement, does not count", () => {
      expect(
        bumpViolations(planted(`export async function f(id: number) { return prisma.user.update({ where: { id }, data: { password: "x", sessionVersion: { increment: 0 } } }); }`))
      ).toHaveLength(1);
      expect(
        bumpViolations(
          planted(
            `export async function f(id: number) { await prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } }); return prisma.user.update({ where: { id }, data: { password: "x" } }); }`
          )
        )
      ).toHaveLength(1);
    });

    it("probe c3 — other columns, a create, and a mention in a COMMENT are not violations", () => {
      expect(bumpViolations(planted(`export async function f(id: number) { return prisma.user.update({ where: { id }, data: { name: "x", jobFunctionId: 1 } }); }`))).toEqual([]);
      expect(bumpViolations(planted(`export async function f() { return prisma.user.create({ data: { password: "x", role: "VIEWER" } }); }`))).toEqual([]);
      expect(bumpViolations(planted(`// prisma.user.update({ data: { password: "x" } })\nexport async function f() { return 1; }`))).toEqual([]);
    });

    it("probe d — a target removed from the domain changes the count (the exact size turns red)", () => {
      const both = planted(
        `export async function a(id: number) { return prisma.user.update({ where: { id }, data: { password: "x", sessionVersion: { increment: 1 } } }); }
         export async function b(id: number) { return prisma.user.update({ where: { id }, data: { password: "y", sessionVersion: { increment: 1 } } }); }`
      );
      const one = planted(`export async function a(id: number) { return prisma.user.update({ where: { id }, data: { password: "x", sessionVersion: { increment: 1 } } }); }`);
      expect(both.flatMap(userWriteSites)).toHaveLength(2);
      expect(one.flatMap(userWriteSites)).toHaveLength(1);
    });

    it("an exemption without a reason or a condition is refused", () => {
      expect(bumpViolations([], { create: { reason: " ", until: "x" } })).toHaveLength(1);
    });
  });
});
