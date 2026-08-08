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
// Whole module replaced: must export every function the action imports from
// it, not just extractDeliveryNoteItems (see docs/CONVENTIONS.md — a missing
// export doesn't fail until a guard/call site actually reaches it).
vi.mock("@/lib/deliveryNoteScan", () => ({
  extractDeliveryNoteItems: vi.fn(),
  readAndValidateDeliveryNoteImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([]), mediaType: "image/jpeg" }),
  scanProviderInfo: vi.fn().mockReturnValue({ provider: "anthropic", model: "claude-sonnet-5" }),
}));
vi.mock("@/repository/projectMaterials", () => ({
  applyScanItems: vi.fn(),
}));
vi.mock("@/repository/projectFiles", () => ({ create: vi.fn() }));
vi.mock("@/repository/projectFolders", () => ({ findChildren: vi.fn() }));
vi.mock("@/repository/projects", () => ({ findById: vi.fn() }));
vi.mock("@/lib/cloudinary", () => ({ uploadProjectFile: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: vi.fn().mockResolvedValue({ limited: false, retryAfterMs: 0 }),
  registerFailure: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Map()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { scanDeliveryNote, applyDeliveryNoteScan } from "@/actions/deliveryNoteScan/deliveryNoteScan";
import { requireRole } from "@/lib/authz";
import { extractDeliveryNoteItems } from "@/lib/deliveryNoteScan";
import { applyScanItems } from "@/repository/projectMaterials";
import { create as createFile } from "@/repository/projectFiles";
import { findChildren as findChildFolders } from "@/repository/projectFolders";
import { findById as findProjectById } from "@/repository/projects";
import { uploadProjectFile } from "@/lib/cloudinary";
import { isRateLimited } from "@/lib/rate-limit";

const requireRoleMock = vi.mocked(requireRole);
const extractDeliveryNoteItemsMock = vi.mocked(extractDeliveryNoteItems);
const applyScanItemsMock = vi.mocked(applyScanItems);
const createFileMock = vi.mocked(createFile);
const findChildFoldersMock = vi.mocked(findChildFolders);
const findProjectByIdMock = vi.mocked(findProjectById);
const uploadProjectFileMock = vi.mocked(uploadProjectFile);
const isRateLimitedMock = vi.mocked(isRateLimited);
const initialScan = { type: null, message: "" } as const;
const initialApply = { type: null, message: "" } as const;

function fileOf(name: string, type = "image/jpeg"): File {
  return new File(["fake image bytes"], name, { type });
}

describe("scanDeliveryNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockResolvedValue({ limited: false, retryAfterMs: 0 });
  });

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("error");
    expect(extractDeliveryNoteItemsMock).not.toHaveBeenCalled();
  });

  it("rejects a missing file", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await scanDeliveryNote(initialScan, new FormData());
    expect(res.type).toBe("error");
    expect(extractDeliveryNoteItemsMock).not.toHaveBeenCalled();
  });

  it("returns the extracted items on success", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    extractDeliveryNoteItemsMock.mockResolvedValue({
      supplier: "Rexel",
      items: [{ name: "Panneau 400W", quantity: 24, unit: "pièce", reference: "REF-9" }],
    });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("success");
    expect(res.items).toEqual([{ name: "Panneau 400W", quantity: 24, unit: "pièce", reference: "REF-9" }]);
    expect(res.supplier).toBe("Rexel");
  });

  it("surfaces an extraction error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    extractDeliveryNoteItemsMock.mockRejectedValue({ type: "error", message: "Could not read any items." });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("error");
    expect(res.message).toBe("Could not read any items.");
  });

  it("never relays a non-app-shaped (e.g. provider SDK) error message to the client", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    // Shape of an Anthropic/OpenAI APIError: has a `.message` but no
    // `{ type: "error" }` app marker — getErrorMessage would have relayed
    // this verbatim; the action must not.
    extractDeliveryNoteItemsMock.mockRejectedValue(
      Object.assign(new Error("401 invalid x-api-key: sk-ant-abc123"), { status: 401 })
    );
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("error");
    expect(res.message).not.toContain("x-api-key");
  });

  it("rejects the call before reaching the provider once the per-user budget is exhausted", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    isRateLimitedMock.mockResolvedValue({ limited: true, retryAfterMs: 120_000 });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("error");
    expect(extractDeliveryNoteItemsMock).not.toHaveBeenCalled();
  });
});

