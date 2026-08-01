import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/repository/tasks", () => ({
  create: vi.fn(),
  createMany: vi.fn(),
  toggle: vi.fn(),
  updateQuantity: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findByProject: vi.fn(),
  setCategory: vi.fn(),
}));
vi.mock("@/repository/taskGroups", () => ({ create: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addTask, addTaskSeries, toggleTask, updateTaskQuantity, editTask, deleteTask, setTaskCategory } from "@/actions/tasks/tasks";
import { requireRole } from "@/lib/authz";
import { create, createMany, toggle, updateQuantity, update, remove, setCategory } from "@/repository/tasks";
import { create as createGroup } from "@/repository/taskGroups";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const createManyMock = vi.mocked(createMany);
const createGroupMock = vi.mocked(createGroup);
const toggleMock = vi.mocked(toggle);
const updateQuantityMock = vi.mocked(updateQuantity);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const setCategoryMock = vi.mocked(setCategory);
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

  it("addTask passes an optional quantityTarget through", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addTask(initial, formOf({ clientId: "1", projectId: "2", title: "Panneaux", quantityTarget: "20" }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ quantityTarget: 20 })
    );
  });

  it("addTask passes an optional categoryId through, even for a quantity-tracked task", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addTask(
      initial,
      formOf({ clientId: "1", projectId: "2", title: "Panneaux", quantityTarget: "20", categoryId: "4" })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ quantityTarget: 20, categoryId: 4 })
    );
  });

  it("setTaskCategory refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await setTaskCategory(1, 4, 1, 2);
    expect(res.type).toBe("error");
    expect(setCategoryMock).not.toHaveBeenCalled();
  });

  it("setTaskCategory assigns the task's category when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    setCategoryMock.mockResolvedValue({ id: 1, categoryId: 4 } as never);
    const res = await setTaskCategory(1, 4, 1, 2);
    expect(setCategoryMock).toHaveBeenCalledWith(1, 4);
    expect(res.type).toBe("success");
  });

  it("setTaskCategory clears the task's category when passed null", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    setCategoryMock.mockResolvedValue({ id: 1, categoryId: null } as never);
    await setTaskCategory(1, null, 1, 2);
    expect(setCategoryMock).toHaveBeenCalledWith(1, null);
  });

  it("addTaskSeries refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addTaskSeries(initial, formOf({ clientId: "1", projectId: "1", name: "Strings", pattern: "String {n}", from: "1", to: "27" }));
    expect(res.type).toBe("error");
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("addTaskSeries rejects a pattern without {n}", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addTaskSeries(initial, formOf({ clientId: "1", projectId: "1", name: "Strings", pattern: "String", from: "1", to: "27" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.pattern).toBeTruthy();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("addTaskSeries rejects a 'to' smaller than 'from'", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addTaskSeries(initial, formOf({ clientId: "1", projectId: "1", name: "Strings", pattern: "String {n}", from: "10", to: "5" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.to).toBeTruthy();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("addTaskSeries rejects a range larger than the max series size", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addTaskSeries(initial, formOf({ clientId: "1", projectId: "1", name: "Strings", pattern: "String {n}", from: "1", to: "500" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.to).toBeTruthy();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("addTaskSeries creates a named group then one task per number in the range", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createGroupMock.mockResolvedValue({ id: 9, projectId: 2, name: "Strings onduleur", pattern: "String {n}" } as never);
    createManyMock.mockResolvedValue({ count: 27 } as never);
    const res = await addTaskSeries(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Strings onduleur", pattern: "String {n}", from: "1", to: "27" })
    );
    expect(createGroupMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, name: "Strings onduleur", pattern: "String {n}" })
    );
    expect(createManyMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        { projectId: 2, groupId: 9, title: "String 1" },
        { projectId: 2, groupId: 9, title: "String 27" },
      ])
    );
    const calledWith = createManyMock.mock.calls[0][0];
    expect(calledWith).toHaveLength(27);
    expect(res.type).toBe("success");
  });

  it("addTaskSeries passes an optional categoryId through to the group", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createGroupMock.mockResolvedValue({ id: 9, projectId: 2, name: "Strings onduleur", pattern: "String {n}" } as never);
    createManyMock.mockResolvedValue({ count: 2 } as never);
    await addTaskSeries(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Strings onduleur", pattern: "String {n}", from: "1", to: "2", categoryId: "5" })
    );
    expect(createGroupMock).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 5 })
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

  it("updateTaskQuantity refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await updateTaskQuantity(1, 5, 1, 2);
    expect(res.type).toBe("error");
    expect(updateQuantityMock).not.toHaveBeenCalled();
  });

  it("updateTaskQuantity updates the task's progress when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateQuantityMock.mockResolvedValue({ id: 1, quantityDone: 5 } as never);
    const res = await updateTaskQuantity(1, 5, 1, 2);
    expect(updateQuantityMock).toHaveBeenCalledWith(1, 5);
    expect(res.type).toBe("success");
  });

  it("editTask refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await editTask(initial, formOf({ id: "1", clientId: "1", projectId: "1", title: "Poser les panneaux" }));
    expect(res.type).toBe("error");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("editTask rejects a missing title with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await editTask(initial, formOf({ id: "1", clientId: "1", projectId: "1", title: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.title).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("editTask updates the task when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await editTask(
      initial,
      formOf({ id: "1", clientId: "1", projectId: "2", title: "Raccordement final", quantityTarget: "30" })
    );
    expect(updateMock).toHaveBeenCalledWith(1, expect.objectContaining({ title: "Raccordement final", quantityTarget: 30 }));
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
