import { describe, it, expect, vi, beforeEach } from "vitest";

// F10 — the three scope guards of lib/access.ts, with the real module and the
// repository reads mocked: scope first (no read for an out-of-scope caller),
// then the trash state.
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn(),
  canReachProject: vi.fn(),
}));
vi.mock("@/repository/projects", () => ({ hasProjectAmong: vi.fn(), findTrashState: vi.fn() }));
vi.mock("@/repository/clients", () => ({
  isFullyInScope: vi.fn(),
  findFullyInScopeIds: vi.fn(),
  findTrashState: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ requireRole: vi.fn(), hasMinRole: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { requireProjectAccess, requireTrashedProjectAccess, requireClientAccess, requireClientAccessWithin } from "@/lib/access";
import { scopeRefusalMessage } from "@/lib/scopeRefusal";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { hasProjectAmong, findTrashState as findProjectTrashState } from "@/repository/projects";
import { findTrashState as findClientTrashState } from "@/repository/clients";
import fr from "@/lib/i18n/dictionaries/fr";

const ctx = (projectIds: Set<number> | null) =>
  ({ email: "t@x.com", role: "EDITOR", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds }) as never;

const projectState = vi.mocked(findProjectTrashState);
const clientState = vi.mocked(findClientTrashState);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccessContext).mockResolvedValue(ctx(null));
  vi.mocked(canReachProject).mockReturnValue(true);
});

const LIVE = { selfTrashed: false, parentTrashed: false, inTrash: false };
const TRASHED = { selfTrashed: true, parentTrashed: false, inTrash: true };
const UNDER_TRASHED_COMPANY = { selfTrashed: false, parentTrashed: true, inTrash: true };
const TRASHED_UNDER_TRASHED_COMPANY = { selfTrashed: true, parentTrashed: true, inTrash: true };

describe("requireProjectAccess (a LIVE project, in a LIVE company)", () => {
  it("passes a live project of a live company", async () => {
    projectState.mockResolvedValue(LIVE);
    expect((await requireProjectAccess(1)).error).toBeNull();
  });

  it("refuses a trashed project with inTrash", async () => {
    projectState.mockResolvedValue(TRASHED);
    const res = await requireProjectAccess(1);
    expect(res.error?.message).toBe(fr.errors.inTrash);
    expect(res).toMatchObject({ reason: "inTrash" });
  });

  // inTrash points at the trash of PROJECTS: for a live project under a trashed
  // company that is a dead end (it is not in that trash). The message names the
  // company instead.
  it("refuses a LIVE project whose company is in the trash with parentInTrash, not inTrash", async () => {
    projectState.mockResolvedValue(UNDER_TRASHED_COMPANY);
    const res = await requireProjectAccess(1);
    expect(res.error?.message).toBe(fr.errors.parentInTrash);
    expect(res.error?.message).not.toBe(fr.errors.inTrash);
    expect(res).toMatchObject({ reason: "parentInTrash" });
  });

  it("a trashed project under a trashed company still answers inTrash (its own trash comes first)", async () => {
    projectState.mockResolvedValue(TRASHED_UNDER_TRASHED_COMPANY);
    expect((await requireProjectAccess(1)).error?.message).toBe(fr.errors.inTrash);
  });

  it("refuses an absent project with the project-scoped invalidId", async () => {
    projectState.mockResolvedValue(null);
    const res = await requireProjectAccess(1);
    expect(res.error?.message).toBe(fr.projects.messages.invalidId);
    expect(res).toMatchObject({ reason: "absent" });
  });

  it("an out-of-scope caller is refused on scope alone, without reading the project", async () => {
    vi.mocked(canReachProject).mockReturnValue(false);
    const res = await requireProjectAccess(1);
    expect(res.error?.message).toBe(fr.errors.forbidden);
    expect(res).toMatchObject({ reason: "forbidden" });
    expect(projectState).not.toHaveBeenCalled();
  });

  // One message for an absent project, whichever guard is asked.
  it("an absent project answers the same message in requireProjectAccess and requireTrashedProjectAccess", async () => {
    projectState.mockResolvedValue(null);
    const live = await requireProjectAccess(1);
    const trashed = await requireTrashedProjectAccess(1, "destroy");
    expect(live.error?.message).toBe(trashed.error?.message);
  });
});

// The masking every anti-enumeration caller applies, from the reason (never from the text).
describe("scopeRefusalMessage", () => {
  const refused = (reason: "forbidden" | "absent" | "inTrash" | "parentInTrash") =>
    ({ error: { type: "error" as const, message: "guard message" }, reason });

  it("masks forbidden and absent behind the caller's own invalidId", () => {
    expect(scopeRefusalMessage(refused("forbidden"), "INVALID")).toBe("INVALID");
    expect(scopeRefusalMessage(refused("absent"), "INVALID")).toBe("INVALID");
  });

  it("lets the two trash reasons through: only a caller already inside the scope gets them", () => {
    expect(scopeRefusalMessage(refused("inTrash"), "INVALID")).toBe("guard message");
    expect(scopeRefusalMessage(refused("parentInTrash"), "INVALID")).toBe("guard message");
  });
});

