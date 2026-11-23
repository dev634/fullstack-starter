import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/repository/projects", () => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  findById: vi.fn(),
  findTrashState: vi.fn().mockResolvedValue({ selfTrashed: false, inTrash: false }),
  findDates: vi.fn(),
}));
vi.mock("@/repository/clients", () => ({ findByEmail: vi.fn(), findTrashState: vi.fn().mockResolvedValue({ inTrash: false }), }));
vi.mock("@/repository/projectFolders", () => ({ createDefaults: vi.fn() }));
vi.mock("@/repository/projectActivity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addProject, updateProject, deleteProject, getProject } from "@/actions/projects/projects";
import { requireRole } from "@/lib/authz";
import { canReachProject, getAccessContext } from "@/lib/accessContext";
import { create, update, remove, softDelete, findById, findDates, findTrashState } from "@/repository/projects";
import { logActivity } from "@/repository/projectActivity";
import fr from "@/lib/i18n/dictionaries/fr";
import { createDefaults } from "@/repository/projectFolders";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const getAccessContextMock = vi.mocked(getAccessContext);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const softDeleteMock = vi.mocked(softDelete);
const findByIdMock = vi.mocked(findById);
const createDefaultsMock = vi.mocked(createDefaults);
const initial = { type: null, message: "" } as const;
// vi.clearAllMocks() empties calls but NOT implementations: a mockResolvedValue
// set in one test would still answer in the next. beforeEach puts the "live"
// state back, so no test depends on another one having cleaned up after itself.
const LIVE = { selfTrashed: false, parentTrashed: false, inTrash: false };
const TRASHED = { selfTrashed: true, parentTrashed: false, inTrash: true };

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("project actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findTrashState).mockResolvedValue(LIVE);
  });

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

  // Lot 5b — "absent is not empty": a payload that omits a field must reach the
  // repository without it (left alone), not rewritten to null or a default.
  it("updateProject: an omitted field is NOT sent to the repository, a blank one is sent as null", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1, name: "Toiture existante" } as never);
    await updateProject(initial, formOf({ id: "1", clientId: "1", notes: "" }));
    const data = updateMock.mock.calls[0][1];
    expect(data.notes).toBeNull();
    for (const omitted of ["name", "type", "status", "power", "budget", "address", "businessNumber", "startDate", "endDate"] as const) {
      expect(data[omitted], omitted).toBeUndefined();
    }
  });

  // Lot 5b: a payload carrying ONE bound is compared to the stored other one.
  describe("updateProject: a single bound is compared to the stored other one", () => {
    const stored = { startDate: "2026-03-10", endDate: "2026-06-30" };
    beforeEach(() => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      updateMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
      vi.mocked(findDates).mockResolvedValue(stored);
    });

    it("refuses an endDate before the stored start, on endDate, with the ordering message", async () => {
      const res = await updateProject(initial, formOf({ id: "1", clientId: "1", endDate: "2026-01-01" }));
      expect(res.type).toBe("zodError");
      expect(res.fieldsForm?.endDate).toBe(fr.errors.endBeforeStart);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("refuses a startDate after the stored end", async () => {
      const res = await updateProject(initial, formOf({ id: "1", clientId: "1", startDate: "2026-12-01" }));
      expect(res.type).toBe("zodError");
      expect(res.fieldsForm?.endDate).toBe(fr.errors.endBeforeStart);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("accepts a single bound that keeps the order, and never reads when both bounds travel or one is cleared", async () => {
      expect((await updateProject(initial, formOf({ id: "1", clientId: "1", endDate: "2026-07-01" }))).type).toBe("success");
      expect((await updateProject(initial, formOf({ id: "1", clientId: "1", startDate: "2026-02-01", endDate: "2026-03-01" }))).type).toBe("success");
      vi.mocked(findDates).mockClear();
      expect((await updateProject(initial, formOf({ id: "1", clientId: "1", startDate: "2026-12-01", endDate: "" }))).type).toBe("success");
      expect(vi.mocked(findDates)).not.toHaveBeenCalled();
    });

    it("accepts a bound when the other one is not set in the database", async () => {
      vi.mocked(findDates).mockResolvedValue({ startDate: null, endDate: null });
      expect((await updateProject(initial, formOf({ id: "1", clientId: "1", endDate: "2020-01-01" }))).type).toBe("success");
    });
  });

  it("updateProject logs the name the row carries, not the (optional) submitted one", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1, name: "Toiture existante" } as never);
    await updateProject(initial, formOf({ id: "1", clientId: "1" }));
    expect(vi.mocked(logActivity)).toHaveBeenCalledWith(expect.objectContaining({ projectName: "Toiture existante" }));
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

  // F10: scope alone no longer opens a project. Trashing it again would
  // re-date deletedAt and journal a second DELETED.
  it("deleteProject refuses a project already in the trash (no second DELETED)", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    vi.mocked(findTrashState).mockResolvedValue(TRASHED);
    const res = await deleteProject(1, 2);
    expect(res).toEqual({ type: "error", message: fr.errors.inTrash });
    expect(softDeleteMock).not.toHaveBeenCalled();
    expect(vi.mocked(logActivity)).not.toHaveBeenCalled();
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
      findByIdMock.mockResolvedValue({ id: 203, name: "Chantier d'un autre client", deletedAt: null, client: { deletedAt: null } } as never);
      getAccessContextMock.mockResolvedValue({
        email: "chef@example.com",
        role: "EDITOR",
        hiddenSections: new Set(),
        hiddenAreas: new Set(),
        projectIds: new Set([202]), // assigned only to project 202
      } as never);
      canReachProjectMock.mockReturnValueOnce(false);

      const res = await getProject(203);

      if (res.type !== "success") throw new Error(`expected success, got ${res.type}`);
      expect(res.data).toBeNull();
    });

    it("getProject returns the project once it IS in the caller's scope", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "chef@example.com" });
      findByIdMock.mockResolvedValue({ id: 202, name: "Mon chantier", deletedAt: null, client: { deletedAt: null } } as never);
      canReachProjectMock.mockReturnValueOnce(true);

      const res = await getProject(202);

      if (res.type !== "success") throw new Error(`expected success, got ${res.type}`);
      expect(res.data).toEqual(expect.objectContaining({ id: 202 }));
    });

    // The page must not show what every button on it would refuse: a live
    // project under a company in the trash is frozen by requireProjectAccess,
    // so it reads as "not found" here, exactly like a trashed project.
    it("getProject masks a LIVE project whose COMPANY is in the trash, like a trashed one", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "chef@example.com" });
      canReachProjectMock.mockReturnValue(true);
      findByIdMock.mockResolvedValue({ id: 202, name: "Mon chantier", deletedAt: null, client: { deletedAt: new Date() } } as never);

      const res = await getProject(202);

      if (res.type !== "success") throw new Error(`expected success, got ${res.type}`);
      expect(res.data).toBeNull();
    });
  });
});
