import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), projectIds: null }),
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/repository/projects", () => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  findByClient: vi.fn(),
  findById: vi.fn(),
}));
vi.mock("@/repository/clients", () => ({ findByEmail: vi.fn() }));
vi.mock("@/repository/projectFolders", () => ({ createDefaults: vi.fn() }));
vi.mock("@/repository/projectActivity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addProject, updateProject, deleteProject, getProject, getProjectsForClient } from "@/actions/projects/projects";
import { requireRole } from "@/lib/authz";
import { canReachProject, getAccessContext } from "@/lib/accessContext";
import { create, update, remove, softDelete, findByClient, findById } from "@/repository/projects";
import { createDefaults } from "@/repository/projectFolders";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const getAccessContextMock = vi.mocked(getAccessContext);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const softDeleteMock = vi.mocked(softDelete);
const findByClientMock = vi.mocked(findByClient);
const findByIdMock = vi.mocked(findById);
const createDefaultsMock = vi.mocked(createDefaults);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("project actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addProject refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addProject(initial, formOf({ clientId: "1", name: "Toiture" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addProject rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addProject(initial, formOf({ clientId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addProject creates the project with a default ETUDE status when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addProject(initial, formOf({ clientId: "1", name: "Toiture principale" }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 1, name: "Toiture principale", status: "ETUDE" })
    );
    expect(res.type).toBe("success");
  });

  it("addProject seeds the standard root folders for the new project", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 7 } as never);
    await addProject(initial, formOf({ clientId: "1", name: "Toiture principale" }));
    expect(createDefaultsMock).toHaveBeenCalledWith(7);
  });

  it("addProject treats blank power/budget as absent rather than a validation error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addProject(
      initial,
      formOf({ clientId: "1", name: "Toiture", power: "", budget: "" })
    );
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ power: undefined, budget: undefined })
    );
  });

  it("addProject parses a decimal power value", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    await addProject(initial, formOf({ clientId: "1", name: "Toiture", power: "9.5" }));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ power: 9.5 }));
  });

  it("updateProject refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await updateProject(initial, formOf({ id: "1", clientId: "1", name: "Toiture" }));
    expect(res.type).toBe("error");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updateProject updates when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await updateProject(
      initial,
      formOf({ id: "1", clientId: "1", name: "Toiture", status: "EN_COURS" })
    );
    expect(updateMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Toiture", status: "EN_COURS" }));
    expect(res.type).toBe("success");
  });

  it("deleteProject refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteProject(1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteProject soft-deletes the project when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    softDeleteMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteProject(1, 2);
    expect(softDeleteMock).toHaveBeenCalledWith(1);
    expect(removeMock).not.toHaveBeenCalled();
    expect(res.type).toBe("success");
  });

  it("getProjectsForClient refuses a session below VIEWER", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await getProjectsForClient(1);
    expect(res.type).toBe("error");
    expect(findByClientMock).not.toHaveBeenCalled();
  });

  it("getProjectsForClient returns projects for a VIEWER-or-above session", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "viewer@example.com" });
    findByClientMock.mockResolvedValue([{ id: 1, name: "Toiture" }] as never);
    const res = await getProjectsForClient(1);
    expect(res.type).toBe("success");
    expect(findByClientMock).toHaveBeenCalledWith(1, undefined);
  });

  // Regression coverage for docs/PENTEST-2026-08.md (F1): a caller restricted
  // to specific projects must not be able to read or delete a project outside
  // that set by calling the Server Action directly with a foreign id — the
  // UI never offering that id is not a control.
  describe("project-scope enforcement (F1 regression)", () => {
    it("deleteProject refuses a project outside the caller's scope, even with the right role", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "chef@example.com" });
      canReachProjectMock.mockReturnValueOnce(false);

      const res = await deleteProject(203, 490);

      expect(res.type).toBe("error");
      expect(softDeleteMock).not.toHaveBeenCalled();
    });

    it("getProject masks a project outside the caller's scope as not found, not as an error", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "chef@example.com" });
      findByIdMock.mockResolvedValue({ id: 203, name: "Chantier d'un autre client", deletedAt: null } as never);
      getAccessContextMock.mockResolvedValue({
        email: "chef@example.com",
        role: "EDITOR",
        hiddenSections: new Set(),
        projectIds: new Set([202]), // assigned only to project 202
      } as never);
      canReachProjectMock.mockReturnValueOnce(false);

      const res = await getProject(203);

      if (res.type !== "success") throw new Error(`expected success, got ${res.type}`);
      expect(res.data).toBeNull();
    });

    it("getProject returns the project once it IS in the caller's scope", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "chef@example.com" });
      findByIdMock.mockResolvedValue({ id: 202, name: "Mon chantier", deletedAt: null } as never);
      canReachProjectMock.mockReturnValueOnce(true);

      const res = await getProject(202);

      if (res.type !== "success") throw new Error(`expected success, got ${res.type}`);
      expect(res.data).toEqual(expect.objectContaining({ id: 202 }));
    });
  });
});
