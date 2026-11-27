import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mirrors tests/user-actions.test.ts's mock shape (session {email, role}) and
// tests/intervention-actions.test.ts's approach to guarding module-level
// dependencies — plus the CONVENTIONS.md warning: a getAccessContext mock
// missing a field doesn't break anything until a guard reads it, so every
// field is present here even though most tests only exercise hiddenAreas.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }),
  APP_SETTINGS_TAG: "app-settings",
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn(),
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/users", () => ({
  findIdByEmail: vi.fn(),
}));
vi.mock("@/repository/equipment", () => ({
  create: vi.fn(),
  update: vi.fn(),
  findById: vi.fn(),
  removeIfNotLent: vi.fn(),
  isPhotoPublicIdReferenced: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadEquipmentPhoto: vi.fn(),
  destroyEquipmentPhoto: vi.fn(),
  destroyUploadedAsset: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addEquipment, editEquipment, deleteEquipment } from "@/actions/equipment/equipment";
import { auth } from "@/lib/auth";
import { getAccessContext } from "@/lib/accessContext";
import { findIdByEmail } from "@/repository/users";
import { create, update, findById, removeIfNotLent, isPhotoPublicIdReferenced } from "@/repository/equipment";
import { uploadEquipmentPhoto, destroyEquipmentPhoto, destroyUploadedAsset } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import fr from "@/lib/i18n/dictionaries/fr";

const authMock = vi.mocked(auth);
const getAccessContextMock = vi.mocked(getAccessContext);
const findIdByEmailMock = vi.mocked(findIdByEmail);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const findByIdMock = vi.mocked(findById);
const removeIfNotLentMock = vi.mocked(removeIfNotLent);
const uploadEquipmentPhotoMock = vi.mocked(uploadEquipmentPhoto);
const destroyEquipmentPhotoMock = vi.mocked(destroyEquipmentPhoto);
const destroyUploadedAssetMock = vi.mocked(destroyUploadedAsset);
const isPhotoPublicIdReferencedMock = vi.mocked(isPhotoPublicIdReferenced);
const revalidatePathMock = vi.mocked(revalidatePath);

// What uploadEquipmentPhoto returns: the URL plus the asset's own type and
// resource_type as Cloudinary reported them (a public `upload` image).
const uploaded = (url: string, publicId: string) =>
  ({ url, publicId, deliveryType: "UPLOAD", resourceType: "IMAGE" }) as const;

const initial = { type: null, message: "" } as const;

function actor(role: string, email = `${role.toLowerCase()}@x.com`, hiddenAreas: string[] = []) {
  authMock.mockResolvedValue({ user: { role, email } } as never);
  getAccessContextMock.mockResolvedValue({
    email,
    role,
    hiddenSections: new Set(),
    hiddenAreas: new Set(hiddenAreas),
    projectIds: null,
  } as never);
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const equipmentRow = (overrides: Partial<{ id: number; ownerId: number; photoUrl: string | null; photoPublicId: string | null }> = {}) => ({
  id: 5,
  ownerId: 3,
  name: "Perceuse",
  reference: null,
  photoUrl: null,
  photoPublicId: null,
  ...overrides,
});

describe("addEquipment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhotoPublicIdReferencedMock.mockResolvedValue(false);
    destroyUploadedAssetMock.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("refuses a VIEWER (read-only capability)", async () => {
    actor("VIEWER");
    const res = await addEquipment(initial, form({ name: "Perceuse" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("refuses when the loans area is hidden by the caller's job function", async () => {
    actor("EDITOR", "editor@x.com", ["loans"]);
    const res = await addEquipment(initial, form({ name: "Perceuse" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a blank (whitespace-only) name", async () => {
    actor("EDITOR");
    const res = await addEquipment(initial, form({ name: "   " }));
    expect(res.type).toBe("zodError");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps a whitespace-only reference to undefined (the repository then stores NULL)", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addEquipment(initial, form({ name: "Perceuse", reference: "   " }));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ reference: undefined }));
  });

  it("creates equipment owned by the CURRENT user, resolved from the session — never from the form", async () => {
    actor("EDITOR", "editor@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addEquipment(initial, form({ name: "Perceuse", reference: "REF-1" }));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith({
      ownerId: 3,
      name: "Perceuse",
      reference: "REF-1",
      photoUrl: undefined,
      photoPublicId: undefined,
    });
  });

  it("uploads a photo and writes the url/publicId pair together", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/abc"));
    createMock.mockResolvedValue({ id: 1 } as never);
    const fd = form({ name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await addEquipment(initial, fd);
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ photoUrl: "https://x/photo.png", photoPublicId: "equipment/abc" })
    );
  });

  // Point 12 (revue "Prêts"): a DB failure AFTER a successful upload must not
  // leave the Cloudinary asset orphaned — uploaded, but referenced by no row.
  it("destroys the just-uploaded photo when create rejects afterwards", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/orphan"));
    createMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating equipment." });

    const fd = form({ name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await addEquipment(initial, fd);

    expect(res.type).toBe("error");
    expect(destroyUploadedAssetMock).toHaveBeenCalledTimes(1);
    expect(destroyUploadedAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: "equipment/orphan", deliveryType: "UPLOAD", resourceType: "IMAGE" })
    );
    expect(isPhotoPublicIdReferencedMock).toHaveBeenCalledWith("equipment/orphan");
  });

  // The orphan cleanup is best-effort: lib/cloudinary.ts's destroy never
  // throws today, but that is a contract of ANOTHER module. If it ever did,
  // the user must still get the ORIGINAL failure (the database one), not a
  // second error masking it (delta audit, Low).
  it("still reports the original error when the orphan cleanup itself rejects", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/orphan"));
    createMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating equipment." });
    destroyUploadedAssetMock.mockRejectedValueOnce(new Error("cloudinary down"));

    const fd = form({ name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await addEquipment(initial, fd);

    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.errors.serverError);
    expect(destroyUploadedAssetMock).toHaveBeenCalledWith(expect.objectContaining({ publicId: "equipment/orphan" }));
  });

  // Point 3 (fix/televersements): ONLY the write is wrapped. The old compensation
  // sat in the outer catch and would have destroyed a photo a row now points at
  // if revalidatePath threw after a successful create (the review flagged it).
  it("destroys NOTHING when create succeeded and a later step (revalidatePath) throws", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/kept"));
    createMock.mockResolvedValue({ id: 1 } as never);
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error("revalidate failed");
    });
    const fd = form({ name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await addEquipment(initial, fd);

    expect(res.type).toBe("error");
    expect(isPhotoPublicIdReferencedMock).not.toHaveBeenCalled();
    expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
  });

  it("destroys nothing when create fails but a row already references the photo (the write may have committed)", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/maybe"));
    createMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating equipment." });
    isPhotoPublicIdReferencedMock.mockResolvedValue(true);
    const fd = form({ name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    await addEquipment(initial, fd);

    expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
  });

  it("destroys nothing on a successful create (the photo is the row's)", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/ok"));
    createMock.mockResolvedValue({ id: 1 } as never);
    const fd = form({ name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    expect((await addEquipment(initial, fd)).type).toBe("success");
    expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
  });

  it("does NOT call destroy when there was no photo to begin with", async () => {
    actor("EDITOR");
    findIdByEmailMock.mockResolvedValue(3);
    createMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating equipment." });

    const res = await addEquipment(initial, form({ name: "Perceuse" }));

    expect(res.type).toBe("error");
    expect(destroyEquipmentPhotoMock).not.toHaveBeenCalled();
  });
});

describe("editEquipment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhotoPublicIdReferencedMock.mockResolvedValue(false);
    destroyUploadedAssetMock.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("says the exact same thing for someone else's equipment as for one that doesn't exist (anti-enumeration)", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);

    findByIdMock.mockResolvedValueOnce(equipmentRow({ ownerId: 99 }) as never);
    const notOwned = await editEquipment(initial, form({ id: "5", name: "Perceuse 2" }));

    findByIdMock.mockResolvedValueOnce(null);
    const notFound = await editEquipment(initial, form({ id: "999", name: "Perceuse 2" }));

    expect(notOwned.message).toBe(fr.equipment.messages.invalidId);
    expect(notFound.message).toBe(fr.equipment.messages.invalidId);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("lets an ADMIN edit someone else's equipment", async () => {
    actor("ADMIN", "admin@x.com");
    findIdByEmailMock.mockResolvedValue(1);
    findByIdMock.mockResolvedValue(equipmentRow({ ownerId: 99 }) as never);
    updateMock.mockResolvedValue({ id: 5 } as never);
    const res = await editEquipment(initial, form({ id: "5", name: "Perceuse rouge" }));
    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalled();
  });

  it("uploads a new photo, writes the pair, and destroys the previous one only after a successful write", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("new-url", "new-id"));
    updateMock.mockResolvedValue({ id: 5 } as never);

    const fd = form({ id: "5", name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await editEquipment(initial, fd);

    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalledWith(5, expect.objectContaining({ photoUrl: "new-url", photoPublicId: "new-id" }));
    expect(destroyEquipmentPhotoMock).toHaveBeenCalledWith("old-id");
  });

  it("removePhoto=true clears the pair together, without a new upload", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    updateMock.mockResolvedValue({ id: 5 } as never);

    const res = await editEquipment(initial, form({ id: "5", name: "Perceuse", removePhoto: "true" }));

    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalledWith(5, expect.objectContaining({ photoUrl: null, photoPublicId: null }));
    expect(destroyEquipmentPhotoMock).toHaveBeenCalledWith("old-id");
  });

  it("leaves the photo untouched when neither a new upload nor removePhoto is present", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    updateMock.mockResolvedValue({ id: 5 } as never);

    const res = await editEquipment(initial, form({ id: "5", name: "Perceuse" }));

    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalledWith(5, expect.objectContaining({ photoUrl: undefined, photoPublicId: undefined }));
    expect(destroyEquipmentPhotoMock).not.toHaveBeenCalled();
  });

  // Point 12 (revue "Prêts"): a DB failure AFTER a successful upload must not
  // leave the Cloudinary asset orphaned — uploaded, but referenced by no row.
  it("destroys the just-uploaded photo when update rejects afterwards, not the previous one", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("new-url", "new-id"));
    updateMock.mockRejectedValue({ type: "repositoryError", message: "Database Error updating equipment." });

    const fd = form({ id: "5", name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await editEquipment(initial, fd);

    expect(res.type).toBe("error");
    expect(destroyUploadedAssetMock).toHaveBeenCalledTimes(1);
    expect(destroyUploadedAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: "new-id", deliveryType: "UPLOAD", resourceType: "IMAGE" })
    );
    expect(destroyEquipmentPhotoMock).not.toHaveBeenCalled();
  });

  it("destroys NOTHING of the new photo when update succeeded and a later step (revalidatePath) throws", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("new-url", "new-id"));
    updateMock.mockResolvedValue({ id: 5 } as never);
    revalidatePathMock.mockImplementationOnce(() => {
      throw new Error("revalidate failed");
    });
    const fd = form({ id: "5", name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await editEquipment(initial, fd);

    expect(res.type).toBe("error");
    expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
  });

  it("keeps the ORIGINAL refusal when the destruction of the new photo itself fails", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("new-url", "new-id"));
    updateMock.mockRejectedValue({ type: "repositoryError", message: "Database Error updating equipment." });
    destroyUploadedAssetMock.mockRejectedValue(new Error("cloudinary down"));
    const fd = form({ id: "5", name: "Perceuse" });
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    const res = await editEquipment(initial, fd);

    expect(res).toMatchObject({ type: "error", message: fr.errors.serverError });
  });

  it("does NOT call destroy when update rejects and there was no new upload", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "old-url", photoPublicId: "old-id" }) as never);
    updateMock.mockRejectedValue({ type: "repositoryError", message: "Database Error updating equipment." });

    const res = await editEquipment(initial, form({ id: "5", name: "Perceuse" }));

    expect(res.type).toBe("error");
    expect(destroyEquipmentPhotoMock).not.toHaveBeenCalled();
  });
});

