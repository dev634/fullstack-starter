import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseAssignee } from "@/schemas/taskAssignee";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/repository/tasks", () => ({ setAssignee: vi.fn() }));
vi.mock("@/repository/taskGroups", () => ({ setAssignee: vi.fn() }));
vi.mock("@/repository/taskCategories", () => ({ setAssignee: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { setAssignee } from "@/actions/taskAssignee/taskAssignee";
import { requireRole } from "@/lib/authz";
import { setAssignee as setTaskAssigneeRepo } from "@/repository/tasks";
import { setAssignee as setGroupAssigneeRepo } from "@/repository/taskGroups";
import { setAssignee as setCategoryAssigneeRepo } from "@/repository/taskCategories";

const requireRoleMock = vi.mocked(requireRole);
const taskRepoMock = vi.mocked(setTaskAssigneeRepo);
const groupRepoMock = vi.mocked(setGroupAssigneeRepo);
const categoryRepoMock = vi.mocked(setCategoryAssigneeRepo);

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
});
