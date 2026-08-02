import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
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
vi.mock("@/repository/projectFiles", () => ({ findPublicIdsByProject: vi.fn() }));
vi.mock("@/lib/cloudinary", () => ({ destroyProjectFile: vi.fn() }));
vi.mock("@/repository/projectActivity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import {
  restoreProject,
  permanentlyDeleteProject,
  importProjects,
} from "@/actions/projects/projects";
import { requireRole } from "@/lib/authz";
import { create, remove, restore, findById } from "@/repository/projects";
import { findByEmail } from "@/repository/clients";
import { findPublicIdsByProject } from "@/repository/projectFiles";
import { destroyProjectFile } from "@/lib/cloudinary";
import { logActivity } from "@/repository/projectActivity";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const restoreMock = vi.mocked(restore);
const findByIdMock = vi.mocked(findById);
const findByEmailMock = vi.mocked(findByEmail);
const findPublicIdsByProjectMock = vi.mocked(findPublicIdsByProject);
const destroyProjectFileMock = vi.mocked(destroyProjectFile);
const logActivityMock = vi.mocked(logActivity);

const HEADER =
  '"Name","Client Email","Type","Status","Power","Budget","Address","Start Date","End Date","Notes"';

function csvFile(rows: string[]): FormData {
  const fd = new FormData();
  const csv = [HEADER, ...rows].join("\r\n");
  fd.set("file", new File([csv], "projects.csv", { type: "text/csv" }));
  return fd;
}

describe("restoreProject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await restoreProject(1);
    expect(res.type).toBe("error");
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("restores the project and logs the activity when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    restoreMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    const res = await restoreProject(1);
    expect(restoreMock).toHaveBeenCalledWith(1);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RESTORED", projectId: 1 })
    );
    expect(res.type).toBe("success");
  });
});

describe("permanentlyDeleteProject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await permanentlyDeleteProject(1);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("permanently removes the project and logs the activity when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    findPublicIdsByProjectMock.mockResolvedValue([]);
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await permanentlyDeleteProject(1);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PERMANENTLY_DELETED", projectId: 1 })
    );
    expect(res.type).toBe("success");
  });

  it("destroys the project's Cloudinary files before deleting", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    findPublicIdsByProjectMock.mockResolvedValue([
      { publicId: "projects/1/plan", mimeType: "application/pdf" },
      { publicId: "projects/1/photo", mimeType: "image/jpeg" },
    ] as never);
    removeMock.mockResolvedValue({ id: 1 } as never);
    await permanentlyDeleteProject(1);
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/1/plan", "application/pdf");
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/1/photo", "image/jpeg");
  });
});

describe("importProjects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses without an ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await importProjects(csvFile(['"Toiture","alice@x.com","AUTRE","ETUDE","","","","","",""']));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await importProjects(new FormData());
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a file with no data rows", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const fd = new FormData();
    fd.set("file", new File([HEADER], "projects.csv", { type: "text/csv" }));
    const res = await importProjects(fd);
    expect(res.type).toBe("error");
    expect(res.total).toBe(0);
  });

  it("fails a row whose client email doesn't match any client", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByEmailMock.mockResolvedValue(null);
    const res = await importProjects(
      csvFile(['"Toiture","ghost@x.com","AUTRE","ETUDE","","","","","",""'])
    );
    expect(res.created).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("imports a valid row matched to an existing client", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByEmailMock.mockResolvedValue({ id: 42, email: "alice@x.com" } as never);
    createMock.mockResolvedValue({ id: 1 } as never);

    const res = await importProjects(
      csvFile(['"Toiture principale","alice@x.com","AUTRE","ETUDE","","","","","",""'])
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 42, name: "Toiture principale" })
    );
    expect(res.created).toBe(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "IMPORTED" }));
  });
});
