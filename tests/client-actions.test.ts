import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the action's boundaries so we exercise the orchestration (auth guard,
// validation error mapping, delegation) without a DB, network or NextAuth.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/service/clients", () => ({ createClient: vi.fn() }));
vi.mock("@/repository/clients", () => ({
  findById: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  permanentlyRemove: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadClientPhoto: vi.fn(),
  destroyClientPhoto: vi.fn(),
  destroyProjectFile: vi.fn(),
}));
vi.mock("@/repository/projectFiles", () => ({ findPublicIdsByClient: vi.fn() }));
vi.mock("@/repository/users", () => ({ findAccessScopeByEmail: vi.fn() }));
vi.mock("@/repository/projects", () => ({ hasProjectAmong: vi.fn() }));
vi.mock("@/repository/activity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addClient, getClient, deleteClient, restoreClient, permanentlyDeleteClient } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import { createClient } from "@/service/clients";
import { findById, softDelete, restore, permanentlyRemove } from "@/repository/clients";
import { findPublicIdsByClient } from "@/repository/projectFiles";
import { findAccessScopeByEmail } from "@/repository/users";
import { hasProjectAmong } from "@/repository/projects";
import { destroyProjectFile } from "@/lib/cloudinary";
import { logActivity } from "@/repository/activity";

const authMock = vi.mocked(auth);
const findAccessScopeByEmailMock = vi.mocked(findAccessScopeByEmail);
const hasProjectAmongMock = vi.mocked(hasProjectAmong);
const createClientMock = vi.mocked(createClient);
const findByIdMock = vi.mocked(findById);
const softDeleteMock = vi.mocked(softDelete);
const restoreMock = vi.mocked(restore);
const permanentlyRemoveMock = vi.mocked(permanentlyRemove);
const findPublicIdsByClientMock = vi.mocked(findPublicIdsByClient);
const destroyProjectFileMock = vi.mocked(destroyProjectFile);
const logActivityMock = vi.mocked(logActivity);
const initial = { type: null, message: "" } as const;

describe("client action auth guard + delegation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addClient refuses without a session", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await addClient(initial, new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("addClient delegates to the service when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    createClientMock.mockResolvedValue({ type: "success", message: "ok", data: { id: 42 } } as never);
    const res = await addClient(initial, new FormData());
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATED", clientId: 42, actorEmail: "admin@example.com" })
    );
  });

  it("addClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await addClient(initial, new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("deleteClient refuses without a session", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await deleteClient(1);
    expect((res as { type: string }).type).toBe("error");
    expect(softDeleteMock).not.toHaveBeenCalled();
  });

  it("deleteClient soft-deletes the client when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, companyName: "Sunrise Corporation" } as never);
    softDeleteMock.mockResolvedValue({ id: 1, deletedAt: new Date() } as never);
    await deleteClient(1);
    expect(softDeleteMock).toHaveBeenCalledWith(1);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETED", clientId: 1, clientName: "Sunrise Corporation" })
    );
  });

  it("deleteClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await deleteClient(1);
    expect((res as { type: string }).type).toBe("error");
    expect(softDeleteMock).not.toHaveBeenCalled();
  });

  it("restoreClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await restoreClient(1);
    expect(res.type).toBe("error");
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("restoreClient restores the client when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    restoreMock.mockResolvedValue({ id: 1, deletedAt: null, companyName: "Sunrise Corporation" } as never);
    const res = await restoreClient(1);
    expect(restoreMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RESTORED", clientId: 1 })
    );
  });

  it("permanentlyDeleteClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await permanentlyDeleteClient(1);
    expect(res.type).toBe("error");
    expect(permanentlyRemoveMock).not.toHaveBeenCalled();
  });

  it("permanentlyDeleteClient removes the client and its photo when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({
      id: 1,
      photoUrl: "https://example.com/x.png",
      firstName: "Alice",
      lastName: "Smith",
    } as never);
    permanentlyRemoveMock.mockResolvedValue({ id: 1 } as never);
    findPublicIdsByClientMock.mockResolvedValue([]);
    const res = await permanentlyDeleteClient(1);
    expect(permanentlyRemoveMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PERMANENTLY_DELETED", clientId: 1 })
    );
  });

  it("permanentlyDeleteClient destroys its projects' Cloudinary files", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, photoUrl: null, firstName: "Alice", lastName: "Smith" } as never);
    permanentlyRemoveMock.mockResolvedValue({ id: 1 } as never);
    findPublicIdsByClientMock.mockResolvedValue([
      { publicId: "projects/9/devis", mimeType: "application/pdf" },
    ] as never);
    await permanentlyDeleteClient(1);
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/9/devis", "application/pdf");
  });

  // Regression coverage for a project-scope gap found while fixing
  // docs/PENTEST-2026-08.md (F1): an EDITOR restricted to specific projects
  // must not be able to read or delete a client company reached only through
  // projects outside that set, even though role alone would let them.
  describe("project-scope enforcement (F1 regression)", () => {
    const scopedEditor = { user: { role: "EDITOR", email: "chef@example.com" } };

    it("getClient masks a client the caller has no project under, as not found", async () => {
      authMock.mockResolvedValue(scopedEditor as never);
      findAccessScopeByEmailMock.mockResolvedValue({
        hiddenSections: [],
        hiddenAreas: [],
        projectScope: "ASSIGNED",
        assignedProjectIds: [202],
      });
      hasProjectAmongMock.mockResolvedValue(false); // client 490 has no project in {202}
      findByIdMock.mockResolvedValue({ id: 490, companyName: "Entreprise non assignee" } as never);

      const res = await getClient(490);

      expect(res.type).toBe("success");
      expect(res.data).toBeNull();
      expect(hasProjectAmongMock).toHaveBeenCalledWith(490, [202]);
    });

    it("deleteClient refuses a client the caller has no project under", async () => {
      authMock.mockResolvedValue(scopedEditor as never);
      findAccessScopeByEmailMock.mockResolvedValue({
        hiddenSections: [],
        hiddenAreas: [],
        projectScope: "ASSIGNED",
        assignedProjectIds: [202],
      });
      hasProjectAmongMock.mockResolvedValue(false);

      const res = await deleteClient(490);

      expect((res as { type: string }).type).toBe("error");
      expect(softDeleteMock).not.toHaveBeenCalled();
    });

    it("getClient still resolves the client once one of its projects IS in scope", async () => {
      authMock.mockResolvedValue(scopedEditor as never);
      findAccessScopeByEmailMock.mockResolvedValue({
        hiddenSections: [],
        hiddenAreas: [],
        projectScope: "ASSIGNED",
        assignedProjectIds: [202],
      });
      hasProjectAmongMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ id: 489, companyName: "Entreprise assignee" } as never);

      const res = await getClient(489);

      expect(res.type).toBe("success");
      expect(res.data).toEqual(expect.objectContaining({ id: 489 }));
    });
  });
});
