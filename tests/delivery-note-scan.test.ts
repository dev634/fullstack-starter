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
// composeMaterialName is deliberately NOT mocked here: the action now
// imports it from @/lib/materialName instead (a separate, dependency-light
// module — see that file's comment), which is left unmocked below so these
// tests exercise the real implementation rather than a hand-copied stand-in
// that could silently drift from it (see docs/CONVENTIONS.md's mock-parity
// trap, and lib/materialName.ts's comment for why it's safe to leave real).
vi.mock("@/lib/deliveryNoteScan", () => ({
  extractDeliveryNoteItems: vi.fn(),
  readAndValidateDeliveryNoteImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([]), mediaType: "image/jpeg" }),
  // Real implementation runs sharp on the buffer above — not exercised here
  // (the pixel-level behavior is covered by delivery-note-scan-archive.test.ts,
  // against the real function). Mocked to resolve by default so the "attaches
  // the photo" tests below reach uploadProjectFile/createFile; individual
  // tests override this to a rejection to prove nothing is written on failure.
  stripArchivedPhotoMetadata: vi.fn().mockResolvedValue(Buffer.from("cleaned-bytes")),
  scanProviderInfo: vi.fn().mockReturnValue({ provider: "anthropic", model: "claude-sonnet-5" }),
  isScanError: vi.fn((error: unknown) => {
    return (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "error" &&
      "code" in error
    );
  }),
}));
vi.mock("@/repository/projectMaterials", () => ({
  applyScanItems: vi.fn(),
  // isUnmatchedScanMaterialError is called unconditionally inside
  // applyDeliveryNoteScan's catch block (passe 3a, point 2) — a whole-module
  // mock must export every function the action calls, even ones no test
  // here happens to trigger yet (docs/CONVENTIONS.md's own documented trap:
  // a missing export doesn't fail until a guard/call site actually reaches
  // it). Real shape reused rather than a bare vi.fn() returning undefined,
  // so a future rejection shaped like the real error is still recognized.
  isUnmatchedScanMaterialError: vi.fn(
    (error: unknown) =>
      typeof error === "object" && error !== null && "type" in error && error.type === "unmatchedScanMaterial"
  ),
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
import { extractDeliveryNoteItems, stripArchivedPhotoMetadata } from "@/lib/deliveryNoteScan";
import { applyScanItems } from "@/repository/projectMaterials";
import { create as createFile } from "@/repository/projectFiles";
import { findChildren as findChildFolders } from "@/repository/projectFolders";
import { findById as findProjectById } from "@/repository/projects";
import { uploadProjectFile } from "@/lib/cloudinary";
import { isRateLimited } from "@/lib/rate-limit";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const extractDeliveryNoteItemsMock = vi.mocked(extractDeliveryNoteItems);
const stripArchivedPhotoMetadataMock = vi.mocked(stripArchivedPhotoMetadata);
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
      items: [{ name: "Nexans — REF-9", brand: "Nexans", reference: "REF-9", quantity: 24 }],
      bytesSent: 12_345,
    });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("success");
    expect(res.items).toEqual([{ name: "Nexans — REF-9", brand: "Nexans", reference: "REF-9", quantity: 24 }]);
    expect(res.supplier).toBe("Rexel");
  });

  it("surfaces an extraction error, translated from the thrown code (never the raw code itself)", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    extractDeliveryNoteItemsMock.mockRejectedValue({ type: "error", code: "noItemsRead" });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.materials.scan.errors.noItemsRead);
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
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ reference: "REF-1", quantity: 5 }]) })
    );
    expect(res.type).toBe("error");
    expect(applyScanItemsMock).not.toHaveBeenCalled();
  });

  // Adversarial pass 2, point 4: this was the only action in the app whose
  // zodError branch carried no fieldsForm at all — a batch of reviewed lines
  // with one bad field said only "validation error", never which.
  it("rejects malformed items JSON with a zod error carrying a fieldsForm", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: "not json" })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.items).toBeTruthy();
    expect(applyScanItemsMock).not.toHaveBeenCalled();
  });

  it("rejects an empty items array, with a fieldsForm", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([]) })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.items).toBeTruthy();
  });

  it("rejects a new-material line whose brand is whitespace-only, rather than writing a nameless material (scannedItemSchema's .refine() only tests raw truthiness, so \" \" passes it — this is the check that actually protects the write), with a fieldsForm", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ brand: " ", quantity: 1 }]) })
    );
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.items).toBeTruthy();
    expect(applyScanItemsMock).not.toHaveBeenCalled();
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
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ reference: "REF-1", quantity: 5 }]) })
    );
    expect(res.type).toBe("success");
    expect(findProjectByIdMock).toHaveBeenCalledWith(2);
  });

  it("fails cleanly when the project can't be found", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findProjectByIdMock.mockResolvedValue(null);
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({ clientId: "1", projectId: "2", items: JSON.stringify([{ reference: "REF-1", quantity: 5 }]) })
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
        items: JSON.stringify([{ quantity: 24, materialId: 7 }]),
      })
    );
    // The third argument (supplier) is `null`, not `undefined`: it now goes
    // through sanitizeScannedNullableString (lib/materialName.ts) like
    // reference/brand do (point 4 of the audit — reference/supplier used to
    // skip sanitization on the write path), which normalizes an absent value
    // to `null` rather than leaving it `undefined`.
    expect(applyScanItemsMock).toHaveBeenCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ materialId: 7, quantity: 24 })]),
      null
    );
    expect(res.type).toBe("success");
  });

  it("passes an unmatched (no materialId) item through to applyScanItems, with name composed server-side from brand/reference and unit forced to null", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockResolvedValue([] as never);
    findChildFoldersMock.mockResolvedValue([]);
    await applyDeliveryNoteScan(
      initialApply,
      formOf({
        clientId: "1",
        projectId: "2",
        supplier: "Rexel",
        items: JSON.stringify([{ brand: "Nexans", quantity: 3, reference: "REF-9" }]),
      })
    );
    expect(applyScanItemsMock).toHaveBeenCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({ name: "Nexans — REF-9", quantity: 3, unit: null, reference: "REF-9" }),
      ]),
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
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
    });
    await applyDeliveryNoteScan(
      initialApply,
      formOf(
        { clientId: "1", projectId: "2", items: JSON.stringify([{ quantity: 1, materialId: 7 }]) },
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
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
    });
    await applyDeliveryNoteScan(
      initialApply,
      formOf(
        { clientId: "1", projectId: "2", items: JSON.stringify([{ quantity: 1, materialId: 7 }]) },
        fileOf("note.jpg")
      )
    );
    expect(createFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: null })
    );
  });

  it("writes nothing to the database when cleaning the archived photo's metadata fails — the whole request fails before applyScanItems or createFile ever run", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    stripArchivedPhotoMetadataMock.mockRejectedValueOnce({ type: "error", code: "corruptedImage" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf(
        { clientId: "1", projectId: "2", items: JSON.stringify([{ quantity: 1, materialId: 7 }]) },
        fileOf("note.jpg")
      )
    );
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.materials.scan.errors.corruptedImage);
    expect(applyScanItemsMock).not.toHaveBeenCalled();
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
    expect(createFileMock).not.toHaveBeenCalled();
  });

  // Passe 3a, point 2: repository/projectMaterials.ts's applyScanItems rolls
  // the WHOLE batch back (nothing applied) when one of the reviewed lines'
  // materialId matches no row in this project — this must surface as an
  // honest error, never as "Stock mis à jour" for a delivery that was never
  // actually applied.
  it("reports an honest error (not success) when applyScanItems rolls back on an unmatched materialId — nothing was applied", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    applyScanItemsMock.mockRejectedValue({ type: "unmatchedScanMaterial", materialId: 999 });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf({
        clientId: "1",
        projectId: "2",
        items: JSON.stringify([
          { quantity: 5, materialId: 7 },
          { quantity: 2, materialId: 999 },
        ]),
      })
    );
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.materials.messages.invalidId);
    expect(res.type).not.toBe("success");
  });
});
