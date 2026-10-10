import { describe, it, expect, vi, beforeEach } from "vitest";
import ts from "typescript";
import { join, relative, sep } from "node:path";
import { sourceFilesIn, functionsIn, importedModulesIn, parseSource } from "./helpers/astScan";

/**
 * Structural + behavioral guarantee, in one file: every function anywhere
 * under lib/ or actions/ that reads the session directly (calls `auth()`)
 * must refuse when that session cannot be trusted — no session at all, and,
 * for every one that also reads a row of its own beyond the session itself,
 * that row having just vanished (the race lib/sessionGate.ts's own
 * per-request cache cannot always catch: deleted BETWEEN two requests, not
 * within the one that already verified it).
 *
 * This is the general net behind the specific fix: lib/sessionGate.ts closes
 * the defect at its one root (the JWT callback), so every caller below
 * inherits it for free. But "every caller" is a claim, not a fact — this
 * file is what turns it into one, the same way tests/authz-coverage.test.ts
 * discovers its own domain from the code rather than a hand-written list
 * that would simply forget the next one.
 *
 * Discovery (method, recorded here rather than just asserted): every `.ts`
 * file under lib/ or actions/ (lib/auth.ts itself excluded — it IS the
 * boundary, not a caller of it) that imports `@/lib/auth` — statically
 * (alias resolved: `import { auth as a } from "@/lib/auth"` binds the local
 * name `a`) or dynamically (`import("@/lib/auth")`, tracked by the literal
 * name `auth` — the one dynamic-import shape in this codebase,
 * lib/areaAccess.ts, destructures it under exactly that name, so a full
 * destructuring-pattern tracker isn't worth building for one call site).
 * Within such a file, every TOP-LEVEL function (exported or not —
 * actions/users/users.ts's `requireManager` is not exported, and is probed
 * below through an exported action that calls it) whose own body calls that
 * local name directly is a "session reader", identified `path::name`.
 * "Directly" on purpose: a function that only calls a local helper which
 * itself reads the session is not re-derived here — the helper is its own
 * entry in this same table.
 */

const ROOT = process.cwd();

function relPath(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

/** Every local name this file binds to `@/lib/auth`'s `auth` export. */
function localAuthNamesIn(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === "@/lib/auth") {
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = el.propertyName?.text ?? el.name.text;
          if (imported === "auth") names.add(el.name.text);
        }
      }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteral(arg) && arg.text === "@/lib/auth") names.add("auth");
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return names;
}

/** Every `path::name` session reader, sorted. */
function discoverSessionReaders(): string[] {
  const files = ["lib", "actions"].flatMap((dir) => sourceFilesIn(join(ROOT, dir), [".ts"]));
  const readers: string[] = [];
  for (const file of files) {
    const rel = relPath(file);
    if (rel === "lib/auth.ts") continue;
    const source = parseSource(rel, file);
    if (!importedModulesIn(source).has("@/lib/auth")) continue;
    const authNames = localAuthNamesIn(source);
    if (authNames.size === 0) continue;
    for (const fn of functionsIn(source)) {
      if ([...fn.calls].some((call) => authNames.has(call))) readers.push(`${rel}::${fn.name}`);
    }
  }
  return readers.sort();
}

// --- Module boundaries ------------------------------------------------
//
// Everything below the session itself (getAccessContext, areaAccess,
// adminAccess, authz, currentUser, portal, requireAppUser, access,
// appAreas, projectSections, capabilities, the dictionaries) runs for
// REAL: that is the whole point — lib/accessContext.ts's own DENIED
// branches, lib/areaAccess.ts's hidden-area short-circuit, etc. must
// actually fire from a mocked `auth()`/`repository` alone. Only the true
// edges are mocked: the session itself, the repositories, and the two
// Next.js modules (navigation/cache) that don't run outside a request.

