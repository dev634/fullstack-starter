import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAssignee } from "@/schemas/taskAssignee";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // passe 3b, point 2 regression test below needs to force it false once.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/tasks", () => ({ setAssignee: vi.fn(), findProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("@/repository/taskGroups", () => ({ setAssignee: vi.fn(), findProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("@/repository/taskCategories", () => ({ setAssignee: vi.fn(), findProjectId: vi.fn().mockResolvedValue(2) }));
// Passe 3a, point 3: setAssignee now cross-checks the assigned company/
// intérimaire against the target's real project — default resolves to
// project 2, matching the target mocks above, so the existing
// "routes a ... assignment" tests below (which don't care about this check)
// keep passing without each having to stub it individually.
vi.mock("@/repository/subcontractors", () => ({ findCompanyProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("@/repository/interims", () => ({ findProjectId: vi.fn().mockResolvedValue(2) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { setAssignee } from "@/actions/taskAssignee/taskAssignee";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { setAssignee as setTaskAssigneeRepo, findProjectId as findTaskProjectId } from "@/repository/tasks";
import { setAssignee as setGroupAssigneeRepo } from "@/repository/taskGroups";
import { setAssignee as setCategoryAssigneeRepo } from "@/repository/taskCategories";
import { findCompanyProjectId } from "@/repository/subcontractors";
import { findProjectId as findInterimProjectId } from "@/repository/interims";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const taskRepoMock = vi.mocked(setTaskAssigneeRepo);
const findTaskProjectIdMock = vi.mocked(findTaskProjectId);
const groupRepoMock = vi.mocked(setGroupAssigneeRepo);
const categoryRepoMock = vi.mocked(setCategoryAssigneeRepo);
const findCompanyProjectIdMock = vi.mocked(findCompanyProjectId);
const findInterimProjectIdMock = vi.mocked(findInterimProjectId);

describe("parseAssignee", () => {
  it("maps company:<id> to assignedCompanyId only", () => {
    expect(parseAssignee("company:5")).toEqual({ assignedCompanyId: 5, assignedInterimId: null });
  });
  it("maps interim:<id> to assignedInterimId only", () => {
    expect(parseAssignee("interim:8")).toEqual({ assignedCompanyId: null, assignedInterimId: 8 });
  });
  it("treats empty / unknown / invalid as unassigned", () => {
    for (const v of ["", "none", "company:0", "company:-1", "company:abc", undefined, null]) {
      expect(parseAssignee(v as string)).toEqual({ assignedCompanyId: null, assignedInterimId: null });
    }
  });
});

describe("setAssignee action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await setAssignee("task", 1, "company:2", 1, 3);
    expect(res.type).toBe("error");
    expect(taskRepoMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown target kind", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    // @ts-expect-error deliberately invalid kind
    const res = await setAssignee("bogus", 1, "company:2", 1, 3);
    expect(res.type).toBe("error");
    expect(taskRepoMock).not.toHaveBeenCalled();
  });

  it("routes a task assignment to the task repository, parsed", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    taskRepoMock.mockResolvedValue({ id: 1 } as never);
    const res = await setAssignee("task", 7, "company:2", 1, 3);
    expect(taskRepoMock).toHaveBeenCalledWith(7, { assignedCompanyId: 2, assignedInterimId: null });
    expect(res.type).toBe("success");
  });

  it("routes a series assignment to the group repository", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    groupRepoMock.mockResolvedValue({ id: 1 } as never);
    await setAssignee("group", 4, "interim:9", 1, 3);
    expect(groupRepoMock).toHaveBeenCalledWith(4, { assignedCompanyId: null, assignedInterimId: 9 });
  });

  it("routes a category assignment (cleared) to the category repository", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    categoryRepoMock.mockResolvedValue({ id: 1 } as never);
    await setAssignee("category", 6, "", 1, 3);
    expect(categoryRepoMock).toHaveBeenCalledWith(6, { assignedCompanyId: null, assignedInterimId: null });
  });

  // Passe 3a, point 3: the picker only ever lists this project's own
  // subcontractor companies / intérimaires — but nothing server-side checked
  // that before, so a submitted id from another project silently assigned a
  // task to a company/intérimaire that never appears anywhere in this
  // project's UI.
  describe("cross-checks the assigned company/intérimaire against the target's project", () => {
    it("rejects a company belonging to another project", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findCompanyProjectIdMock.mockResolvedValueOnce(99); // task's real project is 2
      const res = await setAssignee("task", 7, "company:2", 1, 3);
      expect(res.type).toBe("error");
      expect(taskRepoMock).not.toHaveBeenCalled();
    });

    it("rejects a company id that doesn't exist at all", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findCompanyProjectIdMock.mockResolvedValueOnce(null);
      const res = await setAssignee("task", 7, "company:2", 1, 3);
      expect(res.type).toBe("error");
      expect(taskRepoMock).not.toHaveBeenCalled();
    });

    it("rejects an intérimaire belonging to another project", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      findInterimProjectIdMock.mockResolvedValueOnce(99); // group's real project is 2
      const res = await setAssignee("group", 4, "interim:9", 1, 3);
      expect(res.type).toBe("error");
      expect(groupRepoMock).not.toHaveBeenCalled();
    });

    it("does not look up a company/intérimaire at all when the assignment is cleared", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
      categoryRepoMock.mockResolvedValue({ id: 1 } as never);
      await setAssignee("category", 6, "", 1, 3);
      expect(findCompanyProjectIdMock).not.toHaveBeenCalled();
      expect(findInterimProjectIdMock).not.toHaveBeenCalled();
    });
  });

  // Passe 3b, point 2: a target (task/group/category) that exists but sits
  // outside the caller's scope used to say "Accès refusé", distinct from
  // "Identifiant invalide" for an id that doesn't exist at all — both
  // resolved from the SAME id via the database, so the distinct wording let
  // a restricted EDITOR enumerate ids across the whole company. Both must
  // now match.
  it("says the exact same thing for a target outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findTaskProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await setAssignee("task", 999, "company:2", 1, 3);

    findTaskProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await setAssignee("task", 7, "company:2", 1, 3);

    expect((notFound as { message: string }).message).toBe(fr.errors.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.errors.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(taskRepoMock).not.toHaveBeenCalled();
  });
});
