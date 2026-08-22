import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // passe 3b, point 2 regression tests below need to force it false once.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/taskCategories", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("@/repository/taskGroups", () => ({
  remove: vi.fn(),
  setCategory: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addTaskCategory, deleteTaskCategory } from "@/actions/taskCategories/taskCategories";
import { setTaskGroupCategory } from "@/actions/taskGroups/taskGroups";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { create, remove, findProjectId as findCategoryProjectId } from "@/repository/taskCategories";
import { setCategory, findProjectId as findGroupProjectId } from "@/repository/taskGroups";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const findCategoryProjectIdMock = vi.mocked(findCategoryProjectId);
const setCategoryMock = vi.mocked(setCategory);
const findGroupProjectIdMock = vi.mocked(findGroupProjectId);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

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

  // Passe 3b, point 2: a category that exists but sits outside the caller's
  // scope used to say "Accès refusé", distinct from "Identifiant de tâche
  // invalide" for an id that doesn't exist at all — both resolved from the
  // SAME id via the database, so the distinct wording let a restricted
  // EDITOR enumerate ids across the whole company. Both must now match.
  it("says the exact same thing for a category outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findCategoryProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteTaskCategory(999, 1, 2);

    findCategoryProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteTaskCategory(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
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

  // Passe 3b, point 2 — see deleteTaskCategory's regression test above.
  it("says the exact same thing for a series' group outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findGroupProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await setTaskGroupCategory(999, 2, 1, 2);

    findGroupProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await setTaskGroupCategory(1, 2, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(setCategoryMock).not.toHaveBeenCalled();
  });
});
