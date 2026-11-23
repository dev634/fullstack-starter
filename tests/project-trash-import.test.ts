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
  hasProjectAmong: vi.fn(),
  findTrashState: vi.fn().mockResolvedValue({ selfTrashed: false, parentTrashed: false, inTrash: false }),
}));
vi.mock("@/repository/clients", () => ({ findByEmail: vi.fn(), findTrashState: vi.fn().mockResolvedValue({ inTrash: false }), }));
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
import { create, remove, restore, findById, findTrashState, hasProjectAmong } from "@/repository/projects";
import { getAccessContext } from "@/lib/accessContext";
import fr from "@/lib/i18n/dictionaries/fr";
import { findByEmail, findTrashState as findClientTrashState } from "@/repository/clients";
import { findPublicIdsByProject } from "@/repository/projectFiles";
import { destroyProjectFile } from "@/lib/cloudinary";
import { logActivity } from "@/repository/projectActivity";
import { MAX_IMPORT_ROWS } from "@/lib/csv";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const restoreMock = vi.mocked(restore);
const findByIdMock = vi.mocked(findById);
const findTrashStateMock = vi.mocked(findTrashState);
// requireTrashedProjectAccess reads the project's OWN trash state.
const TRASHED = { selfTrashed: true, parentTrashed: false, inTrash: true };
const LIVE = { selfTrashed: false, parentTrashed: false, inTrash: false };
// Trashed project AND trashed company: restoring the project alone would leave it frozen and invisible.
const TRASHED_UNDER_TRASHED_COMPANY = { selfTrashed: true, parentTrashed: true, inTrash: true };
// vi.clearAllMocks() empties calls but NOT implementations: a state set by one
// test would answer in the next. Every describe's beforeEach calls this, so no
// test depends on another one having cleaned up after itself.
function resetTrashState() {
  vi.clearAllMocks();
  findTrashStateMock.mockResolvedValue(LIVE);
  // an ADMIN with nothing hidden, unless a test says otherwise
  vi.mocked(getAccessContext).mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null } as never);
}
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
  beforeEach(resetTrashState);

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await restoreProject(1);
    expect(res.type).toBe("error");
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("restores the project and logs the activity when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED);
    restoreMock.mockResolvedValue({ id: 1, name: "Toiture" } as never);
    const res = await restoreProject(1);
    expect(restoreMock).toHaveBeenCalledWith(1);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RESTORED", projectId: 1 })
    );
    expect(res.type).toBe("success");
  });

  // A project that is not in the trash has nothing to restore: a live one
  // used to be "restored" (re-journalled RESTORED) and an unknown one failed
  // inside the repository. Both now answer the same way.
  it("refuses a LIVE project, with the same answer as an unknown one", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(LIVE);
    const live = await restoreProject(1);
    findTrashStateMock.mockResolvedValue(null);
    const unknown = await restoreProject(1);
    expect(live.type).toBe("error");
    expect(live.message).toBe(unknown.message);
    expect(live.message).toBe(fr.projects.messages.invalidId);
    expect(restoreMock).not.toHaveBeenCalled();
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  // A live project under a company in the trash is not itself trashed.
  it("refuses a live project whose company is in the trash (nothing to restore on the project)", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue({ selfTrashed: false, parentTrashed: true, inTrash: true });
    const res = await restoreProject(1);
    expect(res.message).toBe(fr.projects.messages.invalidId);
    expect(restoreMock).not.toHaveBeenCalled();
  });

  // Restoring the project alone would take it out of the project trash while
  // leaving it frozen (requireProjectAccess) and invisible (every read) under
  // its company: not in any trash list, not re-deletable. The company is
  // restored first, and the refusal says so.
  it("refuses a trashed project whose COMPANY is also in the trash, and says to restore the company", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED_UNDER_TRASHED_COMPANY);
    const res = await restoreProject(1);
    expect(res).toEqual({ type: "error", message: fr.errors.parentInTrash });
    expect(restoreMock).not.toHaveBeenCalled();
    expect(logActivityMock).not.toHaveBeenCalled();
  });
});

