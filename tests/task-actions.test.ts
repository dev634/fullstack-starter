import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // passe 3b, point 2 regression test below needs to force it false for one
  // call to exercise the out-of-scope branch.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
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
  findProjectId: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/repository/taskGroups", () => ({ create: vi.fn() }));
// Passe 3a, point 3: addTask/addTaskSeries/setTaskCategory now cross-check a
// submitted categoryId against the target project — no default resolved
// value here on purpose, so every test that exercises a categoryId path
// must say explicitly which project it claims to belong to (see
// docs/CONVENTIONS.md's mock-parity trap: a silently-undefined resolution
// would make the new guard reject every one of them the same way).
vi.mock("@/repository/taskCategories", () => ({ findProjectId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addTask, addTaskSeries, toggleTask, updateTaskQuantity, editTask, deleteTask, setTaskCategory } from "@/actions/tasks/tasks";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { create, createMany, toggle, updateQuantity, update, remove, setCategory, findProjectId as findTaskProjectId } from "@/repository/tasks";
import { create as createGroup } from "@/repository/taskGroups";
import { findProjectId as findTaskCategoryProjectId } from "@/repository/taskCategories";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const findTaskProjectIdMock = vi.mocked(findTaskProjectId);
const createMock = vi.mocked(create);
const createManyMock = vi.mocked(createMany);
const createGroupMock = vi.mocked(createGroup);
const toggleMock = vi.mocked(toggle);
const updateQuantityMock = vi.mocked(updateQuantity);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const setCategoryMock = vi.mocked(setCategory);
const findTaskCategoryProjectIdMock = vi.mocked(findTaskCategoryProjectId);
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
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(2); // category 4 belongs to project 2
    createMock.mockResolvedValue({ id: 1 } as never);
    await addTask(
      initial,
      formOf({ clientId: "1", projectId: "2", title: "Panneaux", quantityTarget: "20", categoryId: "4" })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ quantityTarget: 20, categoryId: 4 })
    );
  });

  // Passe 3a, point 3: the category <select> only ever lists this project's
  // own categories — but nothing server-side checked that before, so a
  // submitted categoryId from another project silently filed the task
  // there, invisible in both projects' listings.
  it("addTask rejects a categoryId belonging to another project", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(99); // not project 2
    const res = await addTask(
      initial,
      formOf({ clientId: "1", projectId: "2", title: "Panneaux", categoryId: "4" })
    );
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addTask rejects a categoryId that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(null);
    const res = await addTask(
      initial,
      formOf({ clientId: "1", projectId: "2", title: "Panneaux", categoryId: "4" })
    );
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("setTaskCategory refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await setTaskCategory(1, 4, 1, 2);
    expect(res.type).toBe("error");
    expect(setCategoryMock).not.toHaveBeenCalled();
  });

  it("setTaskCategory assigns the task's category when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    // The task's real project (findTaskProjectId) defaults to 1 — the
    // category must resolve to that same project for the new cross-check to
    // let the assignment through.
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(1);
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
    // Clearing never needs to look up a category at all.
    expect(findTaskCategoryProjectIdMock).not.toHaveBeenCalled();
  });

  // Passe 3a, point 3.
  it("setTaskCategory rejects a categoryId belonging to another project", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(99); // task's real project is 1
    const res = await setTaskCategory(1, 4, 1, 2);
    expect(res.type).toBe("error");
    expect(setCategoryMock).not.toHaveBeenCalled();
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
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(2); // category 5 belongs to project 2
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

  // Passe 3a, point 3.
  it("addTaskSeries rejects a categoryId belonging to another project, before creating anything", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTaskCategoryProjectIdMock.mockResolvedValueOnce(99); // not project 2
    const res = await addTaskSeries(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Strings onduleur", pattern: "String {n}", from: "1", to: "2", categoryId: "5" })
    );
    expect(res.type).toBe("error");
    expect(createGroupMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
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

  // Adversarial pass 2, point 8: a NaN quantityDone isn't reachable through
  // the UI (ProjectTaskRow guards Number.isInteger before calling this), but
  // a Server Action's arguments still travel in React's own wire format,
  // which — unlike JSON — can carry NaN. The repository's clamp
  // (Math.max(0, Math.min(NaN, target))) propagates it and used to write
  // quantityDone = null, done = false: a state the UI can never produce.
  it("updateTaskQuantity rejects a NaN quantityDone instead of writing it through the repository's clamp", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await updateTaskQuantity(1, NaN, 1, 2);
    expect(res.type).toBe("error");
    expect(updateQuantityMock).not.toHaveBeenCalled();
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

  // Passe 3b, point 2: a task that exists but sits outside the caller's
  // scope used to say "Accès refusé" (requireProjectAccess's own message),
  // distinct from "Identifiant de tâche invalide" for an id that doesn't
  // exist at all — both are resolved from the SAME id via the database, so
  // the distinct wording let a restricted EDITOR tell "exists elsewhere"
  // apart from "doesn't exist" and enumerate ids across the whole company.
  // Both must now read identically.
  it("deleteTask says the exact same thing for a task outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findTaskProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteTask(999, 1, 2);

    findTaskProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteTask(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
