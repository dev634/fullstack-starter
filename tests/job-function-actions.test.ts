import { describe, it, expect, vi, beforeEach } from "vitest";

// requireRole is mocked (the tests below control it directly); hasMinRole is
// kept REAL — saveFunctionConfig's own self-lock guard (passe 3b, point 3) uses
// it to check the ACTOR's role is SUPERADMIN, a plain rank comparison with
// no session/DB dependency worth mocking.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireRole: vi.fn() };
});
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn(),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
// Passe 3b, point 3: saveFunctionConfig now also calls auth() directly (to
// learn the ACTOR's own role, not the target's) and findAccountJobFunctionByEmail
// (to learn the actor's own function id) — both must be mocked or the whole
// file fails to load (auth() transitively pulls in next-auth, which errors
// outside a request context in Vitest).
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({ findAccountJobFunctionByEmail: vi.fn(), countPrivilegedHolders: vi.fn() }));
vi.mock("@/repository/jobFunctions", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  updateConfig: vi.fn(),
  findHiddenAreasById: vi.fn().mockResolvedValue([]),
  // The pure helper the actions use to recognise a refusal thrown by the
  // repository's transaction — not a mock of behaviour.
  isGuardRefusal: (e: unknown) => !!e && typeof e === "object" && (e as { type?: string }).type === "guardRefused",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { reorderJobFunctions, addJobFunction, saveFunctionConfig, deleteJobFunction } from "@/actions/jobFunctions/jobFunctions";
import { getAccessContext } from "@/lib/accessContext";
import { requireRole } from "@/lib/authz";
import { auth } from "@/lib/auth";
import { findAccountJobFunctionByEmail, countPrivilegedHolders } from "@/repository/users";
import { reorder, create, remove, updateConfig } from "@/repository/jobFunctions";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const authMock = vi.mocked(auth);
const findAccountJobFunctionByEmailMock = vi.mocked(findAccountJobFunctionByEmail);
const reorderMock = vi.mocked(reorder);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const updateConfigMock = vi.mocked(updateConfig);
const countPrivilegedHoldersMock = vi.mocked(countPrivilegedHolders);
const getAccessContextMock = vi.mocked(getAccessContext);

// saveFunctionConfig's own self-lock guard (passe 3b, point 3) needs the
// ACTOR's session role/email — separate from requireRoleMock above, which
// only asserts "does this role meet the functions.manage threshold", not
// which role it actually is.
function actor(role: string, email = "admin@example.com") {
  authMock.mockResolvedValue({ user: { role, email } } as never);
  // refuseIfHeldByAdmin reads the caller's role through getAccessContext.
  setAccessContextRole(role, email);
}

function setAccessContextRole(role: string, email: string) {
  getAccessContextMock.mockResolvedValue({ email, role, hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null });
}

function config(overrides: Partial<Parameters<typeof saveFunctionConfig>[1]> = {}) {
  return { hiddenSections: ["tasks"], hiddenAreas: ["clients"], projectScope: "ALL", ...overrides };
}

describe("job function actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default caller: an ADMIN, on a function no administrator holds.
    setAccessContextRole("ADMIN", "admin@example.com");
    countPrivilegedHoldersMock.mockResolvedValue(0);
  });

  it("reorderJobFunctions refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await reorderJobFunctions([3, 1, 2]);
    expect((res as { type: string }).type).toBe("error");
    expect(reorderMock).not.toHaveBeenCalled();
  });

  it("reorderJobFunctions persists the given order (dropping invalid ids)", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    reorderMock.mockResolvedValue([] as never);
    const res = await reorderJobFunctions([3, 0, 1, -5, 2]);
    expect((res as { type: string }).type).toBe("success");
    expect(reorderMock).toHaveBeenCalledWith([3, 1, 2]);
  });

  it("addJobFunction refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const fd = new FormData();
    fd.set("name", "Couvreur");
    const res = await addJobFunction({ type: null, message: "" }, fd);
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("saveFunctionConfig refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await saveFunctionConfig(1, config());
    expect((res as { type: string }).type).toBe("error");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("saveFunctionConfig keeps only known section and area keys, deduped, in ONE write", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    // The self-lock guard needs a real session + the caller's own function id
    // resolved — give it one that isn't 5, the id under test.
    actor("ADMIN", "admin@example.com");
    findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: null });
    updateConfigMock.mockResolvedValue({} as never);
    const res = await saveFunctionConfig(5, {
      hiddenSections: ["tasks", "tasks", "bogus", "reserves", "<script>"],
      hiddenAreas: ["clients", "clients", "bogus", "admin.users", "<script>"],
      projectScope: "ASSIGNED",
    });
    expect((res as { type: string }).type).toBe("success");
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(updateConfigMock).toHaveBeenCalledWith(5, {
      hiddenSections: ["tasks", "reserves"],
      hiddenAreas: ["clients", "admin.users"],
      projectScope: "ASSIGNED",
    }, expect.any(Function));
  });

  // A payload that is not what the editor sends is refused, never repaired:
  // hiddenAreas -> [] un-hid every rubrique and an unknown scope -> "ALL"
  // lifted the project restriction. Nothing is written.
  it.each([
    ["an unrecognised scope", config({ projectScope: "bogus" })],
    ["a null config", null],
    ["a missing hiddenAreas", { hiddenSections: ["tasks"], projectScope: "ALL" }],
    ["a missing hiddenSections", { hiddenAreas: ["clients"], projectScope: "ALL" }],
    ["a missing projectScope", { hiddenSections: ["tasks"], hiddenAreas: ["clients"] }],
    ["a non-array hiddenAreas", { ...config(), hiddenAreas: "clients" }],
    ["a non-string area key", { ...config(), hiddenAreas: [1] }],
  ])("saveFunctionConfig refuses %s without writing", async (_label, payload) => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    actor("ADMIN", "admin@example.com");
    findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: null });
    updateConfigMock.mockResolvedValue({} as never);
    const res = await saveFunctionConfig(5, payload as never);
    expect((res as { type: string }).type).toBe("error");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("saveFunctionConfig rejects an invalid id", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const res = await saveFunctionConfig(0, config());
    expect((res as { type: string }).type).toBe("error");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("saveFunctionConfig reports a repository failure", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    actor("ADMIN", "admin@example.com");
    findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: null });
    updateConfigMock.mockRejectedValue({ type: "repositoryError", message: "Database Error" });
    const res = await saveFunctionConfig(5, config());
    expect((res as { type: string }).type).toBe("error");
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
  });

  it("deleteJobFunction refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await deleteJobFunction(1);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteJobFunction deletes a function that isn't the caller's own", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    actor("ADMIN", "admin@example.com");
    findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the ADMIN's own function is id 5
    removeMock.mockResolvedValue({} as never);

    const res = await deleteJobFunction(9);

    expect((res as { type: string }).type).toBe("success");
    expect(removeMock).toHaveBeenCalledWith(9, expect.any(Function));
  });

  // Passe 3b, point 3: proven during this pass — an ADMIN whose OWN function
  // hides some rubriques could call saveFunctionConfig(theirOwnFunctionId, { hiddenAreas: [] })
  // and lift the restriction on themselves in a single call, with no
  // SUPERADMIN involved.
  describe("self-lock guard (passe 3b, point 3)", () => {
    it("an ADMIN cannot edit the function currently assigned to their own account", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the ADMIN's own function is id 5
      // The caller is themselves a holder of their own function: a real count of 1.
      countPrivilegedHoldersMock.mockResolvedValue(1);

      const res = await saveFunctionConfig(5, config({ hiddenAreas: [] }));

      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.jobFunctions.messages.cannotEditOwnFunction);
      expect(updateConfigMock).not.toHaveBeenCalled();
      // Refused by the self-lock guard, BEFORE the holder count is consulted.
      expect(countPrivilegedHoldersMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still edit a DIFFERENT function than their own", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the ADMIN's own function is id 5
      updateConfigMock.mockResolvedValue({} as never);

      const res = await saveFunctionConfig(9, config());

      expect(res.type).toBe("success");
      expect(updateConfigMock).toHaveBeenCalledWith(9, { hiddenSections: ["tasks"], hiddenAreas: ["clients"], projectScope: "ALL" }, expect.any(Function));
    });

    // The anti-lockout guarantee: SUPERADMIN must always retain the ability
    // to fix a misconfigured function, including its own — the same rule
    // hiddenAreas' bypass already follows (lib/accessContext.ts).
    it("a SUPERADMIN CAN edit the function assigned to their own account — the anti-lockout escape hatch", async () => {
      requireRoleMock.mockResolvedValue({ email: "boss@example.com" } as never);
      actor("SUPERADMIN", "boss@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the SUPERADMIN's own function is id 5
      updateConfigMock.mockResolvedValue({} as never);
      // A real count: the SUPERADMIN holds the function, and may still edit it.
      countPrivilegedHoldersMock.mockResolvedValue(1);

      const res = await saveFunctionConfig(5, config({ hiddenAreas: [] }));

      expect(res.type).toBe("success");
      // A SUPERADMIN is never guarded: no guard handed to the repository.
      expect(updateConfigMock).toHaveBeenCalledWith(5, expect.objectContaining({ hiddenAreas: [] }), null);
      // The SUPERADMIN bypass never even needs to resolve the actor's own
      // function id — hasMinRole short-circuits it.
      expect(findAccountJobFunctionByEmailMock).not.toHaveBeenCalled();
    });

    // findAccountJobFunctionByEmail distinguishes "no account" (`null`) from
    // "account, no function" (`{ jobFunctionId: null }`) — collapsing the two
    // (the bug the rename closed) let a caller whose account just vanished
    // slip through as "has no function", which this guard never refuses.
    it("refuses when the caller's own account can no longer be resolved", async () => {
      requireRoleMock.mockResolvedValue({ email: "ghost@example.com" } as never);
      actor("ADMIN", "ghost@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue(null);

      const res = await saveFunctionConfig(9, config());

      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.errors.unauthorized);
      expect(updateConfigMock).not.toHaveBeenCalled();
    });
  });

  // Adversarial pass, lot C1, #2: a THIRD lever, found alongside the two
  // above — deleteJobFunction wasn't self-locked at all. onDelete: SetNull
  // on User.jobFunctionId means deleting the function currently assigned to
  // the caller's own account clears it in the same stroke, lifting every
  // hiddenAreas/hiddenSections/projectScope restriction with no SUPERADMIN
  // involved. Same guard, same escape hatch, same reason.
  describe("self-lock guard on deleteJobFunction (lot C1, #2)", () => {
    it("an ADMIN cannot delete the function currently assigned to their own account", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the ADMIN's own function is id 5

      const res = await deleteJobFunction(5);

      expect(res.type).toBe("error");
      expect((res as { message: string }).message).toBe(fr.jobFunctions.messages.cannotDeleteOwnFunction);
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still delete a DIFFERENT function than their own", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the ADMIN's own function is id 5
      removeMock.mockResolvedValue({} as never);

      const res = await deleteJobFunction(9);

      expect(res.type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(9, expect.any(Function));
    });

    // The anti-lockout guarantee applies here too: SUPERADMIN must always
    // retain the ability to fix a misconfigured function, including deleting
    // its own — same rule as saveFunctionConfig above.
    it("a SUPERADMIN CAN delete the function assigned to their own account — the anti-lockout escape hatch", async () => {
      requireRoleMock.mockResolvedValue({ email: "boss@example.com" } as never);
      actor("SUPERADMIN", "boss@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the SUPERADMIN's own function is id 5
      removeMock.mockResolvedValue({} as never);

      const res = await deleteJobFunction(5);

      expect(res.type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(5, null);
      // The SUPERADMIN bypass never even needs to resolve the actor's own
      // function id — hasMinRole short-circuits it.
      expect(findAccountJobFunctionByEmailMock).not.toHaveBeenCalled();
    });

    // Same "no account refuses, no function does not" distinction as
    // saveFunctionConfig above.
    it("refuses when the caller's own account can no longer be resolved", async () => {
      requireRoleMock.mockResolvedValue({ email: "ghost@example.com" } as never);
      actor("ADMIN", "ghost@example.com");
      findAccountJobFunctionByEmailMock.mockResolvedValue(null);

      const res = await deleteJobFunction(9);

      expect((res as { type: string }).type).toBe("error");
      expect((res as { message: string }).message).toBe(fr.errors.unauthorized);
      expect(removeMock).not.toHaveBeenCalled();
    });
  });
  // Rule decided by the owner (2026-11-22): everything that touches an ADMIN
  // or SUPERADMIN account goes through a SUPERADMIN. A function held by such an
  // account is a constraint on that administrator — editing it lifts or imposes
  // their restrictions, deleting it detaches them (onDelete: SetNull). The
  // self-lock guards above only cover the caller's OWN function.
  describe("a function held by an administrator account is reserved to a SUPERADMIN", () => {
    const refused = fr.jobFunctions.messages.heldByAdminRequiresSuperadmin;

    const calls: [string, () => Promise<{ type: string; message?: string }>, () => void][] = [
      ["saveFunctionConfig", () => saveFunctionConfig(9, config({ projectScope: "ASSIGNED" })), () => expect(updateConfigMock).not.toHaveBeenCalled()],
      ["deleteJobFunction", () => deleteJobFunction(9), () => expect(removeMock).not.toHaveBeenCalled()],
    ];

    beforeEach(() => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      findAccountJobFunctionByEmailMock.mockResolvedValue({ jobFunctionId: 5 }); // the caller's own function is not 9
      updateConfigMock.mockResolvedValue({} as never);
      removeMock.mockResolvedValue({} as never);
    });

    it.each(calls)("%s: an ADMIN is refused when another ADMIN holds the function", async (_name, call, assertUntouched) => {
      actor("ADMIN", "admin@example.com");
      countPrivilegedHoldersMock.mockResolvedValue(1);

      const res = await call();

      expect(res.type).toBe("error");
      expect(res.message).toBe(refused);
      expect(countPrivilegedHoldersMock).toHaveBeenCalledWith(9);
      assertUntouched();
    });

    it.each(calls)("%s: an ADMIN still succeeds on a function held only by EDITOR / VIEWER accounts", async (_name, call) => {
      actor("ADMIN", "admin@example.com");
      countPrivilegedHoldersMock.mockResolvedValue(0);

      const res = await call();

      expect(res.type).toBe("success");
    });

    it.each(calls)("%s: a SUPERADMIN succeeds even when an ADMIN holds the function", async (_name, call) => {
      actor("SUPERADMIN", "boss@example.com");
      countPrivilegedHoldersMock.mockResolvedValue(2);

      const res = await call();

      expect(res.type).toBe("success");
    });

    it.each(calls)("%s: a session with no role is refused too (the check fails closed)", async (_name, call, assertUntouched) => {
      actor("ADMIN", "admin@example.com");
      getAccessContextMock.mockResolvedValue({ email: null, role: undefined, hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: new Set() });
      countPrivilegedHoldersMock.mockResolvedValue(1);

      const res = await call();

      expect(res.type).toBe("error");
      assertUntouched();
    });
  });
});
