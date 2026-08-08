import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/projectFolders", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  collectDescendantFilePublicIds: vi.fn(),
  findById: vi.fn().mockResolvedValue({ id: 1, projectId: 2 }),
}));
vi.mock("@/repository/projectFiles", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  findById: vi.fn().mockResolvedValue({ id: 1, projectId: 2 }),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadProjectFile: vi.fn(),
  destroyProjectFile: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addFolder, uploadFile, deleteFile, deleteFolder } from "@/actions/projectFiles/projectFiles";
import { requireRole } from "@/lib/authz";
import { create as createFolder, remove as removeFolder, collectDescendantFilePublicIds } from "@/repository/projectFolders";
import { create as createFile, remove as removeFile, findById as findFileById } from "@/repository/projectFiles";
import { uploadProjectFile, destroyProjectFile } from "@/lib/cloudinary";

const requireRoleMock = vi.mocked(requireRole);
const createFolderMock = vi.mocked(createFolder);
const removeFolderMock = vi.mocked(removeFolder);
const collectDescendantFilePublicIdsMock = vi.mocked(collectDescendantFilePublicIds);
const createFileMock = vi.mocked(createFile);
const removeFileMock = vi.mocked(removeFile);
const findFileByIdMock = vi.mocked(findFileById);
const uploadProjectFileMock = vi.mocked(uploadProjectFile);
const destroyProjectFileMock = vi.mocked(destroyProjectFile);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("project file/folder actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addFolder refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addFolder(initial, formOf({ clientId: "1", projectId: "1", name: "Plans" }));
    expect(res.type).toBe("error");
    expect(createFolderMock).not.toHaveBeenCalled();
  });

  it("addFolder rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addFolder(initial, formOf({ clientId: "1", projectId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createFolderMock).not.toHaveBeenCalled();
  });

  it("addFolder creates a root folder when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createFolderMock.mockResolvedValue({ id: 1 } as never);
    const res = await addFolder(initial, formOf({ clientId: "1", projectId: "2", name: "Plans" }));
    expect(createFolderMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, name: "Plans", parentId: null })
    );
    expect(res.type).toBe("success");
  });

  it("addFolder creates a nested folder with a parentId", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createFolderMock.mockResolvedValue({ id: 2 } as never);
    await addFolder(initial, formOf({ clientId: "1", projectId: "2", parentId: "5", name: "Sous-dossier" }));
    expect(createFolderMock).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 5 })
    );
  });

  it("uploadFile refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const fd = formOf({ clientId: "1", projectId: "2" });
    fd.set("file", new File(["data"], "plan.pdf", { type: "application/pdf" }));
    const res = await uploadFile(initial, fd);
    expect(res.type).toBe("error");
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
  });

  it("uploadFile rejects a request with no file", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await uploadFile(initial, formOf({ clientId: "1", projectId: "2" }));
    expect(res.type).toBe("error");
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
  });

  it("uploadFile uploads and records the file when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    uploadProjectFileMock.mockResolvedValue({
      url: "https://cloudinary/plan.pdf",
      publicId: "projects/2/plan",
      size: 1234,
      mimeType: "application/pdf",
      // RAW: uploadProjectFile stores `format: null` here (see
      // lib/cloudinary.ts::guardedFieldsFromUploadResult) — the publicId
      // already carries the extension.
      resourceType: "RAW",
      format: null,
      version: "1700000000",
      deliveryType: "AUTHENTICATED",
    });
    createFileMock.mockResolvedValue({ id: 1 } as never);
    const fd = formOf({ clientId: "1", projectId: "2" });
    fd.set("file", new File(["data"], "plan.pdf", { type: "application/pdf" }));
    const res = await uploadFile(initial, fd);
    expect(uploadProjectFileMock).toHaveBeenCalledWith(expect.any(File), 2);
    expect(createFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 2,
        folderId: null,
        name: "plan.pdf",
        publicId: "projects/2/plan",
        // The guarded columns actually flow from the upload result into the
        // persisted row — not just publicId/url.
        deliveryType: "AUTHENTICATED",
        resourceType: "RAW",
        format: null,
        version: "1700000000",
      })
    );
    expect(res.type).toBe("success");
  });

  it("deleteFile refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteFile(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeFileMock).not.toHaveBeenCalled();
  });

  // Regression coverage for the silent-no-op trap: cloudinary.uploader.destroy
  // defaults `type` to "upload" when it isn't passed, so a destroy call that
  // only knows the mime type quietly does NOTHING on an asset re-typed to
  // "authenticated" — no error, the blob just stays orphaned. deleteFile must
  // read the stored deliveryType/resourceType and pass them through.
  it("deleteFile destroys the Cloudinary asset with its stored guarded type, then removes the record", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findFileByIdMock.mockResolvedValue({
      id: 1,
      publicId: "projects/2/plan.pdf",
      mimeType: "application/pdf",
      deliveryType: "AUTHENTICATED",
      resourceType: "RAW",
    } as never);
    removeFileMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteFile(1, 1, 2);
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/2/plan.pdf", {
      deliveryType: "AUTHENTICATED",
      resourceType: "RAW",
    });
    expect(removeFileMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });

  it("deleteFolder refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteFolder(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeFolderMock).not.toHaveBeenCalled();
  });

  // Regression coverage for the same silent-no-op trap as deleteFile's test
  // above, but on the bulk cleanup path: collectDescendantFilePublicIds must
  // now select deliveryType/resourceType (not mimeType), and every file gets
  // destroyed with its own stored guarded type.
  it("deleteFolder destroys every nested file, with its stored guarded type, before removing the folder", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    collectDescendantFilePublicIdsMock.mockResolvedValue([
      { publicId: "projects/2/a", deliveryType: "AUTHENTICATED", resourceType: "IMAGE" },
      { publicId: "projects/2/b", deliveryType: "AUTHENTICATED", resourceType: "RAW" },
    ] as never);
    removeFolderMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteFolder(1, 1, 2);
    expect(destroyProjectFileMock).toHaveBeenCalledTimes(2);
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/2/a", {
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
    });
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/2/b", {
      deliveryType: "AUTHENTICATED",
      resourceType: "RAW",
    });
    expect(removeFolderMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });
});
