import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/repository/users", () => ({
  create: vi.fn(),
  updateProfile: vi.fn(),
  remove: vi.fn(),
  findById: vi.fn(),
  countSuperadmins: vi.fn(),
  updatePassword: vi.fn(),
  // Read by requireAreaAccess (via getAccessContext) for every ADMIN actor —
  // unmocked, this call is `undefined` (the module mock below replaces the
  // whole file) and throws before the action's own logic ever runs. An
  // unresolved value here reads the same as "no job function", i.e.
  // unrestricted, which is what every actor in this file's fixtures is.
  findAccessScopeByEmail: vi.fn(),
  // deleteUser now checks this BEFORE remove() — see the "owns equipment or
  // an open loan" tests below. Every other deleteUser test needs a zeroed
  // default (set in beforeEach) or it would hit the catch block instead of
  // reaching remove() at all.
  countOwnershipBlockers: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { addUser, updateUser, deleteUser } from "@/actions/users/users";
import { auth } from "@/lib/auth";
import { create, updateProfile, remove, findById, countSuperadmins, countOwnershipBlockers } from "@/repository/users";
import fr from "@/lib/i18n/dictionaries/fr";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(create);
const updateProfileMock = vi.mocked(updateProfile);
const removeMock = vi.mocked(remove);
const findByIdMock = vi.mocked(findById);
const countSuperMock = vi.mocked(countSuperadmins);
const countOwnershipBlockersMock = vi.mocked(countOwnershipBlockers);
const initial = { type: null, message: "" } as const;

