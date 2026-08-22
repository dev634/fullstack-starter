import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/repository/reserves", () => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("@/repository/reservePlans", () => ({ create: vi.fn(), findById: vi.fn().mockResolvedValue({ id: 5, projectId: 2 }), remove: vi.fn() }));
vi.mock("@/repository/reservePlanFolders", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn(),
}));
vi.mock("@/repository/reservePhotos", () => ({
  create: vi.fn(),
  findById: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadReservePlan: vi.fn(),
  destroyReservePlan: vi.fn(),
  uploadReservePhoto: vi.fn(),
  destroyReservePhoto: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import {
  addReserve,
  updateReserve,
  deleteReserve,
  addReservePhoto,
  addReservePlan,
  deleteReservePlan,
  deleteReservePhoto,
} from "@/actions/reserves/reserves";
import { requireRole } from "@/lib/authz";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { canReachProject } from "@/lib/accessContext";
import { create, update, remove, findProjectId as findReserveProjectId } from "@/repository/reserves";
import { create as createPhoto, findById as findPhotoById } from "@/repository/reservePhotos";
import { create as createPlan, findById as findPlanById } from "@/repository/reservePlans";
import { findProjectId as findReserveFolderProjectId } from "@/repository/reservePlanFolders";
import { uploadReservePhoto, uploadReservePlan, destroyReservePlan, destroyReservePhoto } from "@/lib/cloudinary";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const requireSectionMock = vi.mocked(requireSectionAccess);
const canReachProjectMock = vi.mocked(canReachProject);
const findReserveProjectIdMock = vi.mocked(findReserveProjectId);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const removeMock = vi.mocked(remove);
const createPhotoMock = vi.mocked(createPhoto);
const createPlanMock = vi.mocked(createPlan);
const findReserveFolderProjectIdMock = vi.mocked(findReserveFolderProjectId);
const uploadReservePhotoMock = vi.mocked(uploadReservePhoto);
const uploadReservePlanMock = vi.mocked(uploadReservePlan);
const findPlanByIdMock = vi.mocked(findPlanById);
const findPhotoByIdMock = vi.mocked(findPhotoById);
const destroyReservePlanMock = vi.mocked(destroyReservePlan);
const destroyReservePhotoMock = vi.mocked(destroyReservePhoto);
const initial = { type: null, message: "" } as const;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const validFields = {
  clientId: "1",
  projectId: "2",
  planId: "5",
  x: "0.5",
  y: "0.25",
  description: "Fissure au plafond",
  status: "OPEN",
};

describe("reserve actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addReserve refuses a job function barred from the réserves section", async () => {
    // The role says "may write"; the function says "may touch this section at
    // all". Passing the first must not be enough — that was the old behaviour,
    // where hiddenSections only filtered one page's render.
    requireRoleMock.mockResolvedValue({ email: "chef@example.com" } as never);
    // Once, not permanently: this mock is shared and would otherwise bar the
    // section for every test that follows.
    requireSectionMock.mockResolvedValueOnce({ error: { type: "error", message: "forbidden" } } as never);

    const res = await addReserve(initial, form(validFields));

    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addReserve refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await addReserve(initial, form(validFields));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addReserve rejects a missing description with a zodError", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const { description, ...noDesc } = validFields;
    void description;
    const res = await addReserve(initial, form(noDesc));
    expect(res.type).toBe("zodError");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addReserve creates the pin with its relative position + status", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    createMock.mockResolvedValue({ id: 9 } as never);
    const res = await addReserve(initial, form(validFields));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 5, x: 0.5, y: 0.25, description: "Fissure au plafond", status: "OPEN" })
    );
  });

  it("addReserve treats a blank latitude as no GPS (not 0)", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    createMock.mockResolvedValue({ id: 9 } as never);
    await addReserve(initial, form({ ...validFields, latitude: "", longitude: "" }));
    const passed = createMock.mock.calls[0][0];
    expect(passed.latitude).toBeUndefined();
    expect(passed.longitude).toBeUndefined();
  });

  it("updateReserve edits an existing pin", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    updateMock.mockResolvedValue({ id: 9 } as never);
    const res = await updateReserve(initial, form({ ...validFields, id: "9", status: "RESOLVED" }));
    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalledWith(9, expect.objectContaining({ status: "RESOLVED" }));
  });

  it("deleteReserve refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await deleteReserve(9, 1, 2);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("addReservePhoto refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const fd = new FormData();
    fd.set("clientId", "1");
    fd.set("projectId", "2");
    fd.set("reserveId", "9");
    fd.set("file", new File(["x"], "p.jpg", { type: "image/jpeg" }));
    const res = await addReservePhoto(initial, fd);
    expect(res.type).toBe("error");
    expect(uploadReservePhotoMock).not.toHaveBeenCalled();
    expect(createPhotoMock).not.toHaveBeenCalled();
  });

  it("addReservePhoto uploads the file and stores the photo row, guarded fields included", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    uploadReservePhotoMock.mockResolvedValue({
      url: "https://cdn/p.jpg",
      publicId: "pid",
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
    } as never);
    createPhotoMock.mockResolvedValue({ id: 3 } as never);
    const fd = new FormData();
    fd.set("clientId", "1");
    fd.set("projectId", "2");
    fd.set("reserveId", "9");
    fd.set("file", new File(["x"], "p.jpg", { type: "image/jpeg" }));
    const res = await addReservePhoto(initial, fd);
    expect(res.type).toBe("success");
    expect(uploadReservePhotoMock).toHaveBeenCalled();
    expect(createPhotoMock).toHaveBeenCalledWith({
      reserveId: 9,
      url: "https://cdn/p.jpg",
      publicId: "pid",
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
    });
  });

  // Passe 3a, point 3: the folder <select> only ever lists this project's
  // own folders, but nothing server-side checked that before — a submitted
  // folderId from another project silently filed the plan there, invisible
  // in both projects' plan lists.
  describe("addReservePlan — folderId scoped to the project", () => {
    function planForm(fields: Partial<Record<string, string>> = {}): FormData {
      const fd = new FormData();
      fd.set("clientId", "1");
      fd.set("projectId", "2");
      fd.set("name", "Plan RDC");
      fd.set("file", new File(["%PDF-1.4"], "plan.pdf", { type: "application/pdf" }));
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) fd.delete(k);
        else fd.set(k, v);
      }
      return fd;
    }

    it("rejects a folderId belonging to another project, before ever uploading the file", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      findReserveFolderProjectIdMock.mockResolvedValue(99); // not project 2
      const res = await addReservePlan(initial, planForm({ folderId: "42" }));
      expect(res.type).toBe("error");
      expect(uploadReservePlanMock).not.toHaveBeenCalled();
      expect(createPlanMock).not.toHaveBeenCalled();
    });

    it("rejects a folderId that doesn't exist at all", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      findReserveFolderProjectIdMock.mockResolvedValue(null);
      const res = await addReservePlan(initial, planForm({ folderId: "42" }));
      expect(res.type).toBe("error");
      expect(uploadReservePlanMock).not.toHaveBeenCalled();
    });

    it("accepts a folderId that does belong to this project", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      findReserveFolderProjectIdMock.mockResolvedValue(2);
      uploadReservePlanMock.mockResolvedValue({
        url: "https://cdn/plan.pdf",
        publicId: "pid",
        deliveryType: "AUTHENTICATED",
        resourceType: "IMAGE",
        format: "pdf",
        version: "1700000000",
      } as never);
      createPlanMock.mockResolvedValue({ id: 11 } as never);
      const res = await addReservePlan(initial, planForm({ folderId: "42" }));
      expect(res.type).toBe("success");
      expect(createPlanMock).toHaveBeenCalledWith(expect.objectContaining({ folderId: 42 }));
    });

    it("skips the folder check entirely when no folderId is submitted (plan filed at the project root)", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      uploadReservePlanMock.mockResolvedValue({
        url: "https://cdn/plan.pdf",
        publicId: "pid",
        deliveryType: "AUTHENTICATED",
        resourceType: "IMAGE",
        format: "pdf",
        version: "1700000000",
      } as never);
      createPlanMock.mockResolvedValue({ id: 11 } as never);
      const res = await addReservePlan(initial, planForm());
      expect(res.type).toBe("success");
      expect(findReserveFolderProjectIdMock).not.toHaveBeenCalled();
      expect(createPlanMock).toHaveBeenCalledWith(expect.objectContaining({ folderId: null }));
    });
  });

  it("addReservePhoto rejects a request with no file", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const fd = new FormData();
    fd.set("clientId", "1");
    fd.set("projectId", "2");
    fd.set("reserveId", "9");
    const res = await addReservePhoto(initial, fd);
    expect(res.type).toBe("error");
    expect(uploadReservePhotoMock).not.toHaveBeenCalled();
  });

  // Regression coverage for the silent-no-op trap: cloudinary.uploader.destroy
  // defaults `type` to "upload" when it isn't passed, so a destroy call that
  // only knows a bare publicId quietly does NOTHING on an asset re-typed to
  // "authenticated" — no error, the blob just stays orphaned. deleteReservePlan
  // / deleteReservePhoto must read the stored deliveryType/resourceType off
  // the row and pass them through to lib/cloudinary's destroy functions.
  describe("guarded destroy passes the stored deliveryType + resourceType", () => {
    it("deleteReservePlan", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      findPlanByIdMock.mockResolvedValueOnce({
        id: 5,
        projectId: 2,
        publicId: "projects/2/reserve-plans/plan",
        deliveryType: "AUTHENTICATED",
        resourceType: "IMAGE",
      } as never);

      const res = await deleteReservePlan(5, 1, 2);

      expect(res.type).toBe("success");
      expect(destroyReservePlanMock).toHaveBeenCalledWith(
        expect.objectContaining({
          publicId: "projects/2/reserve-plans/plan",
          deliveryType: "AUTHENTICATED",
          resourceType: "IMAGE",
        })
      );
    });

    it("deleteReservePhoto", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      findPhotoByIdMock.mockResolvedValueOnce({
        id: 3,
        publicId: "projects/2/reserve-photos/p",
        deliveryType: "AUTHENTICATED",
        resourceType: "IMAGE",
      } as never);

      const res = await deleteReservePhoto(3, 1, 2);

      expect((res as { type: string }).type).toBe("success");
      expect(destroyReservePhotoMock).toHaveBeenCalledWith(
        expect.objectContaining({
          publicId: "projects/2/reserve-photos/p",
          deliveryType: "AUTHENTICATED",
          resourceType: "IMAGE",
        })
      );
    });
  });

  // Regression coverage for the finding in docs/PENTEST-2026-08.md (F1): a
  // caller restricted to specific projects must not be able to write to a
  // réserve outside that set by simply claiming a different projectId in the
  // request — the check has to run against the réserve's REAL project,
  // resolved from the database, not the caller-supplied form field.
  describe("project-scope enforcement (F1 regression)", () => {
    it("updateReserve refuses when the réserve's real project is outside the caller's scope, even if the role/section checks pass", async () => {
      requireRoleMock.mockResolvedValue({ email: "chef@example.com" } as never);
      // The réserve actually belongs to project 99 — not the caller's project.
      findReserveProjectIdMock.mockResolvedValue(99);
      canReachProjectMock.mockReturnValueOnce(false);

      const res = await updateReserve(initial, form({ ...validFields, id: "9", status: "RESOLVED" }));

      expect(res.type).toBe("error");
      expect(updateMock).not.toHaveBeenCalled();
      // The check ran against the RESOLVED project (99), not the form's claim (2).
      expect(canReachProjectMock).toHaveBeenCalledWith(expect.anything(), 99);
    });

    it("deleteReserve refuses when the réserve's real project is outside the caller's scope", async () => {
      requireRoleMock.mockResolvedValue({ email: "chef@example.com" } as never);
      findReserveProjectIdMock.mockResolvedValue(99);
      canReachProjectMock.mockReturnValueOnce(false);

      const res = await deleteReserve(9, 1, 2);

      expect((res as { type: string }).type).toBe("error");
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("updateReserve proceeds once the resolved project IS in the caller's scope", async () => {
      requireRoleMock.mockResolvedValue({ email: "chef@example.com" } as never);
      findReserveProjectIdMock.mockResolvedValue(2);
      canReachProjectMock.mockReturnValueOnce(true);
      updateMock.mockResolvedValue({ id: 9 } as never);

      const res = await updateReserve(initial, form({ ...validFields, id: "9", status: "RESOLVED" }));

      expect(res.type).toBe("success");
      expect(updateMock).toHaveBeenCalledWith(9, expect.objectContaining({ status: "RESOLVED" }));
    });

    // Passe 3b, point 2: a réserve that exists but sits outside the caller's
    // scope used to say "Accès refusé" (requireProjectAccess's own message),
    // distinct from "Identifiant invalide" for an id that doesn't exist at
    // all — both branches are resolved from the SAME id via the database, so
    // the distinct wording let a restricted EDITOR tell "exists elsewhere"
    // apart from "doesn't exist" and enumerate ids across the whole company.
    // Both must now read identically.
    it("deleteReserve says the exact same thing for a réserve outside the caller's scope as for one that doesn't exist at all", async () => {
      requireRoleMock.mockResolvedValue({ email: "chef@example.com" } as never);

      findReserveProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
      const notFound = await deleteReserve(999, 1, 2);

      findReserveProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
      canReachProjectMock.mockReturnValueOnce(false);
      const outOfScope = await deleteReserve(9, 1, 2);

      expect((notFound as { message: string }).message).toBe(fr.reserves.messages.invalidId);
      expect((outOfScope as { message: string }).message).toBe(fr.reserves.messages.invalidId);
      expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    });
  });
});