describe("applyDeliveryNoteScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findProjectByIdMock.mockResolvedValue({ id: 2, clientId: 1 } as never);
  });

  function formOf(fields: Record<string, string>, file?: File): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set("file", file);
    return fd;
  }

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ name: "Panneau", quantity: 5 }]) })
    );
    expect(res.type).toBe("error");
    expect(applyScanItemsMock).not.toHaveBeenCalled();
  });

  it("rejects malformed items JSON with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: "not json" })
    );
    expect(res.type).toBe("zodError");
    expect(applyScanItemsMock).not.toHaveBeenCalled();
  });

  it("rejects an empty items array", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([]) })
    );
    expect(res.type).toBe("zodError");
  });

  it("resolves clientId from the database via projectId, not from the submitted form field", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockResolvedValue([] as never);
    findChildFoldersMock.mockResolvedValue([]);
    // A submitted clientId that does NOT match what the database says the
    // project belongs to — must be ignored entirely.
    findProjectByIdMock.mockResolvedValue({ id: 2, clientId: 999 } as never);
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ name: "Panneau", quantity: 5 }]) })
    );
    expect(res.type).toBe("success");
    expect(findProjectByIdMock).toHaveBeenCalledWith(2);
  });

  it("fails cleanly when the project can't be found", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findProjectByIdMock.mockResolvedValue(null);
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ name: "Panneau", quantity: 5 }]) })
    );
    expect(res.type).toBe("error");
    expect(applyScanItemsMock).not.toHaveBeenCalled();
  });

  it("passes a matched (materialId set) item through to applyScanItems, scoped to the project", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockResolvedValue([] as never);
    findChildFoldersMock.mockResolvedValue([]);
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({
        clientId: "1",
        projectId: "2",
        items: JSON.stringify([{ name: "Panneau 400W", quantity: 24, materialId: 7 }]),
      })
    );
    expect(applyScanItemsMock).toHaveBeenCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ materialId: 7, quantity: 24 })]),
      undefined
    );
    expect(res.type).toBe("success");
  });

  it("passes an unmatched (no materialId) item through to applyScanItems", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockResolvedValue([] as never);
    findChildFoldersMock.mockResolvedValue([]);
    await applyDeliveryNoteScan(
      initialApply,
      formOf({
        clientId: "1",
        projectId: "2",
        supplier: "Rexel",
        items: JSON.stringify([{ name: "Onduleur", quantity: 3, unit: "pièce", reference: "REF-9" }]),
      })
    );
    expect(applyScanItemsMock).toHaveBeenCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ name: "Onduleur", quantity: 3, unit: "pièce", reference: "REF-9" })]),
      "Rexel"
    );
  });

  it("attaches the photo into the existing 'Bulletins de livraisons' folder, matched case-insensitively", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockResolvedValue([] as never);
    findChildFoldersMock.mockResolvedValue([
      { id: 3, name: "Plans" },
      { id: 5, name: "bulletins de livraisons" },
    ] as never);
    uploadProjectFileMock.mockResolvedValue({
      url: "https://example.com/note.jpg",
      publicId: "projects/2/note",
      size: 1024,
      mimeType: "image/jpeg",
    });
    await applyDeliveryNoteScan(
      initialApply,
      formOf(
        { clientId: "1", projectId: "2", items: JSON.stringify([{ name: "Panneau", quantity: 1, materialId: 7 }]) },
        fileOf("note.jpg")
      )
    );
    expect(createFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, folderId: 5, name: "note.jpg" })
    );
  });

  it("attaches the photo at the project root when no delivery-note folder exists", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockResolvedValue([] as never);
    findChildFoldersMock.mockResolvedValue([{ id: 3, name: "Plans" }] as never);
    uploadProjectFileMock.mockResolvedValue({
      url: "https://example.com/note.jpg",
      publicId: "projects/2/note",
      size: 1024,
      mimeType: "image/jpeg",
    });
    await applyDeliveryNoteScan(
      initialApply,
      formOf(
        { clientId: "1", projectId: "2", items: JSON.stringify([{ name: "Panneau", quantity: 1, materialId: 7 }]) },
        fileOf("note.jpg")
      )
    );
    expect(createFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: null })
    );
  });
});
