import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { requireRole, requireSession } from "@/lib/authz";
import { auth } from "@/lib/auth";

const authMock = vi.mocked(auth);

function sessionWithRole(role: "SUPERADMIN" | "ADMIN" | "VIEWER") {
  return { user: { email: `${role.toLowerCase()}@example.com`, role } } as never;
}

describe("requireRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when there is no session", async () => {
    authMock.mockResolvedValue(null as never);
    const result = await requireRole("ADMIN");
    expect(result.error).not.toBeNull();
  });

  it("rejects a VIEWER session for an ADMIN-gated action", async () => {
    authMock.mockResolvedValue(sessionWithRole("VIEWER"));
    const result = await requireRole("ADMIN");
    expect(result.error).not.toBeNull();
  });

  it("admits an exact ADMIN match", async () => {
    authMock.mockResolvedValue(sessionWithRole("ADMIN"));
    const result = await requireRole("ADMIN");
    expect(result.error).toBeNull();
  });

  it("admits a SUPERADMIN session on an ADMIN-gated action (higher rank)", async () => {
    authMock.mockResolvedValue(sessionWithRole("SUPERADMIN"));
    const result = await requireRole("ADMIN");
    expect(result.error).toBeNull();
  });

  it("rejects an ADMIN session for a SUPERADMIN-gated action", async () => {
    authMock.mockResolvedValue(sessionWithRole("ADMIN"));
    const result = await requireRole("SUPERADMIN");
    expect(result.error).not.toBeNull();
  });

  it("admits an exact SUPERADMIN match", async () => {
    authMock.mockResolvedValue(sessionWithRole("SUPERADMIN"));
    const result = await requireRole("SUPERADMIN");
    expect(result.error).toBeNull();
  });
});

describe("requireSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an error payload when there is no session", async () => {
    authMock.mockResolvedValue(null as never);
    const result = await requireSession();
    expect(result?.type).toBe("error");
  });

  it("returns null (proceed) when a session exists", async () => {
    authMock.mockResolvedValue(sessionWithRole("VIEWER"));
    const result = await requireSession();
    expect(result).toBeNull();
  });
});
