import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
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
// The REAL scanErrorMessage, scanErrorFromDecode and isScanError stay (the dictionary entry and the
// delay or ceiling a refusal carries are part of what these tests check); only what runs sharp, the
// model or the provider selection is replaced.
vi.mock("@/lib/deliveryNoteScan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deliveryNoteScan")>()),
  extractDeliveryNoteItems: vi.fn(),
  prepareDeliveryNoteImage: vi.fn(),
  readAndValidateDeliveryNoteImage: vi.fn().mockResolvedValue({ buffer: Buffer.from([]), mediaType: "image/jpeg" }),
  // Real implementation runs sharp on the buffer above — not exercised here
  // (the pixel-level behavior is covered by delivery-note-scan-archive.test.ts,
  // against the real function). Mocked to resolve by default so the "attaches
  // the photo" tests below reach uploadProjectFile/createFile; individual
  // tests override this to a rejection to prove nothing is written on failure.
  stripArchivedPhotoMetadata: vi.fn().mockResolvedValue(Buffer.from("cleaned-bytes")),
  scanProviderInfo: vi.fn().mockReturnValue({ provider: "anthropic", model: "claude-sonnet-5" }),
}));
vi.mock("@/repository/projectMaterials", () => ({
  applyScanItems: vi.fn(),
  // The materialIds of the bulletin are checked against the project BEFORE anything is decoded
  // (one `select id` query, no joins).
  findIdsInProject: vi.fn(),
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
vi.mock("@/repository/projectFiles", () => ({ isPublicIdReferenced: vi.fn() }));
vi.mock("@/repository/projectFolders", () => ({ findChildren: vi.fn() }));
vi.mock("@/repository/projects", () => ({ findById: vi.fn(), findTrashState: vi.fn().mockResolvedValue({ selfTrashed: false, inTrash: false }), }));
// Sentinel limits: the action must hand lib/cloudinary.ts's own object to the decode, whatever it holds.
vi.mock("@/lib/cloudinary", async (importOriginal) => ({
  uploadProjectFile: vi.fn(),
  destroyUploadedAsset: vi.fn(),
  STORAGE_IMAGE_LIMITS: { maxOutputBytes: 111, fitInPixels: 222 },
  // The REAL message (it reads the real storage ceiling: 10 Mo): part of what these tests check.
  archiveTooLargeMessage: (await importOriginal<typeof import("@/lib/cloudinary")>()).archiveTooLargeMessage,
}));
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
import { extractDeliveryNoteItems, prepareDeliveryNoteImage, stripArchivedPhotoMetadata } from "@/lib/deliveryNoteScan";
import { applyScanItems, findIdsInProject } from "@/repository/projectMaterials";
import { isPublicIdReferenced } from "@/repository/projectFiles";
import { revalidatePath } from "next/cache";
import { findChildren as findChildFolders } from "@/repository/projectFolders";
import { findById as findProjectById } from "@/repository/projects";
import { uploadProjectFile, destroyUploadedAsset } from "@/lib/cloudinary";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const extractDeliveryNoteItemsMock = vi.mocked(extractDeliveryNoteItems);
const stripArchivedPhotoMetadataMock = vi.mocked(stripArchivedPhotoMetadata);
const applyScanItemsMock = vi.mocked(applyScanItems);
const findIdsInProjectMock = vi.mocked(findIdsInProject);
const prepareDeliveryNoteImageMock = vi.mocked(prepareDeliveryNoteImage);
const findChildFoldersMock = vi.mocked(findChildFolders);
const findProjectByIdMock = vi.mocked(findProjectById);
const uploadProjectFileMock = vi.mocked(uploadProjectFile);
const destroyUploadedAssetMock = vi.mocked(destroyUploadedAsset);
const isPublicIdReferencedMock = vi.mocked(isPublicIdReferenced);
const revalidatePathMock = vi.mocked(revalidatePath);
const isRateLimitedMock = vi.mocked(isRateLimited);
const registerFailureMock = vi.mocked(registerFailure);
const initialScan = { type: null, message: "" } as const;
const initialApply = { type: null, message: "" } as const;

function fileOf(name: string, type = "image/jpeg"): File {
  return new File(["fake image bytes"], name, { type });
}

const PREPARED = { image: Buffer.from("reduced-for-the-model") };

describe("scanDeliveryNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockResolvedValue({ limited: false, retryAfterMs: 0 });
    prepareDeliveryNoteImageMock.mockResolvedValue(PREPARED);
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
    // The image for the model is decoded on behalf of the account the role guard resolved, and the
    // provider is given what that decode produced.
    expect(prepareDeliveryNoteImageMock).toHaveBeenCalledWith(expect.any(File), "admin@example.com");
    expect(extractDeliveryNoteItemsMock).toHaveBeenCalledWith(PREPARED);
  });

  // Audit F3: the unit of the hourly quota used to be reserved BEFORE the decode, so every refusal of
  // the decoder (a double click: imageInProgress) cost one of the 20 units. Now the decode comes first.
  it.each(["imageInProgress", "imageBusy", "imageUnavailable"] as const)("a decoder refusal %s does not spend a unit of the scan quota, nor reach the provider", async (code) => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    prepareDeliveryNoteImageMock.mockRejectedValue({ type: "error", code });
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    expect((await scanDeliveryNote(initialScan, fd)).type).toBe("error");
    expect(registerFailureMock).not.toHaveBeenCalled();
    expect(extractDeliveryNoteItemsMock).not.toHaveBeenCalled();
  });

  it("the unit is spent once the decode is done, before the paid provider call (and stays spent when the provider fails)", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const order: string[] = [];
    registerFailureMock.mockImplementation(async () => {
      order.push("reserve");
    });
    extractDeliveryNoteItemsMock.mockImplementation(async () => {
      order.push("provider");
      throw new Error("provider down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    await scanDeliveryNote(initialScan, fd);
    expect(order).toEqual(["reserve", "reserve", "provider"]); // the account's key and the IP's
    expect(prepareDeliveryNoteImageMock.mock.invocationCallOrder[0]).toBeLessThan(registerFailureMock.mock.invocationCallOrder[0]);
  });

  it.each([
    [{ type: "error", code: "imageInProgress" }, "Une de vos images est déjà en cours de traitement. Réessayez dans un instant."],
    [{ type: "error", code: "imageQuota", minutes: 12 }, "Vous avez demandé beaucoup de traitements d'images. Réessayez dans 12 min."],
    [{ type: "error", code: "imageUnavailable" }, "Le traitement des images est momentanément indisponible. Réessayez dans quelques minutes."],
    [{ type: "error", code: "imageTooHeavy" }, "Cette image est trop lourde à traiter. Essayez une version plus légère."],
    [{ type: "error", code: "outputTooLarge", maxBytes: 32 * 1024 * 1024 }, "Image trop volumineuse après traitement (32 Mo max)."],
  ])("shows the refusal %j of the decode as its own message", async (refusal, message) => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    prepareDeliveryNoteImageMock.mockRejectedValue(refusal);
    const fd = new FormData();
    fd.set("file", fileOf("note.jpg"));
    const res = await scanDeliveryNote(initialScan, fd);
    expect(res).toMatchObject({ type: "error", message });
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
    // The project has materials 7 and 999 (the ids the tests below name).
    findIdsInProjectMock.mockResolvedValue([7, 999]);
    stripArchivedPhotoMetadataMock.mockResolvedValue(Buffer.from("cleaned-bytes"));
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
      null,
      undefined // no photo attached: no archive row
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
      "Rexel",
      undefined
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
    // The archive's row is the 4th argument of applyScanItems: written in the SAME transaction.
    expect(applyScanItemsMock.mock.calls[0][3]).toMatchObject({ projectId: 2, folderId: 5, name: "note.jpg" });
  });

  // The archive is uploaded `authenticated`. ORDER (audit of fix/televersements): the folder read, the decode, the
  // output ceiling and the upload come BEFORE any row; then ONE transaction writes the materials and the ProjectFile row
  // (applyScanItems). If it fails the asset is compensated and nothing was applied: "try again" is true.
  describe("the archive and the rows: order, one transaction, compensation", () => {
    const ARCHIVE = {
      url: "https://example.com/note.jpg",
      publicId: "projects/2/note",
      size: 1024,
      mimeType: "image/jpeg",
      deliveryType: "AUTHENTICATED",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
    } as const;
    const run = (items: object[] = [{ quantity: 1, materialId: 7 }], extra: Record<string, string> = {}) =>
      applyDeliveryNoteScan(initialApply, formOf({ clientId: "1", projectId: "2", items: JSON.stringify(items), ...extra }, fileOf("note.jpg")));
    beforeEach(() => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      applyScanItemsMock.mockResolvedValue([] as never);
      findChildFoldersMock.mockResolvedValue([] as never);
      uploadProjectFileMock.mockResolvedValue(ARCHIVE);
      isPublicIdReferencedMock.mockResolvedValue(false);
      destroyUploadedAssetMock.mockResolvedValue(undefined);
      vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it("reads the folder and decodes, then uploads, and only THEN writes a row: folder < strip < upload < applyScanItems", async () => {
      expect((await run()).type).toBe("success");
      const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];
      expect(order(findChildFoldersMock)).toBeLessThan(order(stripArchivedPhotoMetadataMock));
      expect(order(stripArchivedPhotoMetadataMock)).toBeLessThan(order(uploadProjectFileMock));
      expect(order(uploadProjectFileMock)).toBeLessThan(order(applyScanItemsMock));
    });

    it("a folder read that FAILS fails the request before anything is decoded or sent: no orphan archive", async () => {
      findChildFoldersMock.mockRejectedValue({ type: "repositoryError", message: "Database Error." });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await run()).type).toBe("error");
      expect(stripArchivedPhotoMetadataMock).not.toHaveBeenCalled();
      expect(uploadProjectFileMock).not.toHaveBeenCalled();
      expect(applyScanItemsMock).not.toHaveBeenCalled();
    });

    it("writes the materials AND the archive's row in ONE call, the row being what the upload reported", async () => {
      await run();
      expect(applyScanItemsMock).toHaveBeenCalledTimes(1);
      expect(applyScanItemsMock.mock.calls[0][3]).toEqual({
        projectId: 2,
        folderId: null,
        name: "note.jpg",
        url: ARCHIVE.url,
        publicId: ARCHIVE.publicId,
        deliveryType: "AUTHENTICATED",
        resourceType: "IMAGE",
        format: "jpg",
        version: "1700000000",
        size: 1024,
        mimeType: "image/jpeg",
      });
    });

    it("decodes on behalf of the SESSION's account, with the limits of the storage (lib/cloudinary.ts's own object)", async () => {
      // A forged form field changes nothing: the account is the one the role guard resolved.
      await run(undefined, { owner: "someone-else@example.com", email: "someone-else@example.com" });
      expect(stripArchivedPhotoMetadataMock).toHaveBeenCalledWith("admin@example.com", expect.any(Buffer), "image/jpeg", {
        maxOutputBytes: 111,
        fitInPixels: 222,
      });
    });

    it("checks the materialIds against the project BEFORE any decode: a stranger's id spends no decoder time and writes nothing", async () => {
      findIdsInProjectMock.mockResolvedValue([7]);
      const res = await run([{ quantity: 1, materialId: 7 }, { quantity: 1, materialId: 12345 }]);
      expect(res).toMatchObject({ type: "error", message: fr.materials.messages.invalidId });
      expect(findIdsInProjectMock).toHaveBeenCalledWith(2, [7, 12345]);
      expect(stripArchivedPhotoMetadataMock).not.toHaveBeenCalled();
      expect(uploadProjectFileMock).not.toHaveBeenCalled();
      expect(applyScanItemsMock).not.toHaveBeenCalled();
    });

    it("the same id on two lines is asked once", async () => {
      findIdsInProjectMock.mockResolvedValue([7]);
      expect((await run([{ quantity: 1, materialId: 7 }, { quantity: 2, materialId: 7 }])).type).toBe("success");
      expect(findIdsInProjectMock).toHaveBeenCalledWith(2, [7]);
    });

    it("a bulletin with only NEW materials (no materialId) does not read the project's materials at all", async () => {
      expect((await run([{ brand: "Nexans", reference: "R1", quantity: 1 }])).type).toBe("success");
      expect(findIdsInProjectMock).not.toHaveBeenCalled();
    });

    it("a transaction that FAILS (materials or archive row) destroys the archive just sent and says honestly that nothing was applied: try again is true", async () => {
      applyScanItemsMock.mockRejectedValue({ type: "repositoryError", message: "Database Error applying delivery scan." });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await run();
      expect(res).toMatchObject({ type: "error", message: fr.errors.serverError });
      expect(destroyUploadedAssetMock).toHaveBeenCalledTimes(1);
      expect(destroyUploadedAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({ publicId: "projects/2/note", deliveryType: "AUTHENTICATED", resourceType: "IMAGE" })
      );
    });

    it("an unmatched material found by the transaction itself (a race) destroys the archive WITHOUT reading the database: the write provably did not happen", async () => {
      applyScanItemsMock.mockRejectedValue({ type: "unmatchedScanMaterial", materialId: 7 });
      const res = await run();
      expect(res).toMatchObject({ type: "error", message: fr.materials.messages.invalidId });
      expect(isPublicIdReferencedMock).not.toHaveBeenCalled();
      expect(destroyUploadedAssetMock).toHaveBeenCalledTimes(1);
    });

    it("destroys nothing when a row references the archive after a failed transaction (it may have committed)", async () => {
      applyScanItemsMock.mockRejectedValue({ type: "repositoryError", message: "x" });
      isPublicIdReferencedMock.mockResolvedValue(true);
      vi.spyOn(console, "error").mockImplementation(() => {});
      await run();
      expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
    });

    it("destroys nothing on success", async () => {
      expect(await run()).toMatchObject({ type: "success", message: fr.materials.scan.messages.applied });
      expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
    });

    it("destroys nothing when a failure comes AFTER the transaction (the revalidation)", async () => {
      revalidatePathMock.mockImplementationOnce(() => {
        throw new Error("revalidate failed");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await run()).type).toBe("error");
      expect(isPublicIdReferencedMock).not.toHaveBeenCalled();
      expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
    });

    it("keeps the original refusal when the destruction of the archive itself fails (and logs it with the public id)", async () => {
      applyScanItemsMock.mockRejectedValue({ type: "repositoryError", message: "x" });
      destroyUploadedAssetMock.mockRejectedValue(new Error("cloudinary down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await run();
      expect(res).toMatchObject({ type: "error", message: fr.errors.serverError });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"projects/2/note"'), expect.any(Error));
    });

    // The storage cannot keep an output beyond its file ceiling: the stock must still be applied, never refused.
    it("an archive STILL beyond the storage's file ceiling after the reduction: the materials are applied WITHOUT it, and the state is a WARNING (not a success that closes the modal)", async () => {
      stripArchivedPhotoMetadataMock.mockRejectedValueOnce({ type: "error", code: "outputTooLarge", maxBytes: 10_485_760 });
      const res = await run();
      expect(res).toEqual({
        type: "warning",
        message: "Matériaux appliqués. L'archive du bulletin dépassait la taille de stockage (10 Mo) et n'a pas été enregistrée.",
      });
      expect(applyScanItemsMock).toHaveBeenCalledTimes(1);
      expect(applyScanItemsMock.mock.calls[0][3]).toBeUndefined();
      expect(uploadProjectFileMock).not.toHaveBeenCalled();
      expect(revalidatePathMock).toHaveBeenCalled();
    });

    it.each([
      [{ type: "error", code: "imageInProgress" }, "Une de vos images est déjà en cours de traitement. Réessayez dans un instant."],
      [{ type: "error", code: "imageQuota", minutes: 41 }, "Vous avez demandé beaucoup de traitements d'images. Réessayez dans 41 min."],
      [{ type: "error", code: "imageUnavailable" }, "Le traitement des images est momentanément indisponible. Réessayez dans quelques minutes."],
      [{ type: "error", code: "imageTooHeavy" }, "Cette image est trop lourde à traiter. Essayez une version plus légère."],
    ])("a refusal %j of the decode is its own message, and nothing is uploaded or written", async (refusal, message) => {
      stripArchivedPhotoMetadataMock.mockRejectedValueOnce(refusal);
      const res = await run();
      expect(res).toMatchObject({ type: "error", message });
      expect(uploadProjectFileMock).not.toHaveBeenCalled();
      expect(applyScanItemsMock).not.toHaveBeenCalled();
    });

    it("a refusal that is not the module's own (a native error out of the decode) is the corrupted-photo message, never its text", async () => {
      stripArchivedPhotoMetadataMock.mockRejectedValueOnce(new Error("sharp: secret internal detail"));
      const res = await run();
      expect(res).toMatchObject({ type: "error", message: fr.materials.scan.errors.corruptedImage });
      expect(applyScanItemsMock).not.toHaveBeenCalled();
    });
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
    expect(applyScanItemsMock.mock.calls[0][3]).toMatchObject({ folderId: null });
  });

  it("writes nothing to the database when cleaning the archived photo's metadata fails — the whole request fails before applyScanItems ever runs", async () => {
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
  });

  it("answers 'the server is already processing images' (not 'corrupted photo') and writes nothing when the decode queue is full", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    stripArchivedPhotoMetadataMock.mockRejectedValueOnce({ type: "error", code: "imageBusy" });
    const res = await applyDeliveryNoteScan(
      initialApply,
      formOf(
        { clientId: "1", projectId: "2", items: JSON.stringify([{ quantity: 1, materialId: 7 }]) },
        fileOf("note.jpg")
      )
    );
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.materials.scan.errors.imageBusy);
    expect(res.message).not.toBe(fr.materials.scan.errors.corruptedImage);
    expect(applyScanItemsMock).not.toHaveBeenCalled();
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
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
