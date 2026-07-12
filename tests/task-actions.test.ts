import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/repository/tasks", () => ({
  create: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  findByProject: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addTask, toggleTask, deleteTask } from "@/actions/tasks/tasks";
import { requireRole } from "@/lib/authz";
import { create, toggle, remove } from "@/repository/tasks";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const toggleMock = vi.mocked(toggle);
const removeMock = vi.mocked(remove);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("task actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addTask refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addTask(initial, formOf({ clientId: "1", projectId: "1", title: "Poser les panneaux" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addTask rejects a missing title with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addTask(initial, formOf({ clientId: "1", projectId: "1", title: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.title).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addTask creates the task when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addTask(initial, formOf({ clientId: "1", projectId: "2", title: "Poser les panneaux" }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, title: "Poser les panneaux" })
    );
    expect(res.type).toBe("success");
  });

  it("addTask passes an optional due date through", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addTask(initial, formOf({ clientId: "1", projectId: "2", title: "Raccordement", dueDate: "2026-08-01" }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: "2026-08-01" })
    );
  });

  it("toggleTask refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await toggleTask(1, true, 1, 2);
    expect(res.type).toBe("error");
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it("toggleTask toggles the task when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    toggleMock.mockResolvedValue({ id: 1, done: true } as never);
    const res = await toggleTask(1, true, 1, 2);
    expect(toggleMock).toHaveBeenCalledWith(1, true);
    expect(res.type).toBe("success");
  });

  it("deleteTask refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteTask(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteTask deletes the task when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteTask(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});