describe("permanentlyDeleteProject", () => {
  beforeEach(resetTrashState);

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await permanentlyDeleteProject(1);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  // Lot 5b: the cascade takes every section of the chantier, so a function that
  // hides ONE of them may not destroy it; an account with none hidden may.
  it("refuses when the caller's function hides at least one project section, and destroys nothing", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "editor@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED);
    vi.mocked(getAccessContext).mockResolvedValue({
      email: "editor@example.com", role: "EDITOR", hiddenSections: new Set(["files"]), hiddenAreas: new Set(), projectIds: null,
    } as never);
    const res = await permanentlyDeleteProject(1);
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.errors.forbiddenDestroyHiddenSections);
    expect(findPublicIdsByProjectMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("lets an account with no hidden section destroy a trashed project", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "editor@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED);
    vi.mocked(getAccessContext).mockResolvedValue({
      email: "editor@example.com", role: "EDITOR", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null,
    } as never);
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture", deletedAt: new Date() } as never);
    findPublicIdsByProjectMock.mockResolvedValue([]);
    removeMock.mockResolvedValue({ id: 1 } as never);
    expect((await permanentlyDeleteProject(1)).type).toBe("success");
    expect(removeMock).toHaveBeenCalledWith(1);
  });

  it("permanently removes the project and logs the activity when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED);
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture", deletedAt: new Date() } as never);
    findPublicIdsByProjectMock.mockResolvedValue([]);
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await permanentlyDeleteProject(1);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PERMANENTLY_DELETED", projectId: 1 })
    );
    expect(res.type).toBe("success");
  });

  // Lot 1: irreversible, so only a project already in the trash may go. A
  // LIVE project used to be destroyed outright, files included; it now
  // answers like an unknown one.
  it("refuses a LIVE project, with the same answer as an unknown one", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(LIVE);
    const live = await permanentlyDeleteProject(1);
    findTrashStateMock.mockResolvedValue(null);
    const unknown = await permanentlyDeleteProject(1);
    expect(live.type).toBe("error");
    expect(live.message).toBe(unknown.message);
    expect(removeMock).not.toHaveBeenCalled();
    expect(destroyProjectFileMock).not.toHaveBeenCalled();
  });

  // Destroying for good has no dependency on the company, unlike restoring.
  it("still permanently removes a trashed project under a trashed company", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED_UNDER_TRASHED_COMPANY);
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture", deletedAt: new Date() } as never);
    findPublicIdsByProjectMock.mockResolvedValue([]);
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await permanentlyDeleteProject(1);
    expect(res.type).toBe("success");
    expect(removeMock).toHaveBeenCalledWith(1);
  });

  // Regression coverage for the silent-no-op trap: cloudinary.uploader.destroy
  // defaults `type` to "upload" when it isn't passed, so a destroy call that
  // only knows the mime type quietly does NOTHING on an asset re-typed to
  // "authenticated" — no error, the blob just stays orphaned. The bulk purge
  // must read the stored deliveryType/resourceType and pass them through.
  it("destroys the project's Cloudinary files, with their stored guarded type, before deleting", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findTrashStateMock.mockResolvedValue(TRASHED);
    findByIdMock.mockResolvedValue({ id: 1, name: "Toiture", deletedAt: new Date() } as never);
    findPublicIdsByProjectMock.mockResolvedValue([
      { publicId: "projects/1/plan", deliveryType: "AUTHENTICATED", resourceType: "RAW" },
      { publicId: "projects/1/photo", deliveryType: "AUTHENTICATED", resourceType: "IMAGE" },
    ] as never);
    removeMock.mockResolvedValue({ id: 1 } as never);
    await permanentlyDeleteProject(1);
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/1/plan", {
      deliveryType: "AUTHENTICATED",
      resourceType: "RAW",
    });
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/1/photo", {
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
    });
  });
});