class RedirectSignal extends Error {
  constructor(public readonly destination: string) {
    super(`redirect:${destination}`);
  }
}

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/repository/users", () => ({
  findAccessScopeByEmail: vi.fn(),
  findIdByEmail: vi.fn(),
  findAccountJobFunctionByEmail: vi.fn(),
  create: vi.fn(),
  updateProfile: vi.fn(),
  remove: vi.fn(),
  findById: vi.fn(),
  countSuperadmins: vi.fn(),
  updatePassword: vi.fn(),
  countOwnershipBlockers: vi.fn(),
  setUserProjects: vi.fn(),
}));

vi.mock("@/repository/contacts", () => ({ findByUserEmail: vi.fn() }));

vi.mock("@/repository/jobFunctions", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  updateHiddenSections: vi.fn(),
  updateHiddenAreas: vi.fn(),
  updateProjectScope: vi.fn(),
}));

vi.mock("@/repository/projectWorkers", () => ({ hasAnyAttachment: vi.fn().mockResolvedValue(false) }));

vi.mock("@/lib/appSettings", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }),
  APP_SETTINGS_TAG: "app-settings",
}));

vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));

import { auth } from "@/lib/auth";
import { findAccessScopeByEmail, findIdByEmail, findAccountJobFunctionByEmail, type AccessScope } from "@/repository/users";
import { findByUserEmail } from "@/repository/contacts";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { requireAdminTab } from "@/lib/adminAccess";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { requireSession, requireRole } from "@/lib/authz";
import { getCurrentUserId, getLoansActor } from "@/lib/currentUser";
import { blockClientFromApp, getPortalContext } from "@/lib/portal";
import { requireAppUser } from "@/lib/requireAppUser";
import { addUser } from "@/actions/users/users";
import { deleteJobFunction, setFunctionAreas } from "@/actions/jobFunctions/jobFunctions";
import fr from "@/lib/i18n/dictionaries/fr";

const authMock = vi.mocked(auth);
const findAccessScopeByEmailMock = vi.mocked(findAccessScopeByEmail);
const findIdByEmailMock = vi.mocked(findIdByEmail);
const findAccountJobFunctionByEmailMock = vi.mocked(findAccountJobFunctionByEmail);
const findByUserEmailMock = vi.mocked(findByUserEmail);

/** A present, unrestricted scope — "account exists, no job function". */
const EXISTING_SCOPE: AccessScope = { hiddenSections: [], hiddenAreas: [], projectScope: "ALL", assignedProjectIds: [] };

async function expectRedirectTo(run: () => Promise<unknown>, destination: string): Promise<void> {
  await expect(run()).rejects.toMatchObject({ destination });
}

type ReaderProbe = {
  /** `auth()` resolves to no session at all. Required for every reader. */
  noSession: () => Promise<void>;
  /**
   * A real session whose OWN secondary row (beyond the session itself) has
   * just been deleted — only for a reader that reads one directly, in its
   * own body (see the module doc above on "directly").
   */
  absentRow?: () => Promise<void>;
};