describe("requireTrashedProjectAccess (only the project's OWN trash state)", () => {
  it("passes a trashed project, for both purposes", async () => {
    projectState.mockResolvedValue(TRASHED);
    expect((await requireTrashedProjectAccess(1, "restore")).error).toBeNull();
    expect((await requireTrashedProjectAccess(1, "destroy")).error).toBeNull();
  });

  it("answers a live project, a live project under a trashed company and an unknown one the same way", async () => {
    projectState.mockResolvedValue(LIVE);
    const live = await requireTrashedProjectAccess(1, "restore");
    projectState.mockResolvedValue(UNDER_TRASHED_COMPANY);
    const underTrashedCompany = await requireTrashedProjectAccess(1, "restore");
    projectState.mockResolvedValue(null);
    const unknown = await requireTrashedProjectAccess(1, "restore");
    expect(live.error?.message).toBe(fr.projects.messages.invalidId);
    expect(underTrashedCompany).toEqual(live);
    expect(unknown).toEqual(live);
  });

  // Restoring a project whose company is trashed would leave it out of the
  // project trash yet frozen and invisible under its company.
  it("refuses RESTORING a trashed project whose company is also trashed, but not destroying it", async () => {
    projectState.mockResolvedValue(TRASHED_UNDER_TRASHED_COMPANY);
    const restore = await requireTrashedProjectAccess(1, "restore");
    expect(restore.error?.message).toBe(fr.errors.parentInTrash);
    expect(restore).toMatchObject({ reason: "parentInTrash" });
    expect((await requireTrashedProjectAccess(1, "destroy")).error).toBeNull();
  });

  it("an out-of-scope caller is refused on scope alone", async () => {
    vi.mocked(canReachProject).mockReturnValue(false);
    expect((await requireTrashedProjectAccess(1, "restore")).error?.message).toBe(fr.errors.forbidden);
    expect(projectState).not.toHaveBeenCalled();
  });
});

describe("requireClientAccess (a LIVE company)", () => {
  it("passes a live company for an unrestricted caller, without the scope query", async () => {
    clientState.mockResolvedValue({ inTrash: false });
    expect((await requireClientAccess(1)).error).toBeNull();
    expect(hasProjectAmong).not.toHaveBeenCalled();
  });

  it("refuses a trashed company with inTrash, and an absent one with invalidId", async () => {
    clientState.mockResolvedValue({ inTrash: true });
    expect((await requireClientAccess(1)).error?.message).toBe(fr.errors.inTrash);
    clientState.mockResolvedValue(null);
    expect((await requireClientAccess(1)).error?.message).toBe(fr.errors.invalidId);
  });

  it("a restricted caller with no project in the company is refused on scope, without reading the company", async () => {
    vi.mocked(getAccessContext).mockResolvedValue(ctx(new Set([10])));
    vi.mocked(hasProjectAmong).mockResolvedValue(false);
    expect((await requireClientAccess(1)).error?.message).toBe(fr.errors.forbidden);
    expect(clientState).not.toHaveBeenCalled();
  });

  it("a restricted caller reaching a live company passes", async () => {
    vi.mocked(getAccessContext).mockResolvedValue(ctx(new Set([10])));
    vi.mocked(hasProjectAmong).mockResolvedValue(true);
    clientState.mockResolvedValue({ inTrash: false });
    expect((await requireClientAccess(1)).error).toBeNull();
  });
});

// The same rule for a caller that has already read the context and the company
// row (a CSV import loop): no per-row re-read of either.
describe("requireClientAccessWithin (context and company row already read)", () => {
  it("reads neither the access context nor the company's trash state", async () => {
    expect((await requireClientAccessWithin(ctx(null), { id: 1, deletedAt: null })).error).toBeNull();
    expect(getAccessContext).not.toHaveBeenCalled();
    expect(clientState).not.toHaveBeenCalled();
  });

  it("refuses a trashed company with the inTrash reason", async () => {
    const res = await requireClientAccessWithin(ctx(null), { id: 1, deletedAt: new Date() });
    expect(res.error?.message).toBe(fr.errors.inTrash);
    expect(res).toMatchObject({ reason: "inTrash" });
  });

  it("scope comes first: an unreachable TRASHED company answers forbidden, never the trash message", async () => {
    vi.mocked(hasProjectAmong).mockResolvedValue(false);
    const res = await requireClientAccessWithin(ctx(new Set([10])), { id: 1, deletedAt: new Date() });
    expect(res).toMatchObject({ reason: "forbidden" });
    expect(res.error?.message).toBe(fr.errors.forbidden);
  });
});