describe("importProjects", () => {
  beforeEach(resetTrashState);

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

  // Adversarial pass 2, point 7 — same gap as importClients, on the heaviest
  // of the three importers (up to three sequential repository calls per row).
  it("rejects a file over MAX_IMPORT_ROWS without creating anything", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const rows = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `"Toiture ${i}","alice@x.com","AUTRE","ETUDE","","","","","",""`
    );
    const res = await importProjects(csvFile(rows));
    expect(res.type).toBe("error");
    expect(res.total).toBe(MAX_IMPORT_ROWS + 1);
    expect(res.created).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
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

  // A company the caller cannot reach must read exactly like an unknown
  // email (a distinct refusal would let a CSV probe which addresses are
  // companies) — but a company IN THE TRASH that the caller does reach says so:
  // "unknown email" would send them looking for a typo, when the actionable
  // answer is "restore it". The trash message is only ever given to a caller
  // already inside the scope, so it reveals nothing new. (This used to assert
  // the opposite — that a trashed company answered like an unknown one — and
  // so locked the misleading message in.)
  it("tells a caller who reaches a TRASHED company that it is in the trash", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const row = ['"Toiture","alice@x.com","AUTRE","ETUDE","","","","","",""'];
    findByEmailMock.mockResolvedValue({ id: 42, email: "alice@x.com", deletedAt: new Date() } as never);
    const trashed = await importProjects(csvFile(row));
    expect(trashed.errors[0].message).toBe(fr.errors.inTrash);
    expect(trashed.errors[0].message).not.toBe(fr.projects.messages.unknownClientEmail);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("answers a trashed company the caller CANNOT reach exactly like an unknown email", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "chef@example.com" });
    const row = ['"Toiture","alice@x.com","AUTRE","ETUDE","","","","","",""'];
    findByEmailMock.mockResolvedValue(null);
    const unknown = await importProjects(csvFile(row));
    vi.mocked(getAccessContext).mockResolvedValue({
      email: "chef@example.com",
      role: "EDITOR",
      hiddenSections: new Set(),
      hiddenAreas: new Set(),
      projectIds: new Set([202]),
    });
    vi.mocked(hasProjectAmong).mockResolvedValue(false);
    findByEmailMock.mockResolvedValue({ id: 42, email: "alice@x.com", deletedAt: new Date() } as never);
    const outOfScope = await importProjects(csvFile(row));
    vi.mocked(getAccessContext).mockResolvedValue({
      email: "test@example.com",
      role: "ADMIN",
      hiddenSections: new Set(),
      hiddenAreas: new Set(),
      projectIds: null,
    });
    expect(outOfScope.errors).toEqual(unknown.errors);
    expect(outOfScope.errors[0].message).toBe(fr.projects.messages.unknownClientEmail);
    expect(createMock).not.toHaveBeenCalled();
  });

  // The access context is read once for the whole file, not once per row.
  it("reads the access context once for the whole file", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByEmailMock.mockResolvedValue({ id: 42, email: "alice@x.com", deletedAt: null } as never);
    createMock.mockResolvedValue({ id: 1 } as never);
    const row = '"Toiture","alice@x.com","AUTRE","ETUDE","","","","","",""';
    // The guards before the loop read it too, so compare 1 row against 3: the count must not grow with the rows.
    await importProjects(csvFile([row]));
    const oneRow = vi.mocked(getAccessContext).mock.calls.length;
    vi.mocked(getAccessContext).mockClear();
    await importProjects(csvFile([row, row, row]));
    expect(vi.mocked(getAccessContext)).toHaveBeenCalledTimes(oneRow);
    expect(vi.mocked(findClientTrashState)).not.toHaveBeenCalled(); // the row findByEmail returned already says whether the company is trashed
  });

  it("imports a valid row matched to an existing client", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findByEmailMock.mockResolvedValue({ id: 42, email: "alice@x.com", deletedAt: null } as never);
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
