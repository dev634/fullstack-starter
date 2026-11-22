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

import { requireProjectAccess, requireTrashedProjectAccess, requireClientAccess } from "@/lib/access";
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

describe("requireProjectAccess (a LIVE project, in a LIVE company)", () => {
  it("passes a live project of a live company", async () => {
    projectState.mockResolvedValue({ selfTrashed: false, inTrash: false });
    expect((await requireProjectAccess(1)).error).toBeNull();
  });

  it("refuses a trashed project with inTrash", async () => {
    projectState.mockResolvedValue({ selfTrashed: true, inTrash: true });
    expect((await requireProjectAccess(1)).error?.message).toBe(fr.errors.inTrash);
  });

  it("refuses a LIVE project whose company is in the trash (the trash does not cascade)", async () => {
    projectState.mockResolvedValue({ selfTrashed: false, inTrash: true });
    expect((await requireProjectAccess(1)).error?.message).toBe(fr.errors.inTrash);
  });

  it("refuses an absent project with invalidId", async () => {
    projectState.mockResolvedValue(null);
    expect((await requireProjectAccess(1)).error?.message).toBe(fr.errors.invalidId);
  });

  it("an out-of-scope caller is refused on scope alone, without reading the project", async () => {
    vi.mocked(canReachProject).mockReturnValue(false);
    expect((await requireProjectAccess(1)).error?.message).toBe(fr.errors.forbidden);
    expect(projectState).not.toHaveBeenCalled();
  });
});

describe("requireTrashedProjectAccess (only the project's OWN trash state)", () => {
  it("passes a trashed project", async () => {
    projectState.mockResolvedValue({ selfTrashed: true, inTrash: true });
    expect((await requireTrashedProjectAccess(1)).error).toBeNull();
  });

  it("answers a live project, a live project under a trashed company and an unknown one the same way", async () => {
    projectState.mockResolvedValue({ selfTrashed: false, inTrash: false });
    const live = await requireTrashedProjectAccess(1);
    projectState.mockResolvedValue({ selfTrashed: false, inTrash: true });
    const underTrashedCompany = await requireTrashedProjectAccess(1);
    projectState.mockResolvedValue(null);
    const unknown = await requireTrashedProjectAccess(1);
    expect(live.error?.message).toBe(fr.projects.messages.invalidId);
    expect(underTrashedCompany).toEqual(live);
    expect(unknown).toEqual(live);
  });

  it("an out-of-scope caller is refused on scope alone", async () => {
    vi.mocked(canReachProject).mockReturnValue(false);
    expect((await requireTrashedProjectAccess(1)).error?.message).toBe(fr.errors.forbidden);
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
