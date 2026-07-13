import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/repository/taskGroups", () => ({
  findById: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { getTaskGroup, deleteTaskGroup } from "@/actions/taskGroups/taskGroups";
import { requireSession, requireRole } from "@/lib/authz";
import { findById, remove } from "@/repository/taskGroups";

const requireSessionMock = vi.mocked(requireSession);
const requireRoleMock = vi.mocked(requireRole);
const findByIdMock = vi.mocked(findById);
const removeMock = vi.mocked(remove);

describe("getTaskGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses without a session", async () => {
    requireSessionMock.mockResolvedValue({ type: "error", message: "Unauthorized." });
    const res = await getTaskGroup(1);
    expect(res.type).toBe("error");
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("returns the group for any authenticated session", async () => {
    requireSessionMock.mockResolvedValue(null);
    findByIdMock.mockResolvedValue({ id: 1, name: "Strings" } as never);
    const res = await getTaskGroup(1);
    expect(res.type).toBe("success");
    expect(findByIdMock).toHaveBeenCalledWith(1);
  });
});

describe("deleteTaskGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteTaskGroup(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes the group when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteTaskGroup(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});
