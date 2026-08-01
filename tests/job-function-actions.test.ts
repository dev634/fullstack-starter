import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/jobFunctions", () => ({ create: vi.fn(), remove: vi.fn(), reorder: vi.fn(), updateHiddenSections: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { reorderJobFunctions, addJobFunction, setFunctionSections } from "@/actions/jobFunctions/jobFunctions";
import { requireRole } from "@/lib/authz";
import { reorder, create, updateHiddenSections } from "@/repository/jobFunctions";

const requireRoleMock = vi.mocked(requireRole);
const reorderMock = vi.mocked(reorder);
const createMock = vi.mocked(create);
const updateHiddenSectionsMock = vi.mocked(updateHiddenSections);

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

  it("setFunctionSections refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await setFunctionSections(1, ["tasks"]);
    expect((res as { type: string }).type).toBe("error");
    expect(updateHiddenSectionsMock).not.toHaveBeenCalled();
  });

  it("setFunctionSections keeps only known section keys, deduped", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    updateHiddenSectionsMock.mockResolvedValue({} as never);
    const res = await setFunctionSections(5, ["tasks", "tasks", "bogus", "reserves", "<script>"]);
    expect((res as { type: string }).type).toBe("success");
    expect(updateHiddenSectionsMock).toHaveBeenCalledWith(5, ["tasks", "reserves"]);
  });

  it("setFunctionSections rejects an invalid id", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const res = await setFunctionSections(0, ["tasks"]);
    expect((res as { type: string }).type).toBe("error");
    expect(updateHiddenSectionsMock).not.toHaveBeenCalled();
  });
});
