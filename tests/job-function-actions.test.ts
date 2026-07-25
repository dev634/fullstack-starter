import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/repository/jobFunctions", () => ({ create: vi.fn(), remove: vi.fn(), reorder: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { reorderJobFunctions, addJobFunction } from "@/actions/jobFunctions/jobFunctions";
import { requireRole } from "@/lib/authz";
import { reorder, create } from "@/repository/jobFunctions";

const requireRoleMock = vi.mocked(requireRole);
const reorderMock = vi.mocked(reorder);
const createMock = vi.mocked(create);

describe("job function actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reorderJobFunctions refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await reorderJobFunctions([3, 1, 2]);
    expect((res as { type: string }).type).toBe("error");
    expect(reorderMock).not.toHaveBeenCalled();
  });

  it("reorderJobFunctions persists the given order (dropping invalid ids)", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    reorderMock.mockResolvedValue([] as never);
    const res = await reorderJobFunctions([3, 0, 1, -5, 2]);
    expect((res as { type: string }).type).toBe("success");
    expect(reorderMock).toHaveBeenCalledWith([3, 1, 2]);
  });

  it("addJobFunction refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const fd = new FormData();
    fd.set("name", "Couvreur");
    const res = await addJobFunction({ type: null, message: "" }, fd);
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });
});
