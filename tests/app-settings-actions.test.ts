import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/appSettings", () => ({
  getSettings: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadLogo: vi.fn(),
  destroyLogo: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { updateSettings, uploadLogo, removeLogo } from "@/actions/appSettings/appSettings";
import { requireRole } from "@/lib/authz";
import { getSettings, upsert } from "@/repository/appSettings";
import { uploadLogo as uploadLogoToCloudinary, destroyLogo } from "@/lib/cloudinary";
import { revalidateTag } from "next/cache";

const requireRoleMock = vi.mocked(requireRole);
const getSettingsMock = vi.mocked(getSettings);
const upsertMock = vi.mocked(upsert);
const uploadLogoMock = vi.mocked(uploadLogoToCloudinary);
const destroyLogoMock = vi.mocked(destroyLogo);
const revalidateTagMock = vi.mocked(revalidateTag);
const initial = { type: null, message: "" } as const;

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

  it("preserves the existing logo when updating colors/name", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "super@example.com" });
    getSettingsMock.mockResolvedValue({ ...currentSettings, logoUrl: "https://res.cloudinary.com/x.png", logoPublicId: "app-settings/x" } as never);
    upsertMock.mockResolvedValue(currentSettings as never);
    await updateSettings(initial, formOf({ appName: "Acme", primaryColor: "#111111", accentColor: "#222222" }));
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: "https://res.cloudinary.com/x.png", logoPublicId: "app-settings/x" })
    );
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
    uploadLogoMock.mockResolvedValue({ url: "https://res.cloudinary.com/new.png", publicId: "app-settings/new" });
    upsertMock.mockResolvedValue(currentSettings as never);

    const fd = new FormData();
    fd.set("logo", new File(["x"], "logo.png", { type: "image/png" }));
    const res = await uploadLogo(initial, fd);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: "https://res.cloudinary.com/new.png", logoPublicId: "app-settings/new" })
    );
    expect(destroyLogoMock).toHaveBeenCalledWith("app-settings/old");
    expect(revalidateTagMock).toHaveBeenCalled();
    expect(res.type).toBe("success");
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
    upsertMock.mockResolvedValue(currentSettings as never);
    const res = await removeLogo();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: null, logoPublicId: null }));
    expect(destroyLogoMock).toHaveBeenCalledWith("app-settings/x");
    expect(res.type).toBe("success");
  });
});
