import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // passe 3b, point 2 regression test below needs to force it false once.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/taskGroups", () => ({
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { deleteTaskGroup } from "@/actions/taskGroups/taskGroups";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { remove, findProjectId as findGroupProjectId } from "@/repository/taskGroups";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const removeMock = vi.mocked(remove);
const canReachProjectMock = vi.mocked(canReachProject);
const findGroupProjectIdMock = vi.mocked(findGroupProjectId);

describe("deleteTaskGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteTaskGroup(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes the group when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteTaskGroup(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });

  // Passe 3b, point 2: a group that exists but sits outside the caller's
  // scope used to say "Accès refusé", distinct from "Identifiant de tâche
  // invalide" for an id that doesn't exist at all — both resolved from the
  // SAME id via the database, so the distinct wording let a restricted
  // EDITOR enumerate ids across the whole company. Both must now match.
  it("says the exact same thing for a group outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findGroupProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteTaskGroup(999, 1, 2);

    findGroupProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteTaskGroup(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.tasks.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
