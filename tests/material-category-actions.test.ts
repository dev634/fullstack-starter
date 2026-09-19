import { describe, it, expect, vi, beforeEach } from "vitest";

// @/lib/sectionAccess and @/lib/areaAccess are deliberately left UNMOCKED:
// both are thin wrappers over the mocked getAccessContext below, and running
// the real requireSectionAccess/requireAreaAccess is what lets the
// hiddenSections/hiddenAreas gating tests further down exercise the actual
// gate instead of a blanket vi.fn() that always succeeds.
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // anti-enumeration regression tests below need to force it false once.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/materialCategories", () => ({
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addMaterialCategory, editMaterialCategory, deleteMaterialCategory } from "@/actions/materialCategories/materialCategories";
import { requireRole } from "@/lib/authz";
import { getAccessContext, canReachProject, type AccessContext } from "@/lib/accessContext";
import { create, rename, remove, findProjectId as findCategoryProjectId } from "@/repository/materialCategories";
import { format } from "@/lib/i18n/format";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const getAccessContextMock = vi.mocked(getAccessContext);
const canReachProjectMock = vi.mocked(canReachProject);
const createMock = vi.mocked(create);
const renameMock = vi.mocked(rename);
const removeMock = vi.mocked(remove);
const findCategoryProjectIdMock = vi.mocked(findCategoryProjectId);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("addMaterialCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "1", name: "Électrique" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  // schemas/materialCategory.ts::materialCategoryName mirrors the database
  // CHECK of migration 20260906120000 (btrim(name) > 0): a whitespace-only
  // name trims down to "" and fails the same way an empty one does.
  it("rejects a whitespace-only name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "1", name: "   " }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  // Same CHECK, its `!~ '[[:cntrl:]]'` clause: a smuggled control character
  // (here a tab) must fail validation, not reach the repository.
  // The exact set the migration's CHECK refuses (`!~ '[[:cntrl:]]'` under a
  // UTF-8 ctype): ASCII controls and the C1 range. A C1 character that Zod
  // let through reached the CHECK and came back as a generic "server error"
  // instead of a field error — the divergence this case locks shut.
  it.each([
    ["a tab", "Élec\ttrique"],
    ["a C1 control (U+0085)", "Élec\u0085trique"],
    ["a Unicode line separator (U+2028)", "Élec\u2028trique"],
  ])("rejects a name containing %s with a zod error", async (_label, name) => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "1", name }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates the category when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1, name: "Électrique" } as never);
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "2", name: "Électrique" }));
    expect(createMock).toHaveBeenCalledWith({ projectId: 2, name: "Électrique" });
    expect(res.type).toBe("success");
  });

  // requireAreaAccess("projects") gate (authz-coverage.test.ts,
  // OWNED_BY_SECTION) — a function whose hiddenAreas hides the whole
  // `projects` rubrique must not reach this action, same as every other
  // section-owned mutation.
  it("refuses when the caller's function hides the projects area", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    getAccessContextMock.mockResolvedValueOnce({
      email: "test@example.com",
      role: "ADMIN",
      hiddenSections: new Set(),
      hiddenAreas: new Set(["projects"]),
      projectIds: null,
    });
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "1", name: "Électrique" }));
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.errors.forbiddenArea);
    expect(createMock).not.toHaveBeenCalled();
  });

  // requireSectionAccess("materials") gate — a function whose hiddenSections
  // hides the materials section must not reach this action either. The
  // action reads getAccessContext TWICE before this point (once for the
  // projects area check just above, once here for the section check), so the
  // override is queued twice — a single mockResolvedValueOnce would only
  // cover the area check and let the stale default (empty hiddenSections)
  // answer the section check, masking the very gate under test.
  it("refuses when the caller's function hides the materials section", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const ctx: AccessContext = {
      email: "test@example.com",
      role: "ADMIN",
      hiddenSections: new Set(["materials"]),
      hiddenAreas: new Set(),
      projectIds: null,
    };
    getAccessContextMock.mockResolvedValueOnce(ctx).mockResolvedValueOnce(ctx);
    const res = await addMaterialCategory(initial, formOf({ clientId: "1", projectId: "1", name: "Électrique" }));
    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.errors.forbiddenSection);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("editMaterialCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await editMaterialCategory(initial, formOf({ id: "1", clientId: "1", projectId: "2", name: "Câblage" }));
    expect(res.type).toBe("error");
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await editMaterialCategory(initial, formOf({ id: "1", clientId: "1", projectId: "2", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("renames the category when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    renameMock.mockResolvedValue({ id: 1, name: "Câblage" } as never);
    const res = await editMaterialCategory(initial, formOf({ id: "1", clientId: "1", projectId: "2", name: "Câblage" }));
    expect(renameMock).toHaveBeenCalledWith(1, "Câblage");
    expect(res.type).toBe("success");
  });

  // Same anti-enumeration rule as tests/task-category-actions.test.ts: a
  // category resolved from THIS id that sits outside the caller's scope must
  // read exactly like one that doesn't exist — both are resolved from the
  // database, so a distinct "forbidden" response would let a restricted
  // EDITOR enumerate ids across the whole company.
  it("says the exact same thing for a category outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findCategoryProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await editMaterialCategory(initial, formOf({ id: "999", clientId: "1", projectId: "2", name: "Câblage" }));

    findCategoryProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await editMaterialCategory(initial, formOf({ id: "1", clientId: "1", projectId: "2", name: "Câblage" }));

    expect(notFound.message).toBe(fr.materials.messages.invalidId);
    expect(outOfScope.message).toBe(fr.materials.messages.invalidId);
    expect(outOfScope.message).not.toBe(fr.errors.forbidden);
    expect(renameMock).not.toHaveBeenCalled();
  });
});

describe("deleteMaterialCategory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteMaterialCategory(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes the category and reports how many materials fell back to non classé", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ category: { id: 1 }, unfiledCount: 3 } as never);
    const res = await deleteMaterialCategory(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
    expect(res.message).toBe(format(fr.materials.category.messages.deletedWithUnfiled, { count: 3 }));
  });

  it("reports the plain deleted message when the category had no material to unfile", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ category: { id: 1 }, unfiledCount: 0 } as never);
    const res = await deleteMaterialCategory(1, 1, 2);
    expect(res.message).toBe(fr.materials.category.messages.deleted);
  });

  // Same anti-enumeration rule as above.
  it("says the exact same thing for a category outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findCategoryProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteMaterialCategory(999, 1, 2);

    findCategoryProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteMaterialCategory(1, 1, 2);

    expect(notFound.message).toBe(fr.materials.messages.invalidId);
    expect(outOfScope.message).toBe(fr.materials.messages.invalidId);
    expect(outOfScope.message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