// The equipment photo decodes on behalf of an ACCOUNT (lib/imageMetadata.ts: one task at a time and a
// budget of decode time per account): the action hands over the one its role guard resolved, never a form field.
describe("equipment photo: the account that owns the decode, and what a refusal says", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadEquipmentPhotoMock.mockResolvedValue(uploaded("https://x/photo.png", "equipment/abc"));
    isPhotoPublicIdReferencedMock.mockResolvedValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  function withPhoto(fields: Record<string, string>): FormData {
    const fd = form(fields);
    fd.set("photo", new File(["x"], "photo.png", { type: "image/png" }));
    return fd;
  }

  it("addEquipment and editEquipment hand the SESSION's account to the upload, whatever the form claims", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ ownerId: 3 }) as never);
    createMock.mockResolvedValue({ id: 1 } as never);
    updateMock.mockResolvedValue({ id: 5 } as never);
    await addEquipment(initial, withPhoto({ name: "Perceuse", owner: "someone-else@x.com" }));
    await editEquipment(initial, withPhoto({ id: "5", name: "Perceuse", owner: "someone-else@x.com" }));
    expect(uploadEquipmentPhotoMock.mock.calls.map((call) => call[1])).toEqual(["owner@x.com", "owner@x.com"]);
  });

  it("without a photo nothing is decoded: the upload is never asked", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ ownerId: 3 }) as never);
    createMock.mockResolvedValue({ id: 1 } as never);
    updateMock.mockResolvedValue({ id: 5 } as never);
    expect((await addEquipment(initial, form({ name: "Perceuse" }))).type).toBe("success");
    expect((await editEquipment(initial, form({ id: "5", name: "Perceuse" }))).type).toBe("success");
    expect(uploadEquipmentPhotoMock).not.toHaveBeenCalled();
  });

  it("a refusal of the decode reaches the user as its own message, and nothing is written", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    uploadEquipmentPhotoMock.mockRejectedValue({ type: "error", message: "English", i18n: "imageInProgress" });
    const res = await addEquipment(initial, withPhoto({ name: "Perceuse" }));
    expect(res).toMatchObject({ type: "error", message: "Une de tes images est déjà en cours de traitement. Réessaie dans un instant." });
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("deleteEquipment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses deleting equipment that is currently lent — detected on removeIfNotLent's own count, not a pre-check", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow() as never);
    removeIfNotLentMock.mockResolvedValue(0);

    const res = await deleteEquipment(5);

    expect(res.type).toBe("error");
    expect((res as { message: string }).message).toBe(fr.equipment.messages.cannotDeleteLent);
  });

  it("deletes and destroys the photo once the equipment row is gone", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow({ photoUrl: "url", photoPublicId: "pid" }) as never);
    removeIfNotLentMock.mockResolvedValue(1);

    const res = await deleteEquipment(5);

    expect(res.type).toBe("success");
    expect(destroyEquipmentPhotoMock).toHaveBeenCalledWith("pid");
  });

  it("scopes the delete to the caller's own ownerId for a non-admin", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findByIdMock.mockResolvedValue(equipmentRow() as never);
    removeIfNotLentMock.mockResolvedValue(1);

    await deleteEquipment(5);

    expect(removeIfNotLentMock).toHaveBeenCalledWith(5, 3);
  });

  it("passes null (no ownership scope) for an admin", async () => {
    actor("ADMIN", "admin@x.com");
    findIdByEmailMock.mockResolvedValue(1);
    findByIdMock.mockResolvedValue(equipmentRow({ ownerId: 99 }) as never);
    removeIfNotLentMock.mockResolvedValue(1);

    await deleteEquipment(5);

    expect(removeIfNotLentMock).toHaveBeenCalledWith(5, null);
  });
});
