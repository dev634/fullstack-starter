import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/appSettings", () => ({
  getSettings: vi.fn(),
  upsert: vi.fn(),
  updateLogo: vi.fn(),
  isLogoPublicIdReferenced: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadLogo: vi.fn(),
  destroyLogo: vi.fn(),
  destroyUploadedAsset: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { updateSettings, uploadLogo, removeLogo } from "@/actions/appSettings/appSettings";
import { requireRole } from "@/lib/authz";
import { getSettings, upsert, updateLogo, isLogoPublicIdReferenced } from "@/repository/appSettings";
import { uploadLogo as uploadLogoToCloudinary, destroyLogo, destroyUploadedAsset } from "@/lib/cloudinary";
import fr from "@/lib/i18n/dictionaries/fr";
import { revalidateTag } from "next/cache";

const requireRoleMock = vi.mocked(requireRole);
const getSettingsMock = vi.mocked(getSettings);
const upsertMock = vi.mocked(upsert);
const updateLogoMock = vi.mocked(updateLogo);
const uploadLogoMock = vi.mocked(uploadLogoToCloudinary);
const destroyLogoMock = vi.mocked(destroyLogo);
const destroyUploadedAssetMock = vi.mocked(destroyUploadedAsset);
const isLogoPublicIdReferencedMock = vi.mocked(isLogoPublicIdReferenced);
const revalidateTagMock = vi.mocked(revalidateTag);
const initial = { type: null, message: "" } as const;

const NEW_LOGO = {
  url: "https://res.cloudinary.com/new.png",
  publicId: "app-settings/new",
  deliveryType: "UPLOAD",
  resourceType: "IMAGE",
} as const;

const currentSettings = {
  id: 1,
  appName: "Fullstack Starter",
  logoUrl: null,
  logoPublicId: null,
  primaryColor: "#3b82f6",
  accentColor: "#8b5cf6",
  updatedAt: new Date(),
  updatedBy: null,
};

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("updateSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-SUPERADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await updateSettings(initial, formOf({ appName: "Acme", primaryColor: "#111111", accentColor: "#222222" }));
    expect(res.type).toBe("error");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects a non-hex color with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    const res = await updateSettings(initial, formOf({ appName: "Acme", primaryColor: "blue", accentColor: "#222222" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.primaryColor).toBeTruthy();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects an empty app name", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    const res = await updateSettings(initial, formOf({ appName: "", primaryColor: "#111111", accentColor: "#222222" }));
    expect(res.type).toBe("zodError");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("updates settings and invalidates the cache tag when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    getSettingsMock.mockResolvedValue(currentSettings as never);
    upsertMock.mockResolvedValue({ ...currentSettings, appName: "Acme" } as never);
    const res = await updateSettings(initial, formOf({ appName: "Acme", primaryColor: "#111111", accentColor: "#222222" }));
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ appName: "Acme", primaryColor: "#111111", accentColor: "#222222", updatedBy: "super@example.com" })
    );
    expect(revalidateTagMock).toHaveBeenCalled();
    expect(res.type).toBe("success");
  });

  // F7 (fix/televersements): the branding form and the logo upload used to write each other's columns with a
  // copy read a moment earlier, so a logo upload in flight was overwritten by a stale logoUrl. They now write
  // DISJOINT columns: whichever commits last cannot undo the other.
  it("never writes the logo columns, and does not even read the logo it would have carried", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    getSettingsMock.mockResolvedValue({ ...currentSettings, logoUrl: "https://res.cloudinary.com/x.png", logoPublicId: "app-settings/x" } as never);
    upsertMock.mockResolvedValue(currentSettings as never);
    await updateSettings(initial, formOf({ appName: "Acme", primaryColor: "#111111", accentColor: "#222222" }));
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const written = upsertMock.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual(["accentColor", "appName", "primaryColor", "updatedBy"]);
    expect(getSettingsMock).not.toHaveBeenCalled();
    expect(updateLogoMock).not.toHaveBeenCalled();
  });
});

