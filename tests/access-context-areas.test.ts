import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({ findAccessScopeByEmail: vi.fn() }));

import { getAccessContext } from "@/lib/accessContext";
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

  it("an anonymous caller (no session) is unrestricted, same as before", async () => {
    authMock.mockResolvedValue(null as never);
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBe(0);
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

  it("an ADMIN with no job function has empty hiddenAreas (no restriction by default)", async () => {
    authMock.mockResolvedValue(session("ADMIN"));
    scopeMock.mockResolvedValue(null);
    const ctx = await getAccessContext();
    expect(ctx.hiddenAreas.size).toBe(0);
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
