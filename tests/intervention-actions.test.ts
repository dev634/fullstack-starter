import { describe, it, expect, vi, beforeEach } from "vitest";

// Passe 3b, point 2 touched three functions in this file (editIntervention,
// changeInterventionStatus, deleteIntervention) but no dedicated unit test
// file existed for actions/interventions/interventions.ts before this pass —
// only the structural guard-coverage check (tests/authz-coverage.test.ts)
// touched it. Scoped to what the fix needs to prove, not a full CRUD suite
// for the whole module.
vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/interventions", () => ({
  create: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
  remove: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { editIntervention, changeInterventionStatus, deleteIntervention } from "@/actions/interventions/interventions";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { update, updateStatus, remove, findProjectId as findInterventionProjectId } from "@/repository/interventions";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const updateMock = vi.mocked(update);
const updateStatusMock = vi.mocked(updateStatus);
const removeMock = vi.mocked(remove);
const findInterventionProjectIdMock = vi.mocked(findInterventionProjectId);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

const validEditFields = {
  id: "1",
  clientId: "1",
  projectId: "2",
  scheduledAt: "2026-08-01T10:00:00.000Z",
  description: "Mise en service",
};

describe("editIntervention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await editIntervention(initial, formOf(validEditFields));
    expect(res.type).toBe("error");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates the intervention when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 1 } as never);
    const res = await editIntervention(initial, formOf(validEditFields));
    expect(updateMock).toHaveBeenCalledWith(1, expect.objectContaining({ description: "Mise en service" }));
    expect(res.type).toBe("success");
  });

  // Passe 3b, point 2: an intervention that exists but sits outside the
  // caller's scope used to say "Accès refusé", distinct from "Identifiant
  // d'intervention invalide" for an id that doesn't exist at all — both
  // resolved from the SAME id via the database, so the distinct wording let
  // a restricted EDITOR enumerate ids across the whole company. Both must
  // now match.
  it("says the exact same thing for an intervention outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findInterventionProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await editIntervention(initial, formOf({ ...validEditFields, id: "999" }));

    findInterventionProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await editIntervention(initial, formOf(validEditFields));

    expect(notFound.message).toBe(fr.interventions.messages.invalidId);
    expect(outOfScope.message).toBe(fr.interventions.messages.invalidId);
    expect(outOfScope.message).not.toBe(fr.errors.forbidden);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("changeInterventionStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await changeInterventionStatus(1, "FAITE", 1, 2);
    expect(res.type).toBe("error");
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it("updates the status when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateStatusMock.mockResolvedValue({ id: 1, status: "FAITE" } as never);
    const res = await changeInterventionStatus(1, "FAITE", 1, 2);
    expect(updateStatusMock).toHaveBeenCalledWith(1, "FAITE");
    expect(res.type).toBe("success");
  });

  // Passe 3b, point 2 — see editIntervention's regression test above.
  it("says the exact same thing for an intervention outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findInterventionProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await changeInterventionStatus(999, "FAITE", 1, 2);

    findInterventionProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await changeInterventionStatus(1, "FAITE", 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.interventions.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.interventions.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(updateStatusMock).not.toHaveBeenCalled();
  });
});

describe("deleteIntervention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteIntervention(1, 1, 2);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deletes the intervention when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteIntervention(1, 1, 2);
    expect(removeMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });

  // Passe 3b, point 2 — see editIntervention's regression test above.
  it("says the exact same thing for an intervention outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findInterventionProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await deleteIntervention(999, 1, 2);

    findInterventionProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await deleteIntervention(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.interventions.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.interventions.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
