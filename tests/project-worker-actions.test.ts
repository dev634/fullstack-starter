import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sectionAccess", () => ({ requireSectionAccess: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/authz", () => ({
  requireRole: vi.fn(),
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  // A plain vi.fn() (default true) rather than a hardcoded () => true: the
  // "out of scope reads like not found" regression test below needs to
  // force it false once — same pattern as tests/interim-actions.test.ts.
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/projectWorkers", () => ({
  attach: vi.fn(),
  detach: vi.fn(),
  findProjectId: vi.fn().mockResolvedValue(2),
}));
vi.mock("@/repository/users", () => ({
  findById: vi.fn().mockResolvedValue({ id: 5, email: "u@example.com", role: "EDITOR", jobFunctionId: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { attachWorker, detachWorker } from "@/actions/projectWorkers/projectWorkers";
import { requireRole } from "@/lib/authz";
import { canReachProject } from "@/lib/accessContext";
import { attach, detach, findProjectId as findWorkerProjectId } from "@/repository/projectWorkers";
import { findById as findUserById } from "@/repository/users";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const canReachProjectMock = vi.mocked(canReachProject);
const attachMock = vi.mocked(attach);
const detachMock = vi.mocked(detach);
const findWorkerProjectIdMock = vi.mocked(findWorkerProjectId);
const findUserByIdMock = vi.mocked(findUserById);
const initial = { type: null, message: "" } as const;

function formOf(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
}

describe("attachWorker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await attachWorker(initial, formOf({ clientId: "1", projectId: "2", userId: "5" }));
    expect(res.type).toBe("error");
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid userId with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await attachWorker(initial, formOf({ clientId: "1", projectId: "2", userId: "" }));
    expect(res.type).toBe("zodError");
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("attaches the resolved user when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findUserByIdMock.mockResolvedValue({ id: 5, email: "u@example.com", role: "EDITOR", jobFunctionId: null } as never);
    attachMock.mockResolvedValue({ id: 1, projectId: 2, userId: 5 } as never);
    const res = await attachWorker(initial, formOf({ clientId: "1", projectId: "2", userId: "5" }));
    expect(attachMock).toHaveBeenCalledWith(2, 5);
    expect(res.type).toBe("success");
  });

  // The role that authorizes the attachment is resolved from the database,
  // never trusted from the submitted form — a tampered/stale userId must be
  // refused even though the picker itself only ever lists non-CLIENT users.
  it("refuses a CLIENT-role user, resolved from the database", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findUserByIdMock.mockResolvedValue({ id: 9, email: "portal@example.com", role: "CLIENT", jobFunctionId: null } as never);
    const res = await attachWorker(initial, formOf({ clientId: "1", projectId: "2", userId: "9" }));
    expect(res.type).toBe("error");
    expect((res as { message: string }).message).toBe(fr.workers.messages.clientNotAllowed);
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("rejects a userId that doesn't resolve to any user", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findUserByIdMock.mockResolvedValue(null);
    const res = await attachWorker(initial, formOf({ clientId: "1", projectId: "2", userId: "999" }));
    expect(res.type).toBe("error");
    expect((res as { message: string }).message).toBe(fr.workers.messages.invalidId);
    expect(attachMock).not.toHaveBeenCalled();
  });

  // Repository/projectWorkers.ts::attach throws a { type: "duplicate" } error
  // on the ProjectWorker_projectId_userId_key unique constraint (P2002) —
  // this must surface as a clean, specific message, not the generic server
  // error getErrorMessage would otherwise fall back to.
  it("reports a clean message when the user is already attached (P2002)", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    findUserByIdMock.mockResolvedValue({ id: 5, email: "u@example.com", role: "EDITOR", jobFunctionId: null } as never);
    attachMock.mockRejectedValue({ type: "duplicate", message: "This user is already attached to this project." });
    const res = await attachWorker(initial, formOf({ clientId: "1", projectId: "2", userId: "5" }));
    expect(res.type).toBe("error");
    expect((res as { message: string }).message).toBe(fr.workers.messages.alreadyAttached);
  });
});

describe("detachWorker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await detachWorker(1, 1, 2);
    expect(res.type).toBe("error");
    expect(detachMock).not.toHaveBeenCalled();
  });

  it("detaches the worker when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    detachMock.mockResolvedValue({ id: 1 } as never);
    const res = await detachWorker(1, 1, 2);
    expect(detachMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
  });

  // Same anti-enumeration rule as tests/interim-actions.test.ts's own
  // "passe 3b, point 2" regression test: a worker attachment that exists but
  // sits outside the caller's scope must read exactly like one that doesn't
  // exist at all — both resolved from the SAME id via the database.
  it("says the exact same thing for a worker outside the caller's scope as for one that doesn't exist at all", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });

    findWorkerProjectIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await detachWorker(999, 1, 2);

    findWorkerProjectIdMock.mockResolvedValueOnce(99); // exists, but project 99 isn't reachable
    canReachProjectMock.mockReturnValueOnce(false);
    const outOfScope = await detachWorker(1, 1, 2);

    expect((notFound as { message: string }).message).toBe(fr.workers.messages.invalidId);
    expect((outOfScope as { message: string }).message).toBe(fr.workers.messages.invalidId);
    expect((outOfScope as { message: string }).message).not.toBe(fr.errors.forbidden);
    expect(detachMock).not.toHaveBeenCalled();
  });
});
