import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { sourceFilesIn } from "./helpers/astScan";
import { accountActionsIn, repositoryFunctionText, repositoryWriters, type Source } from "./helpers/accountWriterScan";

/**
 * Structural guarantee: every exported server action that WRITES an account
 * (a `User`, a `JobFunction`, a `PasswordResetToken`) goes through the account
 * policy — and the actions are DISCOVERED from their writes, not named.
 *
 * tests/user-actions-admin-rank.test.ts and tests/job-function-actions.test.ts
 * prove what each KNOWN action refuses; a tenth action that wrote `User` would
 * have been seen by nobody. This is the test that makes "all the writers are
 * covered" a fact (docs/CONVENTIONS.md, « Personne ne modifie la contrainte qui
 * le contraint »).
 *
 * Method — two layers, both parsed (tests/helpers/accountWriterScan.ts), never
 * grepped:
 *   1. a repository WRITER = an exported function of any `repository/*.ts`
 *      whose body (local helpers followed) calls `prisma.<m>.<write>` or
 *      `tx.<m>.<write>` with <m> in {user, jobFunction, passwordResetToken};
 *   2. an ACTION = an exported function of `actions/**` that reaches a writer
 *      by MODULE PATH and by BINDING (aliased named import, `import * as ns`),
 *      local helpers followed. A dynamic import of a repository module is
 *      banned: the scan cannot follow it.
 * GUARDED = it (transitively, within its file) calls something imported from
 * `lib/accountPolicy`, or the local `refuseIfHeldByAdmin` (the functions
 * actions' guard, which applies accountPolicy::mayChangeHeldFunction).
 *
 * Counted at 4e3c633 + the lot 5a working tree (permanentlyRemove deletes
 * CLIENT logins since this lot, so it became a writer): 13 writers in 4
 * repository files (users 7, jobFunctions 4, contacts 1, clients 1) and 13
 * actions in 7 action files — 6 guarded, 7 exempt. The sizes are EXACT, below.
 * Not seen by construction: a write by nested relation
 * (`contact.update({ data: { user: { create } } })` — none exists), raw SQL
 * (none in repository/), and a writer passed as a value instead of called.
 */

const ROOT = process.cwd();
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");
const read = (dir: string): Source[] =>
  sourceFilesIn(join(ROOT, dir), [".ts"]).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));

const LOCAL_GUARDS: ReadonlySet<string> = new Set(["refuseIfHeldByAdmin"]);

/**
 * Actions exempt from the policy. Each carries WHY it is not a lever and WHEN
 * the exemption must go. `claim`, when present, is a literal the reached source
 * must still contain — the exemption certifies exactly that and nothing else.
 */
const EXEMPT: Record<string, { reason: string; until: string; claim?: string }> = {
  "actions/auth/auth.ts::requestPasswordReset": {
    reason: "the reset link goes to the account's own mailbox, never back to the caller",
    until: "the link is ever shown to, or sent on behalf of, someone other than the account",
  },
  "actions/auth/auth.ts::resetPassword": {
    reason: "guarded by the emailed single-use token; the caller IS the account's owner",
    until: "a reset token can be minted for the caller to hand over (createResetToken exposed to an action other than the two exempt ones)",
  },
  "actions/jobFunctions/jobFunctions.ts::addJobFunction": {
    reason: "a new function constrains nobody; assigning it goes through the account policy (addUser / updateUser)",
    until: "create() takes a hiddenAreas / holders argument",
  },
  "actions/jobFunctions/jobFunctions.ts::reorderJobFunctions": {
    reason: "writes the position only",
    until: "reorder() writes anything but `position`",
  },
  "actions/portal/portal.ts::createPortalLogin": {
    reason: "only ever creates a CLIENT login, and a CLIENT can no longer be promoted (updateUser refuses it, lot 5a)",
    until: "updateUser may change the role of a CLIENT again, or this action creates another role",
    claim: 'role: "CLIENT"',
  },
  "actions/contacts/contacts.ts::deleteContact": {
    reason: "contacts.remove deletes the linked login only while it is still CLIENT: it never frees a restricted account",
    until: "repository/contacts.ts::remove stops filtering on role CLIENT",
    claim: 'role: "CLIENT"',
  },
  "actions/clients/clients.ts::permanentlyDeleteClient": {
    reason: "clients.permanentlyRemove deletes the contacts' logins only while they are still CLIENT",
    until: "repository/clients.ts::permanentlyRemove stops filtering on role CLIENT",
    claim: 'role: "CLIENT"',
  },
};

