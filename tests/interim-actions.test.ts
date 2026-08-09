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
vi.mock("@/repository/interims", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addInterim, deleteInterim } from "@/actions/interims/interims";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { create, remove, findProjectId as findInterimProjectId } from "@/repository/interims";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const findInterimProjectIdMock = vi.mocked(findInterimProjectId);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("addInterim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addInterim(initial, formOf({ clientId: "1", projectId: "1", name: "Jean" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addInterim(initial, formOf({ clientId: "1", projectId: "1", name: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.name).toBeTruthy();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates the interim, passing jobFunctionId/agency through when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 1 } as never);
    const res = await addInterim(
      initial,
      formOf({ clientId: "1", projectId: "2", name: "Jean Dupont", jobFunctionId: "3", agency: "Manpower" })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 2, name: "Jean Dupont", jobFunctionId: 3, agency: "Manpower" })
    );
    expect(res.type).toBe("success");
  });
});

describe("deleteInterim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteInterim(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes the interim when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteInterim(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });

  // Passe 3b, point 2: an intérimaire that exists but sits outside the
  // caller's scope used to say "Accès refusé", distinct from "Identifiant
  // d'intérimaire invalide" for an id that doesn't exist at all — both
  // resolved from the SAME id via the database, so the distinct wording let
  // a restricted EDITOR enumerate ids across the whole company. Both must
  // now match.
  it("says the exact same thing for an intérimaire outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findInterimProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteInterim(999, 1, 2);

    findInterimProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteInterim(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.interims.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.interims.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
