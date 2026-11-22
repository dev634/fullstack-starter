import { describe, it, expect, vi, beforeEach } from "vitest";
import { sessionDomain, sessionReaderNamesIn } from "./helpers/sessionReaderScan";

/**
 * Structural + behavioral guarantee, in one file: every declaration anywhere
 * outside app/ that reads the session directly (uses `auth`) must refuse when
 * that session cannot be trusted — no session at all, and, for every one that
 * also reads a row of its own beyond the session itself, that row having just
 * vanished (the one window lib/sessionGate.ts cannot close: deleted DURING a
 * request, after the gate passed the token and before the reader's own query
 * ran — a row deleted BEFORE the request is voided by the gate and arrives as
 * no session at all, which `noSession` covers).
 *
 * This is the general net behind the specific fix: lib/sessionGate.ts closes
 * the defect at its one root (the JWT callback), so every caller below
 * inherits it for free. But "every caller" is a claim, not a fact — this
 * file is what turns it into one, the same way tests/authz-coverage.test.ts
 * discovers its own domain from the code rather than a hand-written list
 * that would simply forget the next one.
 *
 * Discovery (method, recorded here rather than just asserted), implemented in
 * tests/helpers/sessionReaderScan.ts:
 *   - Domain: the whole repository minus a table of non-application folders
 *     (each with its reason there), not a list of lib/ and actions/ — a reader
 *     added in components/ or service/ is swept up by default.
 *   - A file counts only if it binds `auth` by the one allowed form (a named,
 *     unaliased `import { auth } from "@/lib/auth"`, or the destructured
 *     dynamic import lib/areaAccess.ts needs). Every OTHER way of reaching
 *     lib/auth (namespace import, relative path, rename, re-export,
 *     un-destructured dynamic import) is banned outright by
 *     tests/session-reader-discovery.test.ts, so it cannot hide a reader here.
 *   - A reader is a TOP-LEVEL declaration (exported or not —
 *     actions/users/users.ts's `requireManager` is not exported, and is probed
 *     below through an exported action that calls it) that mentions `auth`
 *     anywhere in it, identified `path::name`. Attributed whole, so a reader
 *     wrapped in a call (`export const f = cache(async () => auth())`) is found
 *     under the name it is exported as. "Directly" on purpose: a function that
 *     only calls a local helper which itself reads the session is not
 *     re-derived here — the helper is its own entry in this same table.
 *   - app/ is out of this table: its ~26 pages and layouts are covered by a
 *     written exemption with its own exact-set check, in
 *     tests/session-reader-discovery.test.ts.
 */

/** Every `path::name` session reader outside app/, sorted. */
function discoverSessionReaders(): string[] {
  return sessionDomain()
    .files.filter(({ rel }) => !rel.startsWith("app/"))
    .flatMap(({ rel, source }) => sessionReaderNamesIn(source, rel).map((name) => `${rel}::${name}`))
    .sort();
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

/**
 * What the mocked `redirect()` throws, in place of Next's own control-flow
 * error: an `Error` carrying the destination, which `expectRedirectTo`
 * matches on. A type + a function, not a class — this file is the only place
 * under tests/ a class appeared for a reason other than a third-party SDK
 * stand-in (see the `class` ban and its tests/ exemption in eslint.config.mjs).
 */
type RedirectSignal = Error & { readonly destination: string };

function redirectSignal(destination: string): RedirectSignal {
  return Object.assign(new Error(`redirect:${destination}`), { destination });
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
    throw redirectSignal(url);
  }),
}));

import { auth } from "@/lib/auth";
import { findAccessScopeByEmail, findIdByEmail, findAccountJobFunctionByEmail } from "@/repository/users";
import { findByUserEmail } from "@/repository/contacts";
import { getAccessContext } from "@/lib/accessContext";
import { requireAdminTab } from "@/lib/adminAccess";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { requireSession, requireRole } from "@/lib/authz";
import { getCurrentUserId, getLoansActor } from "@/lib/currentUser";
import { blockClientFromApp, getPortalContext } from "@/lib/portal";
import { requireAppUser } from "@/lib/requireAppUser";
import { addUser } from "@/actions/users/users";
import { deleteJobFunction, setFunctionAreas } from "@/actions/jobFunctions/jobFunctions";
import fr from "@/lib/i18n/dictionaries/fr";
import { accountWithoutFunction, expectDenied } from "./helpers/accessFixtures";

const authMock = vi.mocked(auth);
const findAccessScopeByEmailMock = vi.mocked(findAccessScopeByEmail);
const findIdByEmailMock = vi.mocked(findIdByEmail);
const findAccountJobFunctionByEmailMock = vi.mocked(findAccountJobFunctionByEmail);
const findByUserEmailMock = vi.mocked(findByUserEmail);

async function expectRedirectTo(run: () => Promise<unknown>, destination: string): Promise<void> {
  await expect(run()).rejects.toMatchObject({ destination });
}

/**
 * The guard must REDIRECT (returning is what lets a caller through) and must
 * not send the caller to an Administration tab. It deliberately does not pin
 * WHERE else it lands: that is the guard's own routing choice (a generic
 * fallback today, itself a page that sends an absent session on to /login),
 * and pinning it made these probes fail on a harmless change of fallback
 * while saying nothing about the session.
 */
async function expectRedirectAwayFromAdmin(run: () => Promise<unknown>): Promise<void> {
  const error = await run().then(
    () => undefined,
    (rejection: unknown) => rejection
  );
  expect(error, "the guard returned instead of redirecting — it let the caller through").toBeDefined();
  expect(error).toMatchObject({ destination: expect.any(String) });
  expect(error).not.toMatchObject({ destination: expect.stringMatching(/^\/admin(\/|$)/) });
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
      expectDenied(await getAccessContext());
    },
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "EDITOR", email: "ghost@example.com" } } as never);
      findAccessScopeByEmailMock.mockResolvedValue(null);
      expectDenied(await getAccessContext());
    },
  },

  "lib/adminAccess.ts::requireAdminTab": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      // A session with no role opens no admin tab: the guard redirects, and
      // not to one.
      await expectRedirectAwayFromAdmin(() => requireAdminTab("users"));
    },
  },

  "lib/areaAccess.ts::requireAreaOrRedirect": {
    noSession: async () => {
      authMock.mockResolvedValue(null as never);
      // DENIED hides every area, including admin.functions — the guard gets
      // past its early return and redirects, and not to an admin tab. Where it
      // lands is areaAccess's own fallback chain, pinned where it belongs
      // (tests/area-access.test.ts), not through an absent session.
      await expectRedirectAwayFromAdmin(() => requireAreaOrRedirect("admin.functions"));
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
    // DURING the request" window, not "no session at all".
    absentRow: async () => {
      authMock.mockResolvedValue({ user: { role: "ADMIN", email: "ghost@example.com" } } as never);
      findAccessScopeByEmailMock.mockResolvedValue(accountWithoutFunction());
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
      findAccessScopeByEmailMock.mockResolvedValue(accountWithoutFunction());
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
        it("refuses when its own row was deleted during the request (valid session, row gone — not 'no session')", probe.absentRow);
      }
    });
  }
});