/** Where an exemption's `claim` is read: the reached source of the action itself, or of the repository writer. */
const CLAIM_SOURCE: Record<string, { file: string; fn: string } | "action"> = {
  "actions/portal/portal.ts::createPortalLogin": "action",
  "actions/contacts/contacts.ts::deleteContact": { file: "repository/contacts.ts", fn: "remove" },
  "actions/clients/clients.ts::permanentlyDeleteClient": { file: "repository/clients.ts", fn: "permanentlyRemove" },
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
function violations(repos: Source[], actions: Source[], exempt: typeof EXEMPT): string[] {
  const { reports, dynamic } = discover(repos, actions);
  const out: string[] = dynamic.map((d) => `dynamic import of a repository module (not followed): ${d}`);
  for (const r of reports) {
    if (r.guarded) continue;
    const ex = exempt[r.action];
    if (!ex) out.push(`${r.action} writes an account (${r.writers.join(", ")}) without the account policy and is not exempt`);
    else if (!ex.reason.trim() || !ex.until.trim()) out.push(`${r.action}: an exemption needs a reason and a condition of disappearance`);
  }
  return out;
}

describe("every action that writes an account goes through the account policy", () => {
  const repos = read("repository");
  const actions = read("actions");
  const found = discover(repos, actions);

  it("the discovered domain has its EXACT size (a removed writer or action must turn this red)", () => {
    expect(found.writers.size).toBe(EXPECTED_WRITERS);
    expect(found.reports.length).toBe(EXPECTED_ACTIONS);
  });

  it("no action is unguarded unless exempt with a reason and a condition", () => {
    expect(violations(repos, actions, EXEMPT)).toEqual([]);
  });

  it("every exemption still names a discovered, unguarded action (a stale exemption certifies nothing)", () => {
    const unguarded = new Set(found.reports.filter((r) => !r.guarded).map((r) => r.action));
    expect([...unguarded].filter((a) => !(a in EXEMPT))).toEqual([]);
    expect(Object.keys(EXEMPT).filter((a) => !unguarded.has(a))).toEqual([]);
  });

  it("each exemption's claim is still true of the source it rests on", () => {
    for (const [action, ex] of Object.entries(EXEMPT)) {
      if (!ex.claim) continue;
      const from = CLAIM_SOURCE[action];
      expect(from, `${action} has a claim but no source for it`).toBeDefined();
      const text =
        from === "action"
          ? found.reports.find((r) => r.action === action)?.text ?? ""
          : repositoryFunctionText(repos.find((r) => r.path === from?.file) ?? { path: "", text: "" }, from?.fn ?? "");
      expect(text, `${action}: the source no longer contains ${ex.claim}`).toContain(ex.claim);
    }
  });
});

// --- Probes, on planted SOURCES (in memory: the tree is not touched) --------
//
// The same four probes were also run once against the real tree with files
// planted on disk (see the lot 5a report); these keep them alive.
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
  const run = (text: string) => violations(repos, baseline(text), {});

  it("discovers writers through a local helper, and ignores reads", () => {
    expect(repositoryWriters(repos[0]!).sort()).toEqual(["repository/users.ts::create", "repository/users.ts::removeWithHelper"]);
  });

  it("probe 1 — an action without the guard is RED", () => {
    const v = run(`import { create } from "@/repository/users";
      export async function a() { return create({}); }`);
    expect(v).toHaveLength(1);
  });

  it("probe 2 — an ALIASED import of a writer, by a relative path, in a new action, is RED", () => {
    const v = run(`import { create as mint } from "../../repository/users";
      export async function a() { return mint({}); }`);
    expect(v).toHaveLength(1);
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

  it("probe 3 — the correct neighbouring forms stay GREEN (guard direct, aliased, via a local helper; local guard)", () => {
    expect(run(`import { create } from "@/repository/users";
      import { canAssignRole } from "@/lib/accountPolicy";
      export async function a() { canAssignRole("ADMIN", "EDITOR"); return create({}); }`)).toEqual([]);
    expect(run(`import { create as mint } from "../../repository/users";
      import { mayManageAccountWithFunction as may } from "../../lib/accountPolicy";
      async function check() { return may({ role: "ADMIN", hiddenAreas: new Set() }, []); }
      export async function a() { await check(); return mint({}); }`)).toEqual([]);
    expect(run(`import { create } from "@/repository/users";
      async function refuseIfHeldByAdmin() { return null; }
      export async function a() { await refuseIfHeldByAdmin(); return create({}); }`)).toEqual([]);
  });

  it("probe 3b — an action that only READS, or imports a writer it never calls, is not in the domain", () => {
    expect(run(`import { read, create } from "@/repository/users";
      export async function a() { return read(1); }`)).toEqual([]);
  });

  it("probe 3c — a guard imported from somewhere else, and a comment naming it, are still RED", () => {
    expect(run(`import { create } from "@/repository/users";
      import { canAssignRole } from "@/lib/capabilities";
      export async function a() { canAssignRole(); return create({}); }`)).toHaveLength(1);
    expect(run(`import { create } from "@/repository/users";
      // canAssignRole from "@/lib/accountPolicy"
      export async function a() { return create({}); }`)).toHaveLength(1);
  });

  it("probe 4 — a writer removed from the domain changes the count (the exact size turns red)", () => {
    const without: Source[] = [{ path: "repository/users.ts", text: `export async function create() { return 1; }` }];
    expect(repositoryWriters(without[0]!)).toHaveLength(0);
    expect(repositoryWriters(repos[0]!)).toHaveLength(2);
  });

  it("an exemption without a reason or a condition is refused", () => {
    const text = `import { create } from "@/repository/users";
      export async function a() { return create({}); }`;
    const v = violations(repos, baseline(text), { "actions/x/x.ts::a": { reason: " ", until: "x" } });
    expect(v).toHaveLength(1);
  });
});
