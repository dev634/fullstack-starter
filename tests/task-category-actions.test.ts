import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/repository/taskCategories", () => ({
  create: vi.fn(),
  findById: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/repository/taskGroups", () => ({
  findById: vi.fn(),
  remove: vi.fn(),
  setCategory: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addTaskCategory, deleteTaskCategory, getTaskCategory } from "@/actions/taskCategories/taskCategories";
import { setTaskGroupCategory } from "@/actions/taskGroups/taskGroups";
import { requireSession, requireRole } from "@/lib/authz";
import { create, findById, remove } from "@/repository/taskCategories";
import { setCategory } from "@/repository/taskGroups";

const requireSessionMock = vi.mocked(requireSession);
const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const findByIdMock = vi.mocked(findById);
const removeMock = vi.mocked(remove);
const setCategoryMock = vi.mocked(setCategory);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("getTaskCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses without a session", async () => {
    requireSessionMock.mockResolvedValue({ type: "error", message: "Unauthorized." });
    const res = await getTaskCategory(1);
    expect(res.type).toBe("error");
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("returns the category for any authenticated session", async () => {
    requireSessionMock.mockResolvedValue(null);
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    const res = await getTaskCategory(1);
    expect(res.type).toBe("success");
    expect(findByIdMock).toHaveBeenCalledWith(1);
  });
});

describe("addTaskCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addTaskCategory(initial, formOf({ clientId: "1", projectId: "1", name: "Toiture" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addTaskCategory(initial, formOf({ clientId: "1", projectId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates the category when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    const res = await addTaskCategory(initial, formOf({ clientId: "1", projectId: "2", name: "Toiture" }));
    expect(createMock).toHaveBeenCalledWith({ projectId: 2, name: "Toiture" });
    expect(res.type).toBe("success");
  });
});

describe("deleteTaskCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteTaskCategory(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes the category when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteTaskCategory(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});

describe("setTaskGroupCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await setTaskGroupCategory(1, 2, 1, 2);
    expect(res.type).toBe("error");
    expect(setCategoryMock).not.toHaveBeenCalled();
  });

  it("assigns a category to an existing series", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    setCategoryMock.mockResolvedValue({ id: 1, categoryId: 2 } as never);
    const res = await setTaskGroupCategory(1, 2, 1, 2);
    expect(setCategoryMock).toHaveBeenCalledWith(1, 2);
    expect(res.type).toBe("success");
  });

  it("clears the category when passed null", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    setCategoryMock.mockResolvedValue({ id: 1, categoryId: null } as never);
    const res = await setTaskGroupCategory(1, null, 1, 2);
    expect(setCategoryMock).toHaveBeenCalledWith(1, null);
    expect(res.type).toBe("success");
  });
});
