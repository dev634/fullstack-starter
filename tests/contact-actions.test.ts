import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn().mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null }),
  canReachProject: () => true,
  projectIdFilter: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/repository/contacts", () => ({
  create: vi.fn(),
  update: vi.fn(),
  setPrimary: vi.fn(),
  remove: vi.fn(),
  setContactProjects: vi.fn(),
  findLinkedProjectIds: vi.fn().mockResolvedValue([]),
  findById: vi.fn().mockResolvedValue({ id: 1, clientId: 1 }),
}));
// requireClientAccess now also reads the company's trash state (lib/access.ts):
// a live company, everything else real.
vi.mock("@/repository/clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/repository/clients")>()),
  findTrashState: vi.fn().mockResolvedValue({ inTrash: false }),
}));
// A restricted caller reaches a company through hasProjectAmong.
vi.mock("@/repository/projects", () => ({ hasProjectAmong: vi.fn().mockResolvedValue(true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addContact, editContact, setPrimaryContact, deleteContact } from "@/actions/contacts/contacts";
import { requireRole } from "@/lib/authz";
import { create, update, setPrimary, remove, findLinkedProjectIds, setContactProjects, findById as findContactById } from "@/repository/contacts";
import { hasProjectAmong } from "@/repository/projects";
import { findTrashState } from "@/repository/clients";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import fr from "@/lib/i18n/dictionaries/fr";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const setPrimaryMock = vi.mocked(setPrimary);
const removeMock = vi.mocked(remove);
const findLinkedMock = vi.mocked(findLinkedProjectIds);
const initial = { type: null, message: "" } as const;

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("contact actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("addContact refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await addContact(initial, formOf({ clientId: "1", firstName: "Jean", lastName: "Dupont" }));
    expect(res.type).toBe("error");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addContact rejects a missing name with a zod error", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    const res = await addContact(initial, formOf({ clientId: "1", firstName: "", lastName: "" }));
    expect(res.type).toBe("zodError");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("addContact creates the contact on success", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    createMock.mockResolvedValue({ id: 5 } as never);
    const res = await addContact(
      initial,
      formOf({ clientId: "1", firstName: "Jean", lastName: "Dupont", email: "j@d.com", phone: "0600", role: "Gérant" })
    );
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: 1, firstName: "Jean", lastName: "Dupont" }));
    expect(res.type).toBe("success");
  });

  it("editContact updates on success", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    updateMock.mockResolvedValue({ id: 5 } as never);
    const res = await editContact(initial, formOf({ id: "5", clientId: "1", firstName: "Jeanne", lastName: "Dupont" }));
    expect(updateMock).toHaveBeenCalledWith(5, expect.objectContaining({ firstName: "Jeanne" }));
    expect(res.type).toBe("success");
  });

  it("setPrimaryContact refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await setPrimaryContact(5, 1);
    expect(res.type).toBe("error");
    expect(setPrimaryMock).not.toHaveBeenCalled();
  });

  it("setPrimaryContact sets the primary, scoped to the client", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    setPrimaryMock.mockResolvedValue([] as never);
    const res = await setPrimaryContact(5, 1);
    expect(setPrimaryMock).toHaveBeenCalledWith(5, 1);
    expect(res.type).toBe("success");
  });

  it("deleteContact refuses a non-ADMIN session", async () => {
    requireRoleMock.mockResolvedValue({ error: { type: "error", message: "Forbidden." } });
    const res = await deleteContact(5, 1);
    expect(res.type).toBe("error");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("deleteContact removes the contact when authorized", async () => {
    requireRoleMock.mockResolvedValue({ error: null, email: "admin@example.com" });
    removeMock.mockResolvedValue({ id: 5 } as never);
    const res = await deleteContact(5, 1);
    expect(removeMock).toHaveBeenCalledWith(5);
    expect(res.type).toBe("success");
  });

  // F11: a contact of a company the caller cannot reach answers like an
  // absent contact — never "forbidden". A company IN THE TRASH, for a caller
  // who does reach it, says so (see "trashed company" below).
  describe("existence is not an oracle (F11)", () => {
    const edited = () => formOf({ id: "1", clientId: "1", firstName: "Jean", lastName: "Dupont" });
    afterEach(() => {
      vi.mocked(getAccessContext).mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null });
      vi.mocked(hasProjectAmong).mockResolvedValue(true);
    });

    it("editContact, setPrimaryContact and deleteContact: out of scope === absent", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
      vi.mocked(getAccessContext).mockResolvedValue({ email: "t@example.com", role: "EDITOR", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: new Set([10]) } as never);
      vi.mocked(hasProjectAmong).mockResolvedValue(false);
      const outOfScope = [await editContact(initial, edited()), await setPrimaryContact(5, 1), await deleteContact(5, 1)];

      vi.mocked(findContactById).mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never).mockResolvedValueOnce(null as never);
      const absent = [await editContact(initial, edited()), await setPrimaryContact(5, 1), await deleteContact(5, 1)];

      for (let i = 0; i < 3; i++) {
        expect(outOfScope[i].message).toBe(fr.contacts.messages.invalidId);
        expect(absent[i].message).toBe(outOfScope[i].message);
      }
      expect(updateMock).not.toHaveBeenCalled();
      expect(setPrimaryMock).not.toHaveBeenCalled();
      expect(removeMock).not.toHaveBeenCalled();
    });

    // The refusal tells a caller who is INSIDE the scope that the company is in
    // the trash (the actionable answer: restore it) instead of "invalid id",
    // which would send them looking for a typo. Out of scope stays masked
    // (previous test). This used to be asserted as invalidId.
    it("trashed company: editContact, setPrimaryContact and deleteContact say it is in the trash", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
      vi.mocked(findTrashState).mockResolvedValue({ inTrash: true });
      const res = [await editContact(initial, edited()), await setPrimaryContact(5, 1), await deleteContact(5, 1)];
      vi.mocked(findTrashState).mockResolvedValue({ inTrash: false });
      for (const r of res) expect(r.message).toBe(fr.errors.inTrash);
      expect(updateMock).not.toHaveBeenCalled();
      expect(setPrimaryMock).not.toHaveBeenCalled();
      expect(removeMock).not.toHaveBeenCalled();
    });

    // A contact that vanished between the two reads has NO links, which is not
    // "no links to lose": null must refuse, not authorize.
    it("deleteContact refuses a contact whose links cannot be read (gone since it was resolved)", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
      vi.mocked(getAccessContext).mockResolvedValue({ email: "t@example.com", role: "EDITOR", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: new Set([10]) } as never);
      findLinkedMock.mockResolvedValue(null);
      const res = await deleteContact(5, 1);
      expect(res).toEqual({ type: "error", message: fr.contacts.messages.invalidId });
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("editContact only touches the portal links the caller can edit (scope passed down)", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
      vi.mocked(getAccessContext).mockResolvedValue({ email: "t@example.com", role: "EDITOR", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: new Set([10]) } as never);
      vi.mocked(projectIdFilter).mockReturnValue([10]);
      updateMock.mockResolvedValue({ id: 1 } as never);
      const fd = edited();
      fd.append("projectIds", "10");
      fd.append("projectIds", "99");
      await editContact(initial, fd);
      vi.mocked(projectIdFilter).mockReturnValue(undefined);
      expect(vi.mocked(setContactProjects)).toHaveBeenCalledWith(1, [10, 99], [10]);
    });

    // Lot 5a, point 4: the portal shows the content of the `projects` rubrique,
    // so linking projects to a contact is a way of exposing them.
    describe("editContact, a caller whose function hides the projects rubrique", () => {
      afterEach(() => {
        vi.mocked(getAccessContext).mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null });
      });
      it("updates the contact's own fields but leaves the links UNCHANGED (absent, not emptied)", async () => {
        requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
        vi.mocked(getAccessContext).mockResolvedValue({ email: "a@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(["projects"]), projectIds: null } as never);
        updateMock.mockResolvedValue({ id: 1 } as never);
        const fd = edited();
        fd.append("projectIds", "10");
        const res = await editContact(initial, fd);
        expect(res.type).toBe("success");
        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(vi.mocked(setContactProjects)).not.toHaveBeenCalled();
        // The form of such a caller sends no checkbox at all: an empty set must not wipe the links either.
        await editContact(initial, edited());
        expect(vi.mocked(setContactProjects)).not.toHaveBeenCalled();
      });
      it("a caller who reaches projects (same context otherwise) still writes the links", async () => {
        requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
        vi.mocked(getAccessContext).mockResolvedValue({ email: "a@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(["loans"]), projectIds: null } as never);
        updateMock.mockResolvedValue({ id: 1 } as never);
        await editContact(initial, edited());
        expect(vi.mocked(setContactProjects)).toHaveBeenCalledTimes(1);
      });
    });
  });

  // Deleting a contact also deletes its CLIENT portal login, cutting the
  // client's access to every linked project: a restricted caller may only do
  // it when ALL the links are inside its own scope.
  describe("deleteContact, restricted caller", () => {
    function restrictTo(ids: number[]) {
      vi.mocked(getAccessContext).mockResolvedValue({ email: "t@example.com", role: "EDITOR", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: new Set(ids) } as never);
      vi.mocked(projectIdFilter).mockReturnValue(ids);
    }
    afterEach(() => {
      vi.mocked(getAccessContext).mockResolvedValue({ email: "test@example.com", role: "ADMIN", hiddenSections: new Set(), hiddenAreas: new Set(), projectIds: null });
      vi.mocked(projectIdFilter).mockReturnValue(undefined);
    });

    it("refuses, deleting nothing, when a link is outside the scope — same answer as an absent contact", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
      restrictTo([10]);
      findLinkedMock.mockResolvedValue([10, 99]);
      const res = await deleteContact(5, 1);
      expect(findLinkedMock).toHaveBeenCalledWith(5);
      expect(res).toEqual({ type: "error", message: fr.contacts.messages.invalidId });
      expect(removeMock).not.toHaveBeenCalled();
    });

    it("deletes when every link (or no link at all) is inside the scope", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "e@example.com" });
      restrictTo([10]);
      findLinkedMock.mockResolvedValue([10]);
      removeMock.mockResolvedValue({ id: 5 } as never);
      expect((await deleteContact(5, 1)).type).toBe("success");
      expect(removeMock).toHaveBeenCalledWith(5);
    });

    it("an unrestricted caller never asks", async () => {
      requireRoleMock.mockResolvedValue({ error: null, email: "a@example.com" });
      removeMock.mockResolvedValue({ id: 5 } as never);
      await deleteContact(5, 1);
      expect(findLinkedMock).not.toHaveBeenCalled();
    });
  });
});
