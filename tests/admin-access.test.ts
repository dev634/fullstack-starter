import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/access", () => ({ getAccessConfig: vi.fn() }));
vi.mock("@/lib/areaAccess", () => ({ canAccessArea: vi.fn() }));
// lib/adminAccess.ts imports `auth` at module scope for requireAdminTab (not
// exercised here) — real next-auth pulls in next/server, which this vitest
// environment can't resolve, so it must be mocked even though getAdminAccess
// itself never calls it.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { getAdminAccess } from "@/lib/adminAccess";
import { getAccessConfig } from "@/lib/access";
import { canAccessArea } from "@/lib/areaAccess";
import { DEFAULT_CAPABILITY_ROLE } from "@/lib/capabilities";

const getAccessConfigMock = vi.mocked(getAccessConfig);
const canAccessAreaMock = vi.mocked(canAccessArea);

/**
 * getAdminAccess is the one place that combines both halves of an admin tab's
 * visibility: the RBAC capability (role) AND the job function's hiddenAreas.
 * Neither alone is the answer — a function must only ever narrow a tab a
 * role's capability already allows, never grant one it doesn't.
 */
describe("getAdminAccess — capability ∧ function", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an ADMIN with the capability is admitted when the function hides nothing", async () => {
    getAccessConfigMock.mockResolvedValue(DEFAULT_CAPABILITY_ROLE);
    canAccessAreaMock.mockResolvedValue(true);
    const access = await getAdminAccess("ADMIN");
    expect(access.functions).toBe(true);
    expect(access.users).toBe(true);
    // settings.manage defaults to SUPERADMIN — an ADMIN never meets it, function aside
    expect(access.settings).toBe(false);
  });

  it("a function hiding admin.functions withdraws that tab even though the role has the capability", async () => {
    getAccessConfigMock.mockResolvedValue(DEFAULT_CAPABILITY_ROLE);
    canAccessAreaMock.mockImplementation(async (area) => area !== "admin.functions");
    const access = await getAdminAccess("ADMIN");
    expect(access.functions).toBe(false);
    expect(access.users).toBe(true);
  });

  it("the function can only narrow, never grant: a role failing the capability stays denied even if nothing is hidden", async () => {
    getAccessConfigMock.mockResolvedValue(DEFAULT_CAPABILITY_ROLE);
    canAccessAreaMock.mockResolvedValue(true); // function hides nothing
    const access = await getAdminAccess("EDITOR"); // below functions.manage's ADMIN minimum
    expect(access.functions).toBe(false);
    expect(access.any).toBe(false);
  });

  it("landing recalculates around a function-hidden tab, skipping straight to the next accessible one", async () => {
    getAccessConfigMock.mockResolvedValue(DEFAULT_CAPABILITY_ROLE);
    canAccessAreaMock.mockImplementation(async (area) => area !== "admin.functions");
    const access = await getAdminAccess("ADMIN");
    expect(access.landing).toBe("/admin/settings/utilisateurs");
  });

  it("landing is null when every tab is denied", async () => {
    getAccessConfigMock.mockResolvedValue(DEFAULT_CAPABILITY_ROLE);
    canAccessAreaMock.mockResolvedValue(false);
    const access = await getAdminAccess("ADMIN");
    expect(access.any).toBe(false);
    expect(access.landing).toBeNull();
  });
});
