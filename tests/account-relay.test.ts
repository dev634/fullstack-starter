import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock("@/repository/users", () => ({
  create: vi.fn(),
  updateProfile: vi.fn(),
  remove: vi.fn(),
  findById: vi.fn(),
  countSuperadmins: vi.fn(),
  findAccessScopeByEmail: vi.fn(),
  countOwnershipBlockers: vi.fn(),
  setUserProjects: vi.fn(),
  findAccountJobFunctionByEmail: vi.fn(),
  countPrivilegedHolders: vi.fn(),
  countHolders: vi.fn(),
}));
vi.mock("@/repository/jobFunctions", () => ({
  create: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  updateConfig: vi.fn(),
  findHiddenAreasById: vi.fn(),
  isGuardRefusal: (e: unknown) => !!e && typeof e === "object" && (e as { type?: string }).type === "guardRefused",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

import { addUser, updateUser, deleteUser, setUserProjectAssignments } from "@/actions/users/users";
import { saveFunctionConfig, deleteJobFunction } from "@/actions/jobFunctions/jobFunctions";
import { auth } from "@/lib/auth";
import * as users from "@/repository/users";
import * as functions from "@/repository/jobFunctions";
import fr from "@/lib/i18n/dictionaries/fr";
import type { AppAreaKey } from "@/lib/appAreas";

const initial = { type: null, message: "" } as const;
const ACTOR_FUNCTION = 5;
// The restricted ADMIN's own function (5) hides "clients.contacts". 6 hides
// MORE (the parent "clients" covers its sub-part, plus "loans"), 7 hides LESS
// (a different rubrique), 8 hides nothing.
const FUNCTION_AREAS: Record<number, AppAreaKey[]> = {
  5: ["clients.contacts"],
  6: ["clients", "loans"],
  7: ["loans"],
  8: [],
};

function actor(role: "SUPERADMIN" | "ADMIN", hiddenAreas: AppAreaKey[]) {
  vi.mocked(auth).mockResolvedValue({ user: { role, email: "me@x.com" } } as never);
  vi.mocked(users.findAccessScopeByEmail).mockResolvedValue({
    hiddenSections: [],
    hiddenAreas,
    projectScope: "ALL",
    assignedProjectIds: [],
  });
}
const restricted = () => actor("ADMIN", ["clients.contacts"]);
const unrestrictedAdmin = () => actor("ADMIN", []);
const superadmin = () => actor("SUPERADMIN", []);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
function target(fields: { id: number; role: string; jobFunctionId?: number | null }) {
  vi.mocked(users.findById).mockResolvedValue({ email: `u${fields.id}@x.com`, name: "N", jobFunctionId: null, ...fields } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(users.countOwnershipBlockers).mockResolvedValue({ equipmentCount: 0, openLoanCount: 0 });
  vi.mocked(users.countPrivilegedHolders).mockResolvedValue(0);
  vi.mocked(users.countHolders).mockResolvedValue(0);
  vi.mocked(users.create).mockResolvedValue({ id: 50 } as never);
  vi.mocked(users.updateProfile).mockResolvedValue({ id: 7 } as never);
  vi.mocked(users.remove).mockResolvedValue({ id: 7 } as never);
  vi.mocked(users.findAccountJobFunctionByEmail).mockResolvedValue({ jobFunctionId: ACTOR_FUNCTION });
  vi.mocked(functions.findHiddenAreasById).mockImplementation(async (id) => FUNCTION_AREAS[id] ?? []);
});

const REFUSED = fr.users.messages.restrictedAdminAccount;
const type = (r: unknown) => (r as { type: string }).type;
const message = (r: unknown) => (r as { message: string }).message;

describe("relay account: an ADMIN restricted by their function (lot 5a)", () => {
  describe("(a) addUser without a function", () => {
    const fields = { email: "e@x.com", name: "E", role: "EDITOR", password: "password123" };
    it("refused to a restricted ADMIN", async () => {
      restricted();
      const res = await addUser(initial, form(fields));
      expect(res.message).toBe(REFUSED);
      expect(users.create).not.toHaveBeenCalled();
    });
    it.each([["an unrestricted ADMIN", unrestrictedAdmin], ["a SUPERADMIN", superadmin]])("allowed to %s", async (_n, as) => {
      as();
      expect((await addUser(initial, form(fields))).type).toBe("success");
      expect(users.create).toHaveBeenCalled();
    });
  });

  describe("(b) addUser with a function", () => {
    const base = { email: "e@x.com", name: "E", role: "VIEWER", password: "password123" };
    it("refused when it hides LESS than the actor (a different rubrique, or none)", async () => {
      restricted();
      for (const jobFunctionId of ["7", "8"]) {
        expect((await addUser(initial, form({ ...base, jobFunctionId }))).message).toBe(REFUSED);
      }
      expect(users.create).not.toHaveBeenCalled();
    });
    it("allowed when it hides the same or more (equal, parent covers child)", async () => {
      restricted();
      expect((await addUser(initial, form({ ...base, jobFunctionId: "5" }))).type).toBe("success");
      expect((await addUser(initial, form({ ...base, jobFunctionId: "6" }))).type).toBe("success");
    });
    it("allowed to an unrestricted ADMIN and a SUPERADMIN, whatever the function", async () => {
      unrestrictedAdmin();
      expect((await addUser(initial, form({ ...base, jobFunctionId: "8" }))).type).toBe("success");
      superadmin();
      expect((await addUser(initial, form({ ...base, jobFunctionId: "7" }))).type).toBe("success");
    });
  });

  describe("(c) updateUser on an existing account", () => {
    it("refused: an EDITOR already without function (password, name, role: any field)", async () => {
      restricted();
      target({ id: 7, role: "EDITOR", jobFunctionId: null });
      const res = await updateUser(initial, form({ id: "7", role: "EDITOR", password: "newpassword1" }));
      expect(res.message).toBe(REFUSED);
      const renamed = await updateUser(initial, form({ id: "7", role: "VIEWER", name: "X" }));
      expect(renamed.message).toBe(REFUSED);
      expect(users.updateProfile).not.toHaveBeenCalled();
    });
    it("refused: an account whose function hides less", async () => {
      restricted();
      target({ id: 7, role: "EDITOR", jobFunctionId: 7 });
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR" }))).message).toBe(REFUSED);
    });
    it("refused: clearing or repointing a covered account to a function that hides less", async () => {
      restricted();
      target({ id: 7, role: "EDITOR", jobFunctionId: 6 });
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR", jobFunctionId: "" }))).message).toBe(REFUSED);
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR", jobFunctionId: "7" }))).message).toBe(REFUSED);
      expect(users.updateProfile).not.toHaveBeenCalled();
    });
    it("allowed: a covered account, kept or moved to another covering function (legitimate)", async () => {
      restricted();
      target({ id: 7, role: "EDITOR", jobFunctionId: 6 });
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR", name: "Z", password: "newpassword1" }))).type).toBe("success");
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR", jobFunctionId: "5" }))).type).toBe("success");
    });
    it("allowed to an unrestricted ADMIN and a SUPERADMIN on an account without function", async () => {
      for (const as of [unrestrictedAdmin, superadmin]) {
        as();
        target({ id: 7, role: "EDITOR", jobFunctionId: null });
        expect((await updateUser(initial, form({ id: "7", role: "EDITOR", jobFunctionId: "7", password: "newpassword1" }))).type).toBe("success");
      }
    });
    it("a restricted ADMIN still edits their OWN name and password", async () => {
      restricted();
      vi.mocked(users.findById).mockResolvedValue({ id: 1, email: "me@x.com", name: "Me", role: "ADMIN", jobFunctionId: ACTOR_FUNCTION });
      const res = await updateUser(initial, form({ id: "1", role: "ADMIN", name: "Me2", password: "newpassword1" }));
      expect(res.type).toBe("success");
    });
  });

  describe("(d) a portal login is never promoted (for everyone)", () => {
    it.each([
      ["a restricted ADMIN", restricted],
      ["an unrestricted ADMIN", unrestrictedAdmin],
      ["a SUPERADMIN", superadmin],
    ])("%s cannot change the role of a CLIENT; answered like an absent account", async (_n, as) => {
      as();
      target({ id: 9, role: "CLIENT" });
      const res = await updateUser(initial, form({ id: "9", role: "EDITOR" }));
      expect(res.type).toBe("error");
      expect(res.message).toBe(fr.errors.invalidId);
      expect(users.updateProfile).not.toHaveBeenCalled();
    });
    it.each([["an unrestricted ADMIN", unrestrictedAdmin], ["a SUPERADMIN", superadmin]])(
      "%s can still change an EDITOR, but never a CLIENT (even name or password while it stays CLIENT)",
      async (_n, as) => {
        as();
        target({ id: 7, role: "EDITOR" });
        expect((await updateUser(initial, form({ id: "7", role: "VIEWER" }))).type).toBe("success");
        vi.mocked(users.updateProfile).mockClear();
        target({ id: 9, role: "CLIENT" });
        const res = await updateUser(initial, form({ id: "9", role: "CLIENT", name: "C", password: "newpassword1" }));
        expect(res.message).toBe(fr.errors.invalidId);
        expect(users.updateProfile).not.toHaveBeenCalled();
      }
    );
    it("setUserProjectAssignments refuses a CLIENT, for a SUPERADMIN too", async () => {
      superadmin();
      target({ id: 9, role: "CLIENT" });
      const res = await setUserProjectAssignments(9, [1]);
      expect(message(res)).toBe(fr.errors.invalidId);
      expect(users.setUserProjects).not.toHaveBeenCalled();
    });
    it("deleteUser of a CLIENT stays allowed (cleanup)", async () => {
      unrestrictedAdmin();
      target({ id: 9, role: "CLIENT" });
      expect(type(await deleteUser(9))).toBe("success");
    });
    // (e) createPortalLogin -> reset link -> promotion is closed at the
    // promotion step (above), not in createPortalLogin: it only creates a CLIENT.
  });

  describe("deleteUser and setUserProjectAssignments", () => {
    it("refused on an account whose function hides less (or none)", async () => {
      restricted();
      target({ id: 7, role: "EDITOR", jobFunctionId: null });
      expect(message(await deleteUser(7))).toBe(REFUSED);
      expect(message(await setUserProjectAssignments(7, [1]))).toBe(REFUSED);
      expect(users.remove).not.toHaveBeenCalled();
      expect(users.setUserProjects).not.toHaveBeenCalled();
    });
    it("allowed on a covered account; allowed to an unrestricted ADMIN on any", async () => {
      restricted();
      target({ id: 7, role: "EDITOR", jobFunctionId: 6 });
      expect(type(await deleteUser(7))).toBe("success");
      expect(type(await setUserProjectAssignments(7, [1]))).toBe("success");
      unrestrictedAdmin();
      target({ id: 7, role: "EDITOR", jobFunctionId: null });
      expect(type(await deleteUser(7))).toBe("success");
    });
  });

  describe("(f) deleteJobFunction of a function held by accounts", () => {
    it("refused to a restricted ADMIN when someone (an EDITOR) holds it", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(2);
      const res = await deleteJobFunction(6);
      expect(message(res)).toBe(fr.jobFunctions.messages.restrictedCannotDeleteHeld);
      expect(functions.remove).not.toHaveBeenCalled();
    });
    it("allowed to a restricted ADMIN when nobody holds it", async () => {
      restricted();
      vi.mocked(functions.remove).mockResolvedValue({ id: 6 } as never);
      expect(type(await deleteJobFunction(6))).toBe("success");
    });
    it.each([["an unrestricted ADMIN", unrestrictedAdmin], ["a SUPERADMIN", superadmin]])("allowed to %s even when held", async (_n, as) => {
      as();
      vi.mocked(users.countHolders).mockResolvedValue(2);
      vi.mocked(functions.remove).mockResolvedValue({ id: 6 } as never);
      expect(type(await deleteJobFunction(6))).toBe("success");
    });
  });

  describe("(g) saveFunctionConfig on a function held by accounts", () => {
    const config = (hiddenAreas: string[]) => ({ hiddenSections: [], hiddenAreas, projectScope: "ALL" });
    it("refused to a restricted ADMIN when the resulting areas no longer cover theirs", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(1);
      for (const areas of [[], ["loans"], ["clients.info"]]) {
        expect(message(await saveFunctionConfig(6, config(areas)))).toBe(fr.jobFunctions.messages.restrictedCannotLiftHeld);
      }
      expect(functions.updateConfig).not.toHaveBeenCalled();
    });
    it("allowed to a restricted ADMIN when it still covers theirs (equal, parent, more)", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(1);
      for (const areas of [["clients.contacts"], ["clients"], ["clients", "loans"]]) {
        expect(type(await saveFunctionConfig(6, config(areas)))).toBe("success");
      }
    });
    it("allowed to a restricted ADMIN on a function nobody holds, whatever it hides", async () => {
      restricted();
      expect(type(await saveFunctionConfig(6, config([])))).toBe("success");
    });
    it.each([["an unrestricted ADMIN", unrestrictedAdmin], ["a SUPERADMIN", superadmin]])("allowed to %s even when held", async (_n, as) => {
      as();
      vi.mocked(users.countHolders).mockResolvedValue(1);
      expect(type(await saveFunctionConfig(6, config([])))).toBe("success");
    });
  });
});