const SESSION_READERS: Record<string, ReaderProbe> = {
  "lib/accessContext.ts::getAccessContext": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const ctx = await getAccessContext();
      expect(ctx.hiddenAreas.size).toBeGreaterThan(0);
      expect(canReachProject(ctx, 1)).toBe(false);
    },
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "EDITOR", email: "ghost@example.com" } } as never);
      findAccessScopeByEmailMock.mockResolvedValue(null);
      const ctx = await getAccessContext();
      expect(ctx.hiddenAreas.size).toBeGreaterThan(0);
      expect(canReachProject(ctx, 1)).toBe(false);
    },
  },

  "lib/adminAccess.ts::requireAdminTab": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      // No accessible tab for a session with no role at all: redirected to
      // the generic fallback rather than any admin tab.
      await expectRedirectTo(() => requireAdminTab("users"), "/clients");
    },
  },

  "lib/areaAccess.ts::requireAreaOrRedirect": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      // DENIED hides every area, including admin.functions — proceeds past
      // the early return and redirects to the "everything is hidden" page.
      await expectRedirectTo(() => requireAreaOrRedirect("admin.functions"), "/acces-refuse");
    },
  },

  "lib/authz.ts::requireSession": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const result = await requireSession();
      expect(result?.type).toBe("error");
    },
  },

  "lib/authz.ts::requireRole": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const result = await requireRole("ADMIN");
      expect(result.error).not.toBeNull();
    },
  },

  "lib/currentUser.ts::getCurrentUserId": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      expect(await getCurrentUserId()).toBeNull();
    },
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "EDITOR", email: "ghost@example.com" } } as never);
      findIdByEmailMock.mockResolvedValue(null);
      expect(await getCurrentUserId()).toBeNull();
    },
  },

  "lib/currentUser.ts::getLoansActor": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      expect(await getLoansActor()).toBeNull();
    },
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "EDITOR", email: "ghost@example.com" } } as never);
      findIdByEmailMock.mockResolvedValue(null);
      expect(await getLoansActor()).toBeNull();
    },
  },

  "lib/portal.ts::blockClientFromApp": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      await expectRedirectTo(() => blockClientFromApp(), "/login");
    },
  },

  "lib/portal.ts::getPortalContext": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      expect(await getPortalContext()).toBeNull();
    },
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "CLIENT", email: "ghost@example.com" } } as never);
      findByUserEmailMock.mockResolvedValue(null);
      expect(await getPortalContext()).toBeNull();
    },
  },

  "lib/requireAppUser.ts::requireAppUser": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const result = await requireAppUser();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    },
  },

  "actions/users/users.ts::requireManager": {
    // requireManager itself is not exported — probed through addUser, the
    // exported action that calls it (see the module doc above).
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const res = await addUser({ type: null, message: "" }, new FormData());
      expect(res.type).toBe("error");
    },
  },

  "actions/jobFunctions/jobFunctions.ts::deleteJobFunction": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const res = await deleteJobFunction(9);
      expect((res as { type: string }).type).toBe("error");
    },
    // The scope lookup (requireAreaAccess, a DIFFERENT resolver) is mocked
    // PRESENT here on purpose: this isolates the resolver actually under
    // test (findAccountJobFunctionByEmail, the caller's OWN function id) by
    // getting every other gate to pass first — this is the "row deleted
    // BETWEEN two requests" race, not "no session at all".
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "ADMIN", email: "ghost@example.com" } } as never);
      findAccessScopeByEmailMock.mockResolvedValue(EXISTING_SCOPE);
      findAccountJobFunctionByEmailMock.mockResolvedValue(null);
      const res = await deleteJobFunction(9);
      expect((res as { type: string }).type).toBe("error");
      expect((res as { message: string }).message).toBe(fr.errors.unauthorized);
    },
  },

  "actions/jobFunctions/jobFunctions.ts::setFunctionAreas": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      const res = await setFunctionAreas(9, []);
      expect((res as { type: string }).type).toBe("error");
    },
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "ADMIN", email: "ghost@example.com" } } as never);
      findAccessScopeByEmailMock.mockResolvedValue(EXISTING_SCOPE);
      findAccountJobFunctionByEmailMock.mockResolvedValue(null);
      const res = await setFunctionAreas(9, []);
      expect((res as { type: string }).type).toBe("error");
      expect((res as { message: string }).message).toBe(fr.errors.unauthorized);
    },
  },
};

describe("session readers refuse an absent/unverifiable account", () => {
  beforeEach(() => vi.clearAllMocks());

  const discovered = discoverSessionReaders();

  it("finds session readers (guards against a silently empty scan)", () => {
    expect(discovered.length).toBeGreaterThan(0);
  });

  // Exact equality, not a floor: a new reader with no probe rouges here, and
  // so does an orphaned probe for a reader that no longer exists.
  it("the discovered set matches SESSION_READERS exactly", () => {
    expect(Object.keys(SESSION_READERS).sort()).toEqual(discovered);
  });

  for (const [id, probe] of Object.entries(SESSION_READERS)) {
    describe(id, () => {
      it("refuses when there is no session", probe.noSession);

      if (probe.absentRow) {
        it("refuses when its own row has just been deleted (race, not 'no session')", probe.absentRow);
      }
    });
  }
});