function actor(role: string, email = `${role.toLowerCase()}@x.com`) {
  authMock.mockResolvedValue({ user: { role, email } } as never);
}
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("user management actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Zeroed by default — see the dedicated tests below for the non-zero cases.
    countOwnershipBlockersMock.mockResolvedValue({ equipmentCount: 0, openLoanCount: 0 });
  });

  it("addUser refuses a non-ADMIN", async () => {
    actor("EDITOR");
    const res = await addUser(initial, form({ email: "n@x.com", role: "VIEWER", password: "password123" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addUser: an ADMIN cannot grant SUPERADMIN", async () => {
    actor("ADMIN");
    const res = await addUser(initial, form({ email: "n@x.com", role: "SUPERADMIN", password: "password123" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addUser: an ADMIN adds an EDITOR with a hashed password", async () => {
    actor("ADMIN");
    createMock.mockResolvedValue({ id: 5 } as never);
    const res = await addUser(initial, form({ email: "ed@x.com", name: "Ed", role: "EDITOR", password: "password123" }));
    expect(res.type).toBe("success");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ed@x.com", name: "Ed", role: "EDITOR", password: "hashed" })
    );
  });

  it("updateUser: an ADMIN cannot manage a SUPERADMIN", async () => {
    actor("ADMIN");
    findByIdMock.mockResolvedValue({ id: 9, email: "s@x.com", role: "SUPERADMIN" } as never);
    const res = await updateUser(initial, form({ id: "9", role: "ADMIN" }));
    expect(res.type).toBe("error");
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("updateUser: cannot demote the last SUPERADMIN", async () => {
    actor("SUPERADMIN");
    findByIdMock.mockResolvedValue({ id: 3, email: "s@x.com", role: "SUPERADMIN" } as never);
    countSuperMock.mockResolvedValue(1 as never);
    const res = await updateUser(initial, form({ id: "3", role: "ADMIN" }));
    expect(res.type).toBe("error");
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  // Passe 3b, point 3: proven during this pass — the second lever (besides
  // setFunctionAreas) that let an ADMIN lift every restriction their own
  // function imposes on them, in one call: repoint their OWN account at a
  // different (or no) function via this very action.
  describe("self-lock guard (passe 3b, point 3)", () => {
    it("an ADMIN cannot change their OWN jobFunctionId", async () => {
      actor("ADMIN", "me@x.com");
      findByIdMock.mockResolvedValue({ id: 1, email: "me@x.com", role: "ADMIN", jobFunctionId: 5 } as never);

      const res = await updateUser(initial, form({ id: "1", role: "ADMIN", jobFunctionId: "9" }));

      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.users.messages.cannotEditOwnFunction);
      expect(updateProfileMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still edit their OWN name/role without touching jobFunctionId", async () => {
      actor("ADMIN", "me@x.com");
      findByIdMock.mockResolvedValue({ id: 1, email: "me@x.com", role: "ADMIN", jobFunctionId: 5 } as never);
      updateProfileMock.mockResolvedValue({ id: 1 } as never);

      const res = await updateUser(initial, form({ id: "1", name: "New Name", role: "ADMIN", jobFunctionId: "5" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: "New Name", jobFunctionId: 5 }));
    });

    it("an ADMIN can still change ANOTHER user's jobFunctionId", async () => {
      actor("ADMIN", "me@x.com");
      findByIdMock.mockResolvedValue({ id: 7, email: "other@x.com", role: "EDITOR", jobFunctionId: 5 } as never);
      updateProfileMock.mockResolvedValue({ id: 7 } as never);

      const res = await updateUser(initial, form({ id: "7", role: "EDITOR", jobFunctionId: "9" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(7, expect.objectContaining({ jobFunctionId: 9 }));
    });

    // The anti-lockout guarantee: SUPERADMIN must always retain the ability
    // to repoint its own account, same as setFunctionAreas' own escape
    // hatch — it bypasses hiddenAreas unconditionally anyway
    // (lib/accessContext.ts), so this changes nothing it can't already do.
    it("a SUPERADMIN CAN change their own jobFunctionId — the anti-lockout escape hatch", async () => {
      actor("SUPERADMIN", "boss@x.com");
      findByIdMock.mockResolvedValue({ id: 1, email: "boss@x.com", role: "SUPERADMIN", jobFunctionId: 5 } as never);
      updateProfileMock.mockResolvedValue({ id: 1 } as never);

      const res = await updateUser(initial, form({ id: "1", role: "SUPERADMIN", jobFunctionId: "9" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(1, expect.objectContaining({ jobFunctionId: 9 }));
    });
  });

  it("deleteUser: cannot delete your own account", async () => {
    actor("ADMIN", "me@x.com");
    findByIdMock.mockResolvedValue({ id: 1, email: "me@x.com", role: "ADMIN" } as never);
    const res = await deleteUser(1);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteUser: cannot delete the last SUPERADMIN", async () => {
    actor("SUPERADMIN", "boss@x.com");
    findByIdMock.mockResolvedValue({ id: 2, email: "other@x.com", role: "SUPERADMIN" } as never);
    countSuperMock.mockResolvedValue(1 as never);
    const res = await deleteUser(2);
    expect((res as { type: string }).type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteUser: an ADMIN deletes a VIEWER", async () => {
    actor("ADMIN", "me@x.com");
    findByIdMock.mockResolvedValue({ id: 7, email: "v@x.com", role: "VIEWER" } as never);
    removeMock.mockResolvedValue({ id: 7 } as never);
    const res = await deleteUser(7);
    expect((res as { type: string }).type).toBe("success");
    expect(removeMock).toHaveBeenCalledWith(7);
  });

  // Equipment.ownerId and EquipmentLoan.borrowerId (OPEN loans) are both
  // onDelete: Restrict (migration 20260918120000) — without this check,
  // deleting either case would fail at the database with a generic 23503.
  describe("deleteUser: equipment/loan ownership blockers", () => {
    it("refuses deleting a user who still owns equipment", async () => {
      actor("ADMIN", "me@x.com");
      findByIdMock.mockResolvedValue({ id: 7, email: "v@x.com", role: "VIEWER" } as never);
      countOwnershipBlockersMock.mockResolvedValue({ equipmentCount: 2, openLoanCount: 0 });

      const res = await deleteUser(7);

      expect((res as { type: string }).type).toBe("error");
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("refuses deleting a user who currently holds an OPEN loan as a borrower", async () => {
      actor("ADMIN", "me@x.com");
      findByIdMock.mockResolvedValue({ id: 7, email: "v@x.com", role: "VIEWER" } as never);
      countOwnershipBlockersMock.mockResolvedValue({ equipmentCount: 0, openLoanCount: 1 });

      const res = await deleteUser(7);

      expect((res as { type: string }).type).toBe("error");
      expect(removeMock).not.toHaveBeenCalled();
    });

    // Point 13 (revue "Prêts"): renamed — `remove` is mocked here, so this
    // only proves deleteUser calls it once a user's only loans are closed,
    // not what remove() itself does with them. The purge of those closed
    // loans, inside the same transaction as the delete, is
    // repository/users.ts::remove's own concern, unverified by this
    // action-level test (which never touches the real repository).
    it("deletes a user whose only loans are CLOSED, calling remove() once the ownership check clears", async () => {
      actor("ADMIN", "me@x.com");
      findByIdMock.mockResolvedValue({ id: 7, email: "v@x.com", role: "VIEWER" } as never);
      countOwnershipBlockersMock.mockResolvedValue({ equipmentCount: 0, openLoanCount: 0 });
      removeMock.mockResolvedValue({ id: 7 } as never);

      const res = await deleteUser(7);

      expect((res as { type: string }).type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(7);
    });
  });
});
