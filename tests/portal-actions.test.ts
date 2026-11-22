import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// A real ADMIN is never project-restricted (lib/accessContext.ts), so the scope
// tests below force a restricted context; everything else uses the real one.
vi.mock("@/lib/accessContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accessContext")>();
  return { ...actual, getAccessContext: vi.fn(actual.getAccessContext) };
});
vi.mock("@/repository/users", () => ({
  create: vi.fn(),
  createResetToken: vi.fn(),
  findAccessScopeByEmail: vi.fn(),
}));
vi.mock("@/repository/contacts", () => ({ findById: vi.fn(), attachLogin: vi.fn() }));
vi.mock("@/repository/projects", () => ({ hasProjectAmong: vi.fn(), countProjectsOutside: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { createPortalLogin } from "@/actions/portal/portal";
import { canManagePortalLogins } from "@/lib/access";
import { auth } from "@/lib/auth";
import { getAccessContext } from "@/lib/accessContext";
import { create, createResetToken, findAccessScopeByEmail } from "@/repository/users";
import { findById, attachLogin } from "@/repository/contacts";
import { hasProjectAmong } from "@/repository/projects";
import fr from "@/lib/i18n/dictionaries/fr";
import { accountWithoutFunction } from "./helpers/accessFixtures";

const CONTACT = { id: 3, clientId: 9, firstName: "Jean", lastName: "Dupont", email: "j@d.com", userId: null };

const realGetAccessContext = vi.mocked(getAccessContext).getMockImplementation();

function restrictedTo(ids: number[]) {
  vi.mocked(getAccessContext).mockResolvedValue({
    email: "admin@x.com",
    role: "ADMIN",
    hiddenSections: new Set(),
    hiddenAreas: new Set(),
    projectIds: new Set(ids),
  });
}

function asAdmin(scope = accountWithoutFunction()) {
  vi.mocked(auth).mockResolvedValue({ user: { role: "ADMIN", email: "admin@x.com" } } as never);
  vi.mocked(findAccessScopeByEmail).mockResolvedValue(scope);
}

// Lot 1, F3: createPortalLogin used to check users.manage and nothing else.
describe("createPortalLogin guards (lot 1, F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (realGetAccessContext) vi.mocked(getAccessContext).mockImplementation(realGetAccessContext);
    vi.mocked(findById).mockResolvedValue(CONTACT as never);
    vi.mocked(create).mockResolvedValue({ id: 50 } as never);
  });

  it("creates the login and returns the reset path in the legitimate case", async () => {
    asAdmin();
    const res = await createPortalLogin(3);
    expect(res.ok).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ role: "CLIENT", email: "j@d.com" }));
    expect(attachLogin).toHaveBeenCalledWith(3, 50);
    expect(createResetToken).toHaveBeenCalledTimes(1);
  });

  it("refuses an EDITOR (capability users.manage)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { role: "EDITOR", email: "e@x.com" } } as never);
    vi.mocked(findAccessScopeByEmail).mockResolvedValue(accountWithoutFunction());
    const res = await createPortalLogin(3);
    expect(res.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses when the function hides admin.users", async () => {
    asAdmin({ ...accountWithoutFunction(), hiddenAreas: ["admin.users"] });
    const res = await createPortalLogin(3);
    expect(res.ok).toBe(false);
    expect(findById).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses when the function hides clients.contacts", async () => {
    asAdmin({ ...accountWithoutFunction(), hiddenAreas: ["clients.contacts"] });
    const res = await createPortalLogin(3);
    expect(res.ok).toBe(false);
    expect(findById).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("answers a contact of a company outside the scope exactly like an unknown contact", async () => {
    asAdmin();
    restrictedTo([202]);
    vi.mocked(hasProjectAmong).mockResolvedValue(false);
    const outOfScope = await createPortalLogin(3);

    vi.mocked(findById).mockResolvedValue(null as never);
    const unknown = await createPortalLogin(4);

    expect(outOfScope).toEqual({ ok: false, message: fr.errors.invalidId });
    expect(outOfScope).toEqual(unknown);
    expect(create).not.toHaveBeenCalled();
    expect(createResetToken).not.toHaveBeenCalled();
  });

  it("still serves a contact whose company is reached through an assigned project", async () => {
    asAdmin();
    restrictedTo([202]);
    vi.mocked(hasProjectAmong).mockResolvedValue(true);
    const res = await createPortalLogin(3);
    expect(res.ok).toBe(true);
    expect(hasProjectAmong).toHaveBeenCalledWith(9, [202]);
  });
});

// The button offered by the screen asks the same two gates as the action.
describe("canManagePortalLogins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (realGetAccessContext) vi.mocked(getAccessContext).mockImplementation(realGetAccessContext);
  });

  it("is true for an ADMIN whose function shows admin.users", async () => {
    asAdmin();
    expect(await canManagePortalLogins("ADMIN")).toBe(true);
  });

  it("is false when the function hides admin.users, or the role lacks users.manage", async () => {
    asAdmin({ ...accountWithoutFunction(), hiddenAreas: ["admin.users"] });
    expect(await canManagePortalLogins("ADMIN")).toBe(false);
    asAdmin();
    expect(await canManagePortalLogins("EDITOR")).toBe(false);
  });

  it("refuses a voided session (undefined role) — why a page may hand it the role directly", async () => {
    asAdmin();
    expect(await canManagePortalLogins(undefined)).toBe(false);
  });
});
