import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// Same surface as tests/user-actions.test.ts: every repository function the
// actions call, directly or through the access context.
vi.mock("@/repository/users", () => ({
  create: vi.fn(),
  updateProfile: vi.fn(),
  remove: vi.fn(),
  findById: vi.fn(),
  countSuperadmins: vi.fn(),
  updatePassword: vi.fn(),
  findAccessScopeByEmail: vi.fn(),
  countOwnershipBlockers: vi.fn(),
  setUserProjects: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { addUser, updateUser, deleteUser, setUserProjectAssignments } from "@/actions/users/users";
import { auth } from "@/lib/auth";
import {
  create,
  updateProfile,
  updatePassword,
  remove,
  findById,
  countOwnershipBlockers,
  findAccessScopeByEmail,
  setUserProjects,
} from "@/repository/users";
import fr from "@/lib/i18n/dictionaries/fr";
import { accountWithoutFunction } from "./helpers/accessFixtures";

const authMock = vi.mocked(auth);
const createMock = vi.mocked(create);
const updateProfileMock = vi.mocked(updateProfile);
const updatePasswordMock = vi.mocked(updatePassword);
const removeMock = vi.mocked(remove);
const findByIdMock = vi.mocked(findById);
const setUserProjectsMock = vi.mocked(setUserProjects);
const initial = { type: null, message: "" } as const;

function actor(role: string, email = `${role.toLowerCase()}@x.com`) {
  authMock.mockResolvedValue({ user: { role, email } } as never);
}
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
function target(fields: { id: number; email: string; role: string; jobFunctionId?: number | null; name?: string }) {
  findByIdMock.mockResolvedValue({ jobFunctionId: null, name: "Name", ...fields } as never);
}

// Lot 1, F2: everything that touches an ADMIN or SUPERADMIN account goes
// through a SUPERADMIN. A restricted ADMIN could otherwise mint a free ADMIN
// (no function, so no restriction) or take over another one. Both directions:
// what is refused AND what an ADMIN can still do.
describe("accounts of rank ADMIN and above need a SUPERADMIN (lot 1, F2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(countOwnershipBlockers).mockResolvedValue({ equipmentCount: 0, openLoanCount: 0 });
    vi.mocked(findAccessScopeByEmail).mockResolvedValue(accountWithoutFunction());
  });

  describe("addUser", () => {
    it("an ADMIN cannot create an ADMIN, with the dedicated message", async () => {
      actor("ADMIN");
      const res = await addUser(initial, form({ email: "a@x.com", name: "A", role: "ADMIN", password: "password123" }));
      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.users.messages.adminRequiresSuperadmin);
      expect(createMock).not.toHaveBeenCalled();
    });

    it("an ADMIN creating a SUPERADMIN is told it outranks them", async () => {
      actor("ADMIN");
      const res = await addUser(initial, form({ email: "a@x.com", name: "A", role: "SUPERADMIN", password: "password123" }));
      expect(res.message).toBe(fr.users.messages.cannotAssignHigher);
      expect(createMock).not.toHaveBeenCalled();
    });

    // A portal login is only created from its contact (createPortalLogin).
    it.each([["ADMIN", "ADMIN" as const], ["SUPERADMIN", "SUPERADMIN" as const]])("%s cannot create a CLIENT here; answered invalidId, nothing written", async (_n, who) => {
      actor(who);
      const res = await addUser(initial, form({ email: "c@x.com", name: "C", role: "CLIENT", password: "password123" }));
      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.errors.invalidId);
      expect(createMock).not.toHaveBeenCalled();
    });

    it.each(["EDITOR", "VIEWER"])("an ADMIN can still create a %s", async (role) => {
      actor("ADMIN");
      createMock.mockResolvedValue({ id: 5 } as never);
      const res = await addUser(initial, form({ email: "e@x.com", name: "E", role, password: "password123" }));
      expect(res.type).toBe("success");
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ role }), null);
    });

    it.each(["ADMIN", "SUPERADMIN"])("a SUPERADMIN can create a %s", async (role) => {
      actor("SUPERADMIN");
      createMock.mockResolvedValue({ id: 5 } as never);
      const res = await addUser(initial, form({ email: "a@x.com", name: "A", role, password: "password123" }));
      expect(res.type).toBe("success");
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ role }), null);
    });
  });

  describe("updateUser", () => {
    it("an ADMIN cannot change another ADMIN password or name", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 8, email: "other-admin@x.com", role: "ADMIN" });

      const res = await updateUser(initial, form({ id: "8", name: "Hijacked", role: "ADMIN", password: "newpassword1" }));

      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.users.messages.adminRequiresSuperadmin);
      expect(updateProfileMock).not.toHaveBeenCalled();
      expect(updatePasswordMock).not.toHaveBeenCalled();
    });

    it("an ADMIN cannot promote an EDITOR to ADMIN", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 7, email: "ed@x.com", role: "EDITOR" });

      const res = await updateUser(initial, form({ id: "7", role: "ADMIN" }));

      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.users.messages.adminRequiresSuperadmin);
      expect(updateProfileMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still edit an EDITOR (name, password, role)", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 7, email: "ed@x.com", role: "EDITOR" });
      updateProfileMock.mockResolvedValue({ id: 7 } as never);

      const res = await updateUser(initial, form({ id: "7", name: "Ed2", role: "VIEWER", password: "newpassword1" }));

      expect(res.type).toBe("success");
      // The password rides in the SAME write as the profile (one transaction).
      expect(updateProfileMock).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Ed2", role: "VIEWER", password: "hashed" }), null);
      expect(updatePasswordMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can change their OWN name and password", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 1, email: "me@x.com", role: "ADMIN", jobFunctionId: 5 });
      updateProfileMock.mockResolvedValue({ id: 1 } as never);

      const res = await updateUser(
        initial,
        form({ id: "1", name: "Me Too", role: "ADMIN", jobFunctionId: "5", password: "newpassword1" })
      );

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: "Me Too", role: "ADMIN", jobFunctionId: 5, password: "hashed" }),
        null
      );
      expect(updatePasswordMock).not.toHaveBeenCalled();
    });

    it.each(["EDITOR", "SUPERADMIN"])("an ADMIN cannot change their OWN role to %s", async (role) => {
      actor("ADMIN", "me@x.com");
      target({ id: 1, email: "me@x.com", role: "ADMIN" });

      const res = await updateUser(initial, form({ id: "1", role }));

      expect(res.type).toBe("error");
      expect(updateProfileMock).not.toHaveBeenCalled();
    });

    it("a SUPERADMIN can modify an ADMIN: name, password and role", async () => {
      actor("SUPERADMIN", "boss@x.com");
      target({ id: 8, email: "adm@x.com", role: "ADMIN" });
      updateProfileMock.mockResolvedValue({ id: 8 } as never);

      const res = await updateUser(initial, form({ id: "8", name: "Adm2", role: "EDITOR", password: "newpassword1" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(8, expect.objectContaining({ name: "Adm2", role: "EDITOR" }), null);
    });
  });

  // "Absent" is not "empty": a payload that omits jobFunctionId used to write
  // NULL over the target function (and the own-function guard read the
  // omission as a change).
  describe("updateUser: a missing jobFunctionId keeps the current function", () => {
    it("keeps the function of another account", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 7, email: "ed@x.com", role: "EDITOR", jobFunctionId: 5 });
      updateProfileMock.mockResolvedValue({ id: 7 } as never);

      const res = await updateUser(initial, form({ id: "7", role: "EDITOR" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(7, expect.objectContaining({ jobFunctionId: 5 }), null);
    });

    it("an explicit empty string still clears it", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 7, email: "ed@x.com", role: "EDITOR", jobFunctionId: 5 });
      updateProfileMock.mockResolvedValue({ id: 7 } as never);

      const res = await updateUser(initial, form({ id: "7", role: "EDITOR", jobFunctionId: "" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(7, expect.objectContaining({ jobFunctionId: null }), null);
    });

    it("an ADMIN editing their own account without the field is not read as changing their function", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 1, email: "me@x.com", role: "ADMIN", jobFunctionId: 5 });
      updateProfileMock.mockResolvedValue({ id: 1 } as never);

      const res = await updateUser(initial, form({ id: "1", name: "Me2", role: "ADMIN" }));

      expect(res.type).toBe("success");
      expect(updateProfileMock).toHaveBeenCalledWith(1, expect.objectContaining({ jobFunctionId: 5 }), null);
    });

    it("an ADMIN own function still cannot be cleared with an explicit empty value", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 1, email: "me@x.com", role: "ADMIN", jobFunctionId: 5 });

      const res = await updateUser(initial, form({ id: "1", role: "ADMIN", jobFunctionId: "" }));

      expect(res.message).toBe(fr.users.messages.cannotEditOwnFunction);
      expect(updateProfileMock).not.toHaveBeenCalled();
    });
  });

  describe("deleteUser", () => {
    it("an ADMIN cannot delete another ADMIN", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 8, email: "adm@x.com", role: "ADMIN" });
      const res = await deleteUser(8);
      expect((res as { message: string }).message).toBe(fr.users.messages.adminRequiresSuperadmin);
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("a SUPERADMIN can delete an ADMIN", async () => {
      actor("SUPERADMIN", "boss@x.com");
      target({ id: 8, email: "adm@x.com", role: "ADMIN" });
      removeMock.mockResolvedValue({ id: 8 } as never);
      const res = await deleteUser(8);
      expect((res as { type: string }).type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(8);
    });

    it("an ADMIN can still delete an EDITOR", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 7, email: "ed@x.com", role: "EDITOR" });
      removeMock.mockResolvedValue({ id: 7 } as never);
      const res = await deleteUser(7);
      expect((res as { type: string }).type).toBe("success");
    });
  });

  describe("setUserProjectAssignments", () => {
    it("an ADMIN cannot reassign the projects of an ADMIN, not even their own", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 8, email: "adm@x.com", role: "ADMIN" });
      const other = await setUserProjectAssignments(8, [1]);
      target({ id: 1, email: "me@x.com", role: "ADMIN" });
      const self = await setUserProjectAssignments(1, [1]);

      expect((other as { message: string }).message).toBe(fr.users.messages.adminRequiresSuperadmin);
      expect((self as { type: string }).type).toBe("error");
      expect(setUserProjectsMock).not.toHaveBeenCalled();
    });

    it("an ADMIN can still assign projects to an EDITOR; a SUPERADMIN to an ADMIN", async () => {
      actor("ADMIN", "me@x.com");
      target({ id: 7, email: "ed@x.com", role: "EDITOR" });
      expect(((await setUserProjectAssignments(7, [1, 2])) as { type: string }).type).toBe("success");

      actor("SUPERADMIN", "boss@x.com");
      target({ id: 8, email: "adm@x.com", role: "ADMIN" });
      expect(((await setUserProjectAssignments(8, [3])) as { type: string }).type).toBe("success");
      expect(setUserProjectsMock).toHaveBeenCalledTimes(2);
    });
  });
});
