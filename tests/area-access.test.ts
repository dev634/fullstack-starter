import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/accessContext", () => ({ getAccessContext: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { getAccessContext, type AccessContext } from "@/lib/accessContext";
import { getHiddenAreas, canAccessArea, requireAreaAccess, firstAccessibleAreaHref } from "@/lib/areaAccess";
import type { AppAreaKey } from "@/lib/appAreas";

const getAccessContextMock = vi.mocked(getAccessContext);

function ctxWithHidden(hiddenAreas: AppAreaKey[]): AccessContext {
  return {
    email: "user@example.com",
    role: "EDITOR",
    hiddenSections: new Set(),
    hiddenAreas: new Set(hiddenAreas),
    projectIds: null,
  };
}

describe("canAccessArea — parent/child semantics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("everything is accessible when nothing is hidden", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden([]));
    expect(await canAccessArea("clients")).toBe(true);
    expect(await canAccessArea("clients.contacts")).toBe(true);
    expect(await canAccessArea("admin.functions")).toBe(true);
  });

  it("hides a leaf key that is directly listed", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["clients.contacts"]));
    expect(await canAccessArea("clients.contacts")).toBe(false);
    // siblings and the parent stay visible
    expect(await canAccessArea("clients.info")).toBe(true);
    expect(await canAccessArea("clients")).toBe(true);
  });

  it("hiding a parent hides every one of its children, even when not themselves listed", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["clients"]));
    expect(await canAccessArea("clients")).toBe(false);
    expect(await canAccessArea("clients.info")).toBe(false);
    expect(await canAccessArea("clients.contacts")).toBe(false);
    expect(await canAccessArea("clients.projects")).toBe(false);
    // an unrelated top-level rubrique is unaffected
    expect(await canAccessArea("projects")).toBe(true);
    expect(await canAccessArea("dashboard")).toBe(true);
  });

  it("projects is a leaf: hiding it affects nothing else", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["projects"]));
    expect(await canAccessArea("projects")).toBe(false);
    expect(await canAccessArea("clients")).toBe(true);
    expect(await canAccessArea("dashboard")).toBe(true);
  });
});

describe("getHiddenAreas / requireAreaAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getHiddenAreas returns the resolved context's set", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["projects"]));
    const hidden = await getHiddenAreas();
    expect(hidden.has("projects")).toBe(true);
    expect(hidden.size).toBe(1);
  });

  it("requireAreaAccess returns no error when the area is accessible", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden([]));
    expect((await requireAreaAccess("dashboard")).error).toBeNull();
  });

  it("requireAreaAccess returns a forbidden error when the area is hidden", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["dashboard"]));
    const result = await requireAreaAccess("dashboard");
    expect(result.error?.type).toBe("error");
  });

  it("requireAreaAccess honours the parent/child rule too", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["admin"]));
    const result = await requireAreaAccess("admin.users");
    expect(result.error?.type).toBe("error");
  });
});

describe("firstAccessibleAreaHref — canonical landing order", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lands on dashboard when nothing is hidden", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden([]));
    expect(await firstAccessibleAreaHref(true, "/admin/settings/fonctions")).toBe("/");
  });

  it("skips a hidden dashboard and lands on clients", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["dashboard"]));
    expect(await firstAccessibleAreaHref(true, "/admin/settings/fonctions")).toBe("/clients");
  });

  it("skips dashboard and clients, lands on projects", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["dashboard", "clients"]));
    expect(await firstAccessibleAreaHref(true, "/admin/settings/fonctions")).toBe("/projects");
  });

  it("falls back to the given admin href once every other rubrique is hidden", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["dashboard", "clients", "projects"]));
    expect(await firstAccessibleAreaHref(true, "/admin/settings/fonctions")).toBe("/admin/settings/fonctions");
  });

  it("falls back to /acces-refuse when admin is also inaccessible (total lockout)", async () => {
    getAccessContextMock.mockResolvedValue(ctxWithHidden(["dashboard", "clients", "projects"]));
    expect(await firstAccessibleAreaHref(false, null)).toBe("/acces-refuse");
  });
});
