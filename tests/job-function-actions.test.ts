import { describe, it, expect, vi, beforeEach } from "vitest";

// requireRole is mocked (the tests below control it directly); hasMinRole is
// kept REAL — setFunctionAreas' own self-lock guard (passe 3b, point 3) uses
// it to check the ACTOR's role is SUPERADMIN, a plain rank comparison with
// no session/DB dependency worth mocking.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireRole: vi.fn() };
});
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: () => undefined,
}));
// Passe 3b, point 3: setFunctionAreas now also calls auth() directly (to
// learn the ACTOR's own role, not the target's) and findJobFunctionIdByEmail
// (to learn the actor's own function id) — both must be mocked or the whole
// file fails to load (auth() transitively pulls in next-auth, which errors
// outside a request context in Vitest).
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({ findJobFunctionIdByEmail: vi.fn() }));
vi.mock("@/repository/jobFunctions", () => ({ create: vi.fn(), remove: vi.fn(), reorder: vi.fn(), updateHiddenSections: vi.fn(), updateHiddenAreas: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { reorderJobFunctions, addJobFunction, setFunctionSections, setFunctionAreas, deleteJobFunction } from "@/actions/jobFunctions/jobFunctions";
import { requireRole } from "@/lib/authz";
import { auth } from "@/lib/auth";
import { findJobFunctionIdByEmail } from "@/repository/users";
import { reorder, create, remove, updateHiddenSections, updateHiddenAreas } from "@/repository/jobFunctions";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const authMock = vi.mocked(auth);
const findJobFunctionIdByEmailMock = vi.mocked(findJobFunctionIdByEmail);
const reorderMock = vi.mocked(reorder);
const createMock = vi.mocked(create);
const removeMock = vi.mocked(remove);
const updateHiddenSectionsMock = vi.mocked(updateHiddenSections);
const updateHiddenAreasMock = vi.mocked(updateHiddenAreas);

// setFunctionAreas' own self-lock guard (passe 3b, point 3) needs the
// ACTOR's session role/email — separate from requireRoleMock above, which
// only asserts "does this role meet the functions.manage threshold", not
// which role it actually is.
function actor(role: string, email = "admin@example.com") {
  authMock.mockResolvedValue({ user: { role, email } } as never);
}

describe("job function actions", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("setFunctionSections refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await setFunctionSections(1, ["tasks"]);
    expect((res as { type: string }).type).toBe("error");
    expect(updateHiddenSectionsMock).not.toHaveBeenCalled();
  });

  it("setFunctionSections keeps only known section keys, deduped", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    updateHiddenSectionsMock.mockResolvedValue({} as never);
    const res = await setFunctionSections(5, ["tasks", "tasks", "bogus", "reserves", "<script>"]);
    expect((res as { type: string }).type).toBe("success");
    expect(updateHiddenSectionsMock).toHaveBeenCalledWith(5, ["tasks", "reserves"]);
  });

  it("setFunctionSections rejects an invalid id", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const res = await setFunctionSections(0, ["tasks"]);
    expect((res as { type: string }).type).toBe("error");
    expect(updateHiddenSectionsMock).not.toHaveBeenCalled();
  });

  it("setFunctionAreas refuses a non-ADMIN", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "forbidden" } } as never);
    const res = await setFunctionAreas(1, ["clients"]);
    expect((res as { type: string }).type).toBe("error");
    expect(updateHiddenAreasMock).not.toHaveBeenCalled();
  });

  it("setFunctionAreas keeps only known area keys, deduped", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    updateHiddenAreasMock.mockResolvedValue({} as never);
    const res = await setFunctionAreas(5, ["clients", "clients", "bogus", "admin.users", "<script>"]);
    expect((res as { type: string }).type).toBe("success");
    expect(updateHiddenAreasMock).toHaveBeenCalledWith(5, ["clients", "admin.users"]);
  });

  it("setFunctionAreas rejects an invalid id", async () => {
    requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
    const res = await setFunctionAreas(0, ["clients"]);
    expect((res as { type: string }).type).toBe("error");
    expect(updateHiddenAreasMock).not.toHaveBeenCalled();
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
    findJobFunctionIdByEmailMock.mockResolvedValue(5); // the ADMIN's own function is id 5
    removeMock.mockResolvedValue({} as never);

    const res = await deleteJobFunction(9);

    expect((res as { type: string }).type).toBe("success");
    expect(removeMock).toHaveBeenCalledWith(9);
  });

  // Passe 3b, point 3: proven during this pass — an ADMIN whose OWN function
  // hides some rubriques could call setFunctionAreas(theirOwnFunctionId, [])
  // and lift the restriction on themselves in a single call, with no
  // SUPERADMIN involved.
  describe("self-lock guard (passe 3b, point 3)", () => {
    it("an ADMIN cannot edit the function currently assigned to their own account", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findJobFunctionIdByEmailMock.mockResolvedValue(5); // the ADMIN's own function is id 5

      const res = await setFunctionAreas(5, []);

      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.jobFunctions.messages.cannotEditOwnFunction);
      expect(updateHiddenAreasMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still edit a DIFFERENT function than their own", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findJobFunctionIdByEmailMock.mockResolvedValue(5); // the ADMIN's own function is id 5
      updateHiddenAreasMock.mockResolvedValue({} as never);

      const res = await setFunctionAreas(9, ["clients"]);

      expect(res.type).toBe("success");
      expect(updateHiddenAreasMock).toHaveBeenCalledWith(9, ["clients"]);
    });

    // The anti-lockout guarantee: SUPERADMIN must always retain the ability
    // to fix a misconfigured function, including its own — the same rule
    // hiddenAreas' bypass already follows (lib/accessContext.ts).
    it("a SUPERADMIN CAN edit the function assigned to their own account — the anti-lockout escape hatch", async () => {
      requireRoleMock.mockResolvedValue({ email: "boss@example.com" } as never);
      actor("SUPERADMIN", "boss@example.com");
      findJobFunctionIdByEmailMock.mockResolvedValue(5); // the SUPERADMIN's own function is id 5
      updateHiddenAreasMock.mockResolvedValue({} as never);

      const res = await setFunctionAreas(5, []);

      expect(res.type).toBe("success");
      expect(updateHiddenAreasMock).toHaveBeenCalledWith(5, []);
      // The SUPERADMIN bypass never even needs to resolve the actor's own
      // function id — hasMinRole short-circuits it.
      expect(findJobFunctionIdByEmailMock).not.toHaveBeenCalled();
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
      findJobFunctionIdByEmailMock.mockResolvedValue(5); // the ADMIN's own function is id 5

      const res = await deleteJobFunction(5);

      expect(res.type).toBe("error");
      expect((res as { message: string }).message).toBe(fr.jobFunctions.messages.cannotDeleteOwnFunction);
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still delete a DIFFERENT function than their own", async () => {
      requireRoleMock.mockResolvedValue({ email: "admin@example.com" } as never);
      actor("ADMIN", "admin@example.com");
      findJobFunctionIdByEmailMock.mockResolvedValue(5); // the ADMIN's own function is id 5
      removeMock.mockResolvedValue({} as never);

      const res = await deleteJobFunction(9);

      expect(res.type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(9);
    });

    // The anti-lockout guarantee applies here too: SUPERADMIN must always
    // retain the ability to fix a misconfigured function, including deleting
    // its own — same rule as setFunctionAreas above.
    it("a SUPERADMIN CAN delete the function assigned to their own account — the anti-lockout escape hatch", async () => {
      requireRoleMock.mockResolvedValue({ email: "boss@example.com" } as never);
      actor("SUPERADMIN", "boss@example.com");
      findJobFunctionIdByEmailMock.mockResolvedValue(5); // the SUPERADMIN's own function is id 5
      removeMock.mockResolvedValue({} as never);

      const res = await deleteJobFunction(5);

      expect(res.type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(5);
      // The SUPERADMIN bypass never even needs to resolve the actor's own
      // function id — hasMinRole short-circuits it.
      expect(findJobFunctionIdByEmailMock).not.toHaveBeenCalled();
    });
  });
});