describe("uploadLogo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-SUPERADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await uploadLogo(initial, formOf({}));
    expect(res.type).toBe("error");
    expect(uploadLogoMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    const res = await uploadLogo(initial, formOf({}));
    expect(res.type).toBe("error");
    expect(uploadLogoMock).not.toHaveBeenCalled();
  });

  it("uploads the logo, destroys the previous one, and invalidates the cache", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    getSettingsMock.mockResolvedValue({ ...currentSettings, logoPublicId: "app-settings/old" } as never);
    uploadLogoMock.mockResolvedValue(NEW_LOGO);
    updateLogoMock.mockResolvedValue(currentSettings as never);

    const fd = new FormData();
    fd.set("logo", new File(["x"], "logo.png", { type: "image/png" }));
    const res = await uploadLogo(initial, fd);

    // F7: the logo columns and the actor, nothing of the branding (name, colors) read a moment earlier.
    expect(updateLogoMock).toHaveBeenCalledWith({
      logoUrl: "https://res.cloudinary.com/new.png",
      logoPublicId: "app-settings/new",
      updatedBy: "super@example.com",
    });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(destroyLogoMock).toHaveBeenCalledWith("app-settings/old");
    expect(revalidateTagMock).toHaveBeenCalled();
    expect(res.type).toBe("success");
    // A success destroys nothing it just uploaded.
    expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
  });

  // Point 3 (fix/televersements): the logo is PUBLIC, so an orphan is readable by anyone.
  describe("compensation when the write fails after the upload", () => {
    afterEach(() => vi.restoreAllMocks());
    function logoForm(): FormData {
      const fd = new FormData();
      fd.set("logo", new File(["x"], "logo.png", { type: "image/png" }));
      return fd;
    }
    beforeEach(() => {
      vi.clearAllMocks();
      requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
      getSettingsMock.mockResolvedValue({ ...currentSettings, logoPublicId: "app-settings/old" } as never);
      uploadLogoMock.mockResolvedValue(NEW_LOGO);
      isLogoPublicIdReferencedMock.mockResolvedValue(false);
      destroyUploadedAssetMock.mockResolvedValue(undefined);
    });

    it("destroys the NEW logo by the type and resource_type the upload reported, never the previous one", async () => {
      updateLogoMock.mockRejectedValue({ type: "repositoryError", message: "Database Error updating app settings." });
      vi.spyOn(console, "log").mockImplementation(() => {});
      const res = await uploadLogo(initial, logoForm());
      expect(res).toMatchObject({ type: "error", message: fr.errors.serverError });
      expect(destroyUploadedAssetMock).toHaveBeenCalledTimes(1);
      expect(destroyUploadedAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({ publicId: "app-settings/new", deliveryType: "UPLOAD", resourceType: "IMAGE" })
      );
      expect(destroyLogoMock).not.toHaveBeenCalled();
    });

    it("destroys nothing when a row references the new logo (the write may have committed)", async () => {
      updateLogoMock.mockRejectedValue({ type: "repositoryError", message: "x" });
      isLogoPublicIdReferencedMock.mockResolvedValue(true);
      vi.spyOn(console, "log").mockImplementation(() => {});
      await uploadLogo(initial, logoForm());
      expect(isLogoPublicIdReferencedMock).toHaveBeenCalledWith("app-settings/new");
      expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
    });

    it("destroys nothing when a failure comes AFTER a successful write (the cache invalidation)", async () => {
      updateLogoMock.mockResolvedValue(currentSettings as never);
      revalidateTagMock.mockImplementationOnce(() => {
        throw new Error("revalidate failed");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await uploadLogo(initial, logoForm());
      expect(res.type).toBe("error");
      expect(isLogoPublicIdReferencedMock).not.toHaveBeenCalled();
      expect(destroyUploadedAssetMock).not.toHaveBeenCalled();
    });

    it("keeps the ORIGINAL refusal when the destruction itself fails", async () => {
      updateLogoMock.mockRejectedValue({ type: "repositoryError", message: "x" });
      destroyUploadedAssetMock.mockRejectedValue(new Error("cloudinary down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      const res = await uploadLogo(initial, logoForm());
      expect(res).toMatchObject({ type: "error", message: fr.errors.serverError });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Compensation failed"), expect.any(Error));
    });
  });
});

describe("removeLogo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-SUPERADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await removeLogo();
    expect(res.type).toBe("error");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("clears the logo fields and destroys the Cloudinary asset", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    getSettingsMock.mockResolvedValue({ ...currentSettings, logoUrl: "https://res.cloudinary.com/x.png", logoPublicId: "app-settings/x" } as never);
    updateLogoMock.mockResolvedValue(currentSettings as never);
    const res = await removeLogo();
    expect(updateLogoMock).toHaveBeenCalledWith({ logoUrl: null, logoPublicId: null, updatedBy: "super@example.com" });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(destroyLogoMock).toHaveBeenCalledWith("app-settings/x");
    expect(res.type).toBe("success");
  });
});
