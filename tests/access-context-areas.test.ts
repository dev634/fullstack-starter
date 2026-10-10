import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({ findAccessScopeByEmail: vi.fn() }));

import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { auth } from "@/lib/auth";
import { findAccessScopeByEmail, type AccessScope } from "@/repository/users";

const authMock = vi.mocked(auth);
const scopeMock = vi.mocked(findAccessScopeByEmail);

function session(role: string, email = "user@example.com") {
  return { user: { email, role } } as never;
}

/**
 * getAccessContext's hiddenAreas bypass rule deliberately differs from
 * hiddenSections/projectIds: only SUPERADMIN is unrestricted. ADMIN keeps its
 * existing unrestricted hiddenSections/projectIds, but its own job function
 * can still hide top-level rubriques from it (see lib/areaAccess.ts).
 */
describe("getAccessContext — hiddenAreas bypass rule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SUPERADMIN is unrestricted on every axis, including hiddenAreas, without querying the scope", async () => {
    authMock.mockResolvedValue(session("SUPERADMIN"));
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBe(0);
    expect(ctx.hiddenSections.size).toBe(0);
    expect(ctx.projectIds).toBeNull();
    expect(scopeMock).not.toHaveBeenCalled();
  });

  // Was "an anonymous caller (no session) is unrestricted, same as before" —
  // that assertion WAS the defect this pass closes: an absent/invalid
  // session used to read as "unrestricted", which is how a deleted EDITOR's
  // stale cookie could see a project, a masked section and the CSV export of
  // every project it no longer had any right to. An anonymous caller is now
  // DENIED on every axis, with no scope lookup (there is no email to look up).
  it("an anonymous caller (no session) is DENIED on every axis, without querying the scope", async () => {
    authMock.mockResolvedValue(null as never);
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBeGreaterThan(0);
    expect(ctx.hiddenSections.size).toBeGreaterThan(0);
    expect(ctx.projectIds).toEqual(new Set());
    expect(canReachProject(ctx, 1)).toBe(false);
    expect(scopeMock).not.toHaveBeenCalled();
  });

  it("ADMIN keeps unrestricted hiddenSections/projectIds (unchanged), but resolves real hiddenAreas from its own function", async () => {
    authMock.mockResolvedValue(session("ADMIN"));
    const scope: AccessScope = {
      hiddenSections: ["tasks"], // must still be ignored for ADMIN
      hiddenAreas: ["admin.settings"],
      projectScope: "ASSIGNED", // must still be ignored for ADMIN
      assignedProjectIds: [1],
    };
    scopeMock.mockResolvedValue(scope);

    const ctx = await getAccessContext();
    expect(ctx.hiddenSections.size).toBe(0);
    expect(ctx.projectIds).toBeNull();
    expect([...ctx.hiddenAreas]).toEqual(["admin.settings"]);
  });

  // Was simulated with `scopeMock.mockResolvedValue(null)` — that is "no
  // account", not "account with no function". A real "no function" scope is
  // a present row whose hiddenSections/hiddenAreas are empty; this is what
  // the fixture now sets up.
  it("an ADMIN with no job function has empty hiddenAreas (no restriction by default)", async () => {
    authMock.mockResolvedValue(session("ADMIN"));
    scopeMock.mockResolvedValue({ hiddenSections: [], hiddenAreas: [], projectScope: "ALL", assignedProjectIds: [] });
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBe(0);
  });

  // New: an ADMIN account resolves (session has the role), but its row is
  // gone — the exact race lib/sessionGate.ts's own per-request cache cannot
  // always catch (deleted BETWEEN two requests). DENIED, same as every role
  // below it: the scope lookup runs before the ADMIN branch precisely so
  // this can't fall through to "ADMIN's own job, unrestricted".
  it("an ADMIN whose account no longer resolves (row deleted) is DENIED, not unrestricted", async () => {
    authMock.mockResolvedValue(session("ADMIN"));
    scopeMock.mockResolvedValue(null);
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBeGreaterThan(0);
    expect(ctx.hiddenSections.size).toBeGreaterThan(0);
    expect(ctx.projectIds).toEqual(new Set());
    expect(canReachProject(ctx, 1)).toBe(false);
  });

  // New: same race, a role below ADMIN.
  it("an EDITOR whose account no longer resolves (row deleted) is DENIED", async () => {
    authMock.mockResolvedValue(session("EDITOR"));
    scopeMock.mockResolvedValue(null);
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBeGreaterThan(0);
    expect(ctx.hiddenSections.size).toBeGreaterThan(0);
    expect(ctx.projectIds).toEqual(new Set());
    expect(canReachProject(ctx, 1)).toBe(false);
  });

  it("a regular role (EDITOR) resolves hiddenAreas from its function, same as hiddenSections/projectIds", async () => {
    authMock.mockResolvedValue(session("EDITOR"));
    const scope: AccessScope = {
      hiddenSections: ["tasks"],
      hiddenAreas: ["projects", "some.stale.key"],
      projectScope: "ASSIGNED",
      assignedProjectIds: [7],
    };
    scopeMock.mockResolvedValue(scope);

    const ctx = await getAccessContext();
    expect([...ctx.hiddenSections]).toEqual(["tasks"]);
    // the stale/unknown key is dropped (normalizeHiddenAreas)
    expect([...ctx.hiddenAreas]).toEqual(["projects"]);
    expect(ctx.projectIds).toEqual(new Set([7]));
  });
});