describe("relay account, lot 5a arbitration", () => {
  const config = (hiddenAreas: string[]) => ({ hiddenSections: ["tasks"], hiddenAreas, projectScope: "ALL" });
  const guardOf = (mock: unknown, index: number) => vi.mocked(mock as (...a: never[]) => unknown).mock.calls[0]?.[index] as
    | ((state: { hiddenAreas: AppAreaKey[]; holders: number; privilegedHolders: number }) => string | null)
    | null;

  describe("point 2 — the admin.* rubriques do not count", () => {
    it("an ADMIN whose function hides only admin.functions and admin.settings manages their team as before", async () => {
      actor("ADMIN", ["admin.functions", "admin.settings"]);
      const fields = { email: "e@x.com", name: "E", role: "EDITOR", password: "password123" };
      expect((await addUser(initial, form(fields))).type).toBe("success");
      target({ id: 7, role: "EDITOR", jobFunctionId: null });
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR", password: "newpassword1" }))).type).toBe("success");
    });
  });

  describe("point 3 — monotone rule on a held function", () => {
    it("a held function that covers NOTHING of the actor's: sections retouched, deleted — allowed", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(3);
      // 7 hides "loans" only; the actor hides clients.contacts.
      expect(type(await saveFunctionConfig(7, config(["loans"])))).toBe("success");
      expect(type(await saveFunctionConfig(7, config([])))).toBe("success");
      vi.mocked(functions.remove).mockResolvedValue({ id: 7 } as never);
      expect(type(await deleteJobFunction(7))).toBe("success");
      // 8 hides nothing at all: the degenerate row.
      expect(type(await saveFunctionConfig(8, config([])))).toBe("success");
      expect(type(await deleteJobFunction(8))).toBe("success");
    });
    it("a held function that covers the actor's: retouching its sections only (same areas) stays allowed", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(3);
      expect(type(await saveFunctionConfig(6, config(["clients", "loans"])))).toBe("success");
    });
    it("the refusal is the same for a function that covers the actor's, deleted", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(3);
      expect(message(await deleteJobFunction(6))).toBe(fr.jobFunctions.messages.restrictedCannotDeleteHeld);
    });
  });

  describe("point 1 — the authoritative check runs in the repository's transaction", () => {
    it("hands the repository a guard that refuses on the LOCKED state, even when the early check passed", async () => {
      restricted();
      // Early reads: nobody holds function 6, so the early check lets it through...
      vi.mocked(users.countHolders).mockResolvedValue(0);
      vi.mocked(functions.updateConfig).mockImplementation(async (_id, _cfg, guard) => {
        // ...but by the time the row is locked, an account has taken it.
        const reason = guard?.({ hiddenAreas: ["clients"], holders: 1, privilegedHolders: 0 }) ?? null;
        if (reason) throw { type: "guardRefused", reason };
        return {} as never;
      });
      const res = await saveFunctionConfig(6, config([]));
      expect(message(res)).toBe(fr.jobFunctions.messages.restrictedCannotLiftHeld);
      expect(guardOf(functions.updateConfig, 2)).toBeTypeOf("function");
    });
    it("deleteJobFunction: same, with the deletion message", async () => {
      restricted();
      vi.mocked(users.countHolders).mockResolvedValue(0);
      vi.mocked(functions.remove).mockImplementation(async (_id, guard) => {
        const reason = guard?.({ hiddenAreas: ["clients"], holders: 1, privilegedHolders: 0 }) ?? null;
        if (reason) throw { type: "guardRefused", reason };
        return {} as never;
      });
      expect(message(await deleteJobFunction(6))).toBe(fr.jobFunctions.messages.restrictedCannotDeleteHeld);
    });
    it("addUser and updateUser hand the repository a relay predicate for a restricted ADMIN, none for the others", async () => {
      restricted();
      await addUser(initial, form({ email: "e@x.com", name: "E", role: "VIEWER", password: "password123", jobFunctionId: "5" }));
      const relay = vi.mocked(users.create).mock.calls[0]?.[1];
      expect(relay).toBeTypeOf("function");
      expect(relay?.(["clients"])).toBe(true);
      expect(relay?.(["loans"])).toBe(false);
      expect(relay?.([])).toBe(false);
      vi.clearAllMocks();
      unrestrictedAdmin();
      await addUser(initial, form({ email: "e@x.com", name: "E", role: "VIEWER", password: "password123" }));
      expect(vi.mocked(users.create).mock.calls[0]?.[1]).toBeNull();
    });
    it("a refusal thrown by the transaction is answered like the early one", async () => {
      restricted();
      vi.mocked(users.create).mockRejectedValue({ type: "guardRefused", reason: "relay" });
      const res = await addUser(initial, form({ email: "e@x.com", name: "E", role: "VIEWER", password: "password123", jobFunctionId: "5" }));
      expect(res.message).toBe(REFUSED);
      target({ id: 7, role: "EDITOR", jobFunctionId: 5 });
      vi.mocked(users.updateProfile).mockRejectedValue({ type: "guardRefused", reason: "relay" });
      expect((await updateUser(initial, form({ id: "7", role: "EDITOR", password: "newpassword1" }))).message).toBe(REFUSED);
    });
  });
});
