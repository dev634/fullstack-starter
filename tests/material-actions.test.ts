import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // passe 3b, point 2 regression test below needs to force it false once.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/projectMaterials", () => ({
  create: vi.fn(),
  createOrAccumulate: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findByProject: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
// Passe 3b (C2), point 1: addMaterial/editMaterial now cross-check a
// task/group/category link against the material's own project (see
// actions/projectMaterials/projectMaterials.ts's linkTargetInProject) —
// resolves to project 2 by default, matching every test below's
// `projectId: "2"`, the same convention as findMaterialProjectId above.
vi.mock("@/repository/tasks", () => ({ findProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("@/repository/taskGroups", () => ({ findProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("@/repository/taskCategories", () => ({ findProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addMaterial, editMaterial, deleteMaterial } from "@/actions/projectMaterials/projectMaterials";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { createOrAccumulate, update, remove, findProjectId as findMaterialProjectId } from "@/repository/projectMaterials";
import { findProjectId as findTaskProjectId } from "@/repository/tasks";
import { findProjectId as findTaskGroupProjectId } from "@/repository/taskGroups";
import { findProjectId as findTaskCategoryProjectId } from "@/repository/taskCategories";
import { MAX_SCAN_QUANTITY } from "@/schemas/deliveryNoteScan";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const createMock = vi.mocked(createOrAccumulate);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const findMaterialProjectIdMock = vi.mocked(findMaterialProjectId);
const findTaskProjectIdMock = vi.mocked(findTaskProjectId);
const findTaskGroupProjectIdMock = vi.mocked(findTaskGroupProjectId);
const findTaskCategoryProjectIdMock = vi.mocked(findTaskCategoryProjectId);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("material actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addMaterial refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "Panneau 400W", quantity: "10" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "", quantity: "10" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial rejects a negative quantity with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "Onduleur", quantity: "-1" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.quantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial accepts a zero quantity — a valid out-of-stock state", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    const res = await addMaterial(initial, formOf({ clientId: "1", projectId: "1", name: "Onduleur", quantity: "0" }));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 }));
  });

  // Adversarial pass 2, point 6: the manual entry form used to have no
  // ceiling at all on quantity — 1e308 passed straight through, and a
  // SECOND row with the same reference then overflowed the Float column via
  // createOrAccumulate's `increment`. Shares MAX_SCAN_QUANTITY with the scan
  // path's own bound (schemas/deliveryNoteScan.ts) rather than a second,
  // driftable number.
  it("addMaterial rejects a quantity over MAX_SCAN_QUANTITY with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Onduleur", quantity: String(MAX_SCAN_QUANTITY + 1) })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.quantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial accepts a quantity at exactly MAX_SCAN_QUANTITY", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Onduleur", quantity: String(MAX_SCAN_QUANTITY) })
    );
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ quantity: MAX_SCAN_QUANTITY }));
  });

  // Passe 3a, point 4: repository/projectMaterials.ts throws
  // `{ type: "repositoryError", message: "Database Error creating material." }`
  // on a real DB failure — this action must never relay that raw English
  // string, only the localized generic error (getErrorMessage's fallback).
  it("addMaterial replaces a raw repository DB error with the localized fallback, never the internal English message", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating material." });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Panneau 400W", quantity: "24" })
    );
    expect(res.type).toBe("error");
    expect(res.message).toBe("Erreur serveur. Réessaie plus tard.");
    expect(res.message).not.toContain("Database Error");
  });

  it("addMaterial creates the material when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Panneau 400W", quantity: "24", unit: "pièce" })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, name: "Panneau 400W", quantity: 24, unit: "pièce" })
    );
    expect(res.type).toBe("success");
  });

  it("addMaterial passes optional supplier/reference through", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Onduleur",
        quantity: "1",
        supplierName: "Solaredge",
        reference: "SE-5000",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ supplierName: "Solaredge", reference: "SE-5000" })
    );
  });

  it("addMaterial rejects a linked task without a required quantity", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Panneau", quantity: "10", link: "task:5" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.requiredQuantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial passes taskId/requiredQuantity through when linked to a task", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Panneau 400W",
        quantity: "10",
        link: "task:5",
        requiredQuantity: "24",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, taskGroupId: undefined, requiredQuantity: 24 })
    );
  });

  it("addMaterial rejects a linked task series without a required quantity", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Panneau", quantity: "10", link: "group:7" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.requiredQuantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial passes taskGroupId/requiredQuantity through when linked to a series", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Panneau 400W",
        quantity: "10",
        link: "group:7",
        requiredQuantity: "24",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskGroupId: 7, taskId: undefined, requiredQuantity: 24 })
    );
  });

  it("addMaterial rejects a linked task category without a required quantity", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterial(
      initial,
      formOf({ clientId: "1", projectId: "1", name: "Panneau", quantity: "10", link: "category:3" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.requiredQuantity).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addMaterial passes taskCategoryId/requiredQuantity through when linked to a category", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
    await addMaterial(
      initial,
      formOf({
        clientId: "1",
        projectId: "2",
        name: "Panneau 400W",
        quantity: "10",
        link: "category:3",
        requiredQuantity: "24",
      })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskCategoryId: 3, taskId: undefined, taskGroupId: undefined, requiredQuantity: 24 })
    );
  });

  // Passe 3b (C2), point 1: the picker only ever lists the current project's
  // own tasks/series/categories — but nothing server-side checked that
  // before, so a submitted "task:<id>" for a task belonging to ANOTHER
  // project's company silently linked the material to it (its title then
  // rendering straight into the material's own project's UI). Same class of
  // gap as setAssignee's company/intérimaire cross-check
  // (tests/task-assignee.test.ts), just encoded in a string instead of its
  // own form field — see linkTargetInProject's own comment.
  describe("cross-checks a task/series/category link against the material's own project", () => {
    it("addMaterial rejects a task belonging to another project", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findTaskProjectIdMock.mockResolvedValueOnce(99); // task's real project is 2
      const res = await addMaterial(
        initial,
        formOf({
          clientId: "1",
          projectId: "2",
          name: "Panneau 400W",
          quantity: "10",
          link: "task:5",
          requiredQuantity: "24",
        })
      );
      expect(res.type).toBe("error");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("addMaterial rejects a task series belonging to another project", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findTaskGroupProjectIdMock.mockResolvedValueOnce(99);
      const res = await addMaterial(
        initial,
        formOf({
          clientId: "1",
          projectId: "2",
          name: "Panneau 400W",
          quantity: "10",
          link: "group:7",
          requiredQuantity: "24",
        })
      );
      expect(res.type).toBe("error");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("addMaterial rejects a task category belonging to another project", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findTaskCategoryProjectIdMock.mockResolvedValueOnce(99);
      const res = await addMaterial(
        initial,
        formOf({
          clientId: "1",
          projectId: "2",
          name: "Panneau 400W",
          quantity: "10",
          link: "category:3",
          requiredQuantity: "24",
        })
      );
      expect(res.type).toBe("error");
      expect(createMock).not.toHaveBeenCalled();
    });

    it("editMaterial rejects re-linking to a task belonging to another project", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findTaskProjectIdMock.mockResolvedValueOnce(99); // task's real project is 2
      const res = await editMaterial(
        initial,
        formOf({
          id: "1",
          clientId: "1",
          projectId: "2",
          name: "Panneau 500W",
          quantity: "15",
          link: "task:5",
          requiredQuantity: "20",
        })
      );
      expect(res.type).toBe("error");
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("does not look up a task/series/category at all when the link is cleared", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      createMock.mockResolvedValue({ material: { id: 1 }, accumulated: false } as never);
      await addMaterial(
        initial,
        formOf({ clientId: "1", projectId: "2", name: "Onduleur", quantity: "1", link: "" })
      );
      expect(findTaskProjectIdMock).not.toHaveBeenCalled();
      expect(findTaskGroupProjectIdMock).not.toHaveBeenCalled();
      expect(findTaskCategoryProjectIdMock).not.toHaveBeenCalled();
    });
  });

  it("editMaterial refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await editMaterial(initial, formOf({ id: "1", clientId: "1", projectId: "1", name: "Panneau", quantity: "10" }));
    expect(res.type).toBe("error");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("editMaterial rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await editMaterial(initial, formOf({ id: "1", clientId: "1", projectId: "1", name: "", quantity: "10" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("editMaterial updates the material when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await editMaterial(
      initial,
      formOf({ id: "1", clientId: "1", projectId: "2", name: "Panneau 500W", quantity: "15", unit: "pièce" })
    );
    expect(updateMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Panneau 500W", quantity: 15, unit: "pièce" }));
    expect(res.type).toBe("success");
  });

  it("editMaterial rejects a linked material with no requiredQuantity", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await editMaterial(
      initial,
      formOf({ id: "1", clientId: "1", projectId: "2", name: "Panneau 500W", quantity: "15", link: "task:5" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.requiredQuantity).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("editMaterial allows a blank requiredQuantity when the material isn't linked", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await editMaterial(
      initial,
      formOf({ id: "1", clientId: "1", projectId: "2", name: "Panneau 500W", quantity: "15", link: "" })
    );
    expect(res.type).toBe("success");
  });

  it("editMaterial links the material to a task, passing the FK through to update", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await editMaterial(
      initial,
      formOf({ id: "1", clientId: "1", projectId: "2", name: "Panneau 500W", quantity: "15", link: "task:5", requiredQuantity: "20" })
    );
    expect(updateMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ taskId: 5, taskGroupId: undefined, taskCategoryId: undefined, requiredQuantity: 20 })
    );
    expect(res.type).toBe("success");
  });

  it("deleteMaterial refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteMaterial(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteMaterial deletes the material when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteMaterial(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });

  // Passe 3b, point 2: a material that exists but sits outside the caller's
  // scope used to say "Accès refusé", distinct from "Identifiant de matériel
  // invalide" for an id that doesn't exist at all — both resolved from the
  // SAME id via the database, so the distinct wording let a restricted
  // EDITOR enumerate ids across the whole company. Both must now match.
  it("deleteMaterial says the exact same thing for a material outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findMaterialProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteMaterial(999, 1, 2);

    findMaterialProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteMaterial(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.materials.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.materials.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
