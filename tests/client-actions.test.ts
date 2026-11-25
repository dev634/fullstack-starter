import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the action's boundaries so we exercise the orchestration (auth guard,
// validation error mapping, delegation) without a DB, network or NextAuth.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/service/clients", () => ({ createClient: vi.fn() }));
vi.mock("@/repository/clients", () => ({
  findById: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  permanentlyRemove: vi.fn(),
  update: vi.fn(),
  isFullyInScope: vi.fn(),
  findFullyInScopeIds: vi.fn(),
  findTrashState: vi.fn().mockResolvedValue({ inTrash: false }),
}));
vi.mock("@/lib/cloudinary", () => ({
  uploadClientPhoto: vi.fn(),
  destroyClientPhoto: vi.fn(),
  destroyProjectFile: vi.fn(),
}));
vi.mock("@/repository/projectFiles", () => ({ findPublicIdsByClient: vi.fn() }));
vi.mock("@/repository/users", () => ({ findAccessScopeByEmail: vi.fn() }));
vi.mock("@/repository/projects", () => ({ hasProjectAmong: vi.fn(), findTrashState: vi.fn().mockResolvedValue({ selfTrashed: false, inTrash: false }), }));
vi.mock("@/repository/activity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }), APP_SETTINGS_TAG: "app-settings" }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addClient, updateClient, deleteClient, deleteClients, restoreClient, permanentlyDeleteClient } from "@/actions/clients/clients";
import { getClient } from "@/lib/loaders/clientLoader";
import { auth } from "@/lib/auth";
import { createClient } from "@/service/clients";
import { findById, softDelete, restore, permanentlyRemove, update, isFullyInScope, findFullyInScopeIds } from "@/repository/clients";
import { findPublicIdsByClient } from "@/repository/projectFiles";
import { findAccessScopeByEmail } from "@/repository/users";
import { hasProjectAmong } from "@/repository/projects";
import { destroyProjectFile } from "@/lib/cloudinary";
import { logActivity } from "@/repository/activity";
import { accountWithoutFunction } from "./helpers/accessFixtures";
import fr from "@/lib/i18n/dictionaries/fr";

const authMock = vi.mocked(auth);
const findAccessScopeByEmailMock = vi.mocked(findAccessScopeByEmail);
const hasProjectAmongMock = vi.mocked(hasProjectAmong);
const isFullyInScopeMock = vi.mocked(isFullyInScope);
const findFullyInScopeIdsMock = vi.mocked(findFullyInScopeIds);
const createClientMock = vi.mocked(createClient);
const findByIdMock = vi.mocked(findById);
const softDeleteMock = vi.mocked(softDelete);
const restoreMock = vi.mocked(restore);
const permanentlyRemoveMock = vi.mocked(permanentlyRemove);
const updateMock = vi.mocked(update);
const findPublicIdsByClientMock = vi.mocked(findPublicIdsByClient);
const destroyProjectFileMock = vi.mocked(destroyProjectFile);
const logActivityMock = vi.mocked(logActivity);
const initial = { type: null, message: "" } as const;

function formOf(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID_UPDATE_FIELDS = {
  id: "1",
  email: "alice@example.com",
  companyName: "Acme",
  address: "1 St",
  city: "NYC",
  zipCode: "10001",
  country: "US",
};

describe("client action auth guard + delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getAccessContext now resolves "account not found" (an unconfigured
    // mock resolves `undefined`) to DENIED rather than "unrestricted" — give
    // every ADMIN/EDITOR fixture here the scope of a real, existing account
    // with no job function (the legitimate default) unless a test below sets
    // its own scope.
    findAccessScopeByEmailMock.mockResolvedValue(accountWithoutFunction());
  });

  it("addClient refuses without a session", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await addClient(initial, new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("addClient delegates to the service when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    createClientMock.mockResolvedValue({ type: "success", message: "ok", id: 42 } as never);
    const res = await addClient(initial, new FormData());
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATED", clientId: 42, actorEmail: "admin@example.com" })
    );
  });

  it("addClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await addClient(initial, new FormData());
    expect(res.type).toBe("error");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  // Regression coverage for adversarial pass 2, point 1: updateClient used to
  // cast FormData straight to UpdateClientInput instead of parsing it —
  // updateClientSchema existed but nothing in the app imported it, so an
  // invalid email or blank required fields wrote straight to the database.
  it("updateClient rejects an invalid email with a zod error, without writing anything", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    const res = await updateClient(initial, formOf({ ...VALID_UPDATE_FIELDS, email: "not-an-email" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.email).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updateClient rejects a blank required field (companyName) with a zod error", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    const res = await updateClient(initial, formOf({ ...VALID_UPDATE_FIELDS, companyName: "" }));
    expect(res.type).toBe("zodError");
    expect(res.fieldsForm?.companyName).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updateClient coerces the hidden id field and updates the client when authorized", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, photoUrl: null } as never);
    updateMock.mockResolvedValue({ id: 1, companyName: "Acme" } as never);
    const res = await updateClient(initial, formOf(VALID_UPDATE_FIELDS));
    expect(res.type).toBe("success");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ id: 1, companyName: "Acme" }));
  });

  // Lot 5b — "absent is not empty": the action used to write `phone || null`
  // and the schema defaulted `status` to PROSPECT, so a payload that omitted
  // them erased the phone and demoted a CLIENT.
  it("updateClient: an omitted phone/website/status is left alone, a blank phone is cleared", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, photoUrl: null } as never);
    updateMock.mockResolvedValue({ id: 1, companyName: "Acme" } as never);
    await updateClient(initial, formOf({ id: "1", phone: "" }));
    const written = updateMock.mock.calls[0][0];
    expect(written.phone).toBeNull();
    expect(written.website).toBeUndefined();
    expect(written.status).toBeUndefined();
    expect(written.companyName).toBeUndefined();
  });

  it("deleteClient refuses without a session", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await deleteClient(1);
    expect((res as { type: string }).type).toBe("error");
    expect(softDeleteMock).not.toHaveBeenCalled();
  });

  it("deleteClient soft-deletes the client when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, companyName: "Sunrise Corporation" } as never);
    softDeleteMock.mockResolvedValue({ id: 1, deletedAt: new Date() } as never);
    await deleteClient(1);
    expect(softDeleteMock).toHaveBeenCalledWith(1);
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETED", clientId: 1, clientName: "Sunrise Corporation" })
    );
  });

  // F10: trashing a company already in the trash would re-date deletedAt (the
  // trash is ordered by it) and journal a second DELETED.
  it("deleteClient refuses a company already in the trash (no re-date, no second DELETED)", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, companyName: "Acme", deletedAt: new Date() } as never);
    const res = await deleteClient(1);
    expect(res).toEqual({ type: "error", message: fr.errors.inTrash });
    expect(softDeleteMock).not.toHaveBeenCalled();
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it("deleteClients skips a company already in the trash, counting it among the ignored", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockImplementation((async (id: number) =>
      id === 1 ? { id, companyName: "Live", deletedAt: null } : { id, companyName: "Gone", deletedAt: new Date() }) as never);
    softDeleteMock.mockResolvedValue({ id: 1 } as never);
    const res = await deleteClients([1, 2]);
    expect(softDeleteMock).toHaveBeenCalledTimes(1);
    expect(softDeleteMock).toHaveBeenCalledWith(1);
    expect(res.message).toBe(
      fr.clients.messages.deletedBulkSkipped.replace("{count}", "1").replace("{skipped}", "1")
    );
  });

  it("deleteClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await deleteClient(1);
    expect((res as { type: string }).type).toBe("error");
    expect(softDeleteMock).not.toHaveBeenCalled();
  });

  // Adversarial pass 2, point 7: deleteClients took a raw number[] with no
  // cap — four repository round trips per id in a loop. The grid it's
  // called from only ever selects a single page (9 rows), so a real
  // selection is nowhere near the cap.
  it("deleteClients rejects a selection over MAX_BULK_DELETE_IDS without deleting anything", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = await deleteClients(ids);
    expect(res.type).toBe("error");
    expect(softDeleteMock).not.toHaveBeenCalled();
  });

  it("deleteClients deletes a normal-sized selection when authorized", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, companyName: "Sunrise Corporation" } as never);
    softDeleteMock.mockResolvedValue({ id: 1, deletedAt: new Date() } as never);
    const res = await deleteClients([1, 2, 3]);
    expect(res.type).toBe("success");
    expect(softDeleteMock).toHaveBeenCalledTimes(3);
  });

  it("restoreClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await restoreClient(1);
    expect(res.type).toBe("error");
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("restoreClient restores the client when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, deletedAt: new Date(), companyName: "Sunrise Corporation" } as never);
    restoreMock.mockResolvedValue({ id: 1, deletedAt: null, companyName: "Sunrise Corporation" } as never);
    const res = await restoreClient(1);
    expect(restoreMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RESTORED", clientId: 1 })
    );
  });

  it("permanentlyDeleteClient refuses a VIEWER session", async () => {
    authMock.mockResolvedValue({ user: { role: "VIEWER" } } as never);
    const res = await permanentlyDeleteClient(1);
    expect(res.type).toBe("error");
    expect(permanentlyRemoveMock).not.toHaveBeenCalled();
  });

  // Project.client is onDelete: Cascade: destroying a company destroys its
  // chantiers, so hiding only the `projects` rubrique must refuse it too.
  it("permanentlyDeleteClient refuses an account whose function hides the projects rubrique", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findAccessScopeByEmailMock.mockResolvedValue({
      hiddenSections: [],
      hiddenAreas: ["projects"],
      projectScope: "ALL",
      assignedProjectIds: [],
    });
    findByIdMock.mockResolvedValue({ id: 1, deletedAt: new Date(), photoUrl: null } as never);
    const res = await permanentlyDeleteClient(1);
    expect(res.type).toBe("error");
    expect(permanentlyRemoveMock).not.toHaveBeenCalled();
    expect(findPublicIdsByClientMock).not.toHaveBeenCalled();
  });

  // Lot 5b: the cascade also takes the contacts and every project section.
  it.each([
    ["a project section", { hiddenSections: ["reserves"], hiddenAreas: [] }],
    ["the clients.contacts rubrique", { hiddenSections: [], hiddenAreas: ["clients.contacts"] }],
  ])("permanentlyDeleteClient refuses an EDITOR whose function hides %s, and destroys nothing", async (_label, hidden) => {
    authMock.mockResolvedValue({ user: { role: "EDITOR", email: "chef@example.com" } } as never);
    findAccessScopeByEmailMock.mockResolvedValue({ ...hidden, projectScope: "ALL", assignedProjectIds: [] } as never);
    findByIdMock.mockResolvedValue({ id: 1, deletedAt: new Date(), photoUrl: null } as never);
    const res = await permanentlyDeleteClient(1);
    expect(res.type).toBe("error");
    expect(permanentlyRemoveMock).not.toHaveBeenCalled();
    expect(findPublicIdsByClientMock).not.toHaveBeenCalled();
  });

  it("permanentlyDeleteClient refuses an EDITOR who hides a section with the dedicated message", async () => {
    authMock.mockResolvedValue({ user: { role: "EDITOR", email: "chef@example.com" } } as never);
    findAccessScopeByEmailMock.mockResolvedValue({ hiddenSections: ["files"], hiddenAreas: [], projectScope: "ALL", assignedProjectIds: [] } as never);
    const res = await permanentlyDeleteClient(1);
    expect(res.message).toBe(fr.errors.forbiddenDestroyHiddenSections);
  });

  it("permanentlyDeleteClient lets an EDITOR with nothing hidden destroy a trashed company", async () => {
    authMock.mockResolvedValue({ user: { role: "EDITOR", email: "chef@example.com" } } as never);
    findAccessScopeByEmailMock.mockResolvedValue({ hiddenSections: [], hiddenAreas: [], projectScope: "ALL", assignedProjectIds: [] } as never);
    findByIdMock.mockResolvedValue({ id: 1, deletedAt: new Date(), photoUrl: null, firstName: "A", lastName: "B" } as never);
    permanentlyRemoveMock.mockResolvedValue({ id: 1 } as never);
    findPublicIdsByClientMock.mockResolvedValue([]);
    expect((await permanentlyDeleteClient(1)).type).toBe("success");
  });

  it("permanentlyDeleteClient removes the client and its photo when authenticated as ADMIN", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({
      id: 1,
      deletedAt: new Date(),
      photoUrl: "https://example.com/x.png",
      firstName: "Alice",
      lastName: "Smith",
    } as never);
    permanentlyRemoveMock.mockResolvedValue({ id: 1 } as never);
    findPublicIdsByClientMock.mockResolvedValue([]);
    const res = await permanentlyDeleteClient(1);
    expect(permanentlyRemoveMock).toHaveBeenCalledWith(1);
    expect(res.type).toBe("success");
    expect(logActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PERMANENTLY_DELETED", clientId: 1 })
    );
  });

  // Regression coverage for the silent-no-op trap: cloudinary.uploader.destroy
  // defaults `type` to "upload" when it isn't passed, so a destroy call that
  // only knows the mime type quietly does NOTHING on an asset re-typed to
  // "authenticated" — no error, the blob just stays orphaned (a retention bug,
  // not a mere cleanup miss). The bulk purge must read the stored
  // deliveryType/resourceType and pass them through.
  it("permanentlyDeleteClient destroys its projects' Cloudinary files with their stored guarded type", async () => {
    authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
    findByIdMock.mockResolvedValue({ id: 1, deletedAt: new Date(), photoUrl: null, firstName: "Alice", lastName: "Smith" } as never);
    permanentlyRemoveMock.mockResolvedValue({ id: 1 } as never);
    findPublicIdsByClientMock.mockResolvedValue([
      { publicId: "projects/9/devis", deliveryType: "AUTHENTICATED", resourceType: "RAW" },
    ] as never);
    await permanentlyDeleteClient(1);
    expect(destroyProjectFileMock).toHaveBeenCalledWith("projects/9/devis", {
      deliveryType: "AUTHENTICATED",
      resourceType: "RAW",
    });
  });

  // Regression coverage for a project-scope gap found while fixing
  // docs/PENTEST-2026-08.md (F1): an EDITOR restricted to specific projects
  // must not be able to read or delete a client company reached only through
  // projects outside that set, even though role alone would let them.
  describe("project-scope enforcement (F1 regression)", () => {
    const scopedEditor = { user: { role: "EDITOR", email: "chef@example.com" } };

    it("getClient masks a client the caller has no project under, as not found", async () => {
      authMock.mockResolvedValue(scopedEditor as never);
      findAccessScopeByEmailMock.mockResolvedValue({
        hiddenSections: [],
        hiddenAreas: [],
        projectScope: "ASSIGNED",
        assignedProjectIds: [202],
      });
      hasProjectAmongMock.mockResolvedValue(false); // client 490 has no project in {202}
      findByIdMock.mockResolvedValue({ id: 490, companyName: "Entreprise non assignee" } as never);

      const res = await getClient(490);

      expect(res.type).toBe("success");
      expect(res.data).toBeNull();
      expect(hasProjectAmongMock).toHaveBeenCalledWith(490, [202]);
    });

    it("deleteClient refuses a client the caller has no project under", async () => {
      authMock.mockResolvedValue(scopedEditor as never);
      findAccessScopeByEmailMock.mockResolvedValue({
        hiddenSections: [],
        hiddenAreas: [],
        projectScope: "ASSIGNED",
        assignedProjectIds: [202],
      });
      hasProjectAmongMock.mockResolvedValue(false);

      const res = await deleteClient(490);

      expect((res as { type: string }).type).toBe("error");
      expect(softDeleteMock).not.toHaveBeenCalled();
    });

    // Lot 1, F1: requireClientAccess only asks for ONE live project in scope,
    // yet trashing / restoring / destroying a company takes ALL its projects
    // along. These act on the whole company, so they need ALL of them in scope.
    describe("whole-company actions need EVERY project in scope (lot 1, F1)", () => {
      const asAssigned = () => {
        authMock.mockResolvedValue(scopedEditor as never);
        findAccessScopeByEmailMock.mockResolvedValue({
          hiddenSections: [],
          hiddenAreas: [],
          projectScope: "ASSIGNED",
          assignedProjectIds: [202],
        });
      };
      const trashed = { id: 7, deletedAt: new Date(), companyName: "Acme", photoUrl: null };

      it("refuses to trash / restore / destroy a company with a project outside the scope", async () => {
        asAssigned();
        // Reachable through 202, but one project of the company is not ours:
        // the single whole-company query answers no, for one id or for a list.
        isFullyInScopeMock.mockResolvedValue(false);
        findFullyInScopeIdsMock.mockResolvedValue([]);
        findByIdMock.mockResolvedValue(trashed as never);

        const del = await deleteClient(7);
        const many = await deleteClients([7]);
        const rest = await restoreClient(7);
        const perm = await permanentlyDeleteClient(7);

        expect((del as { type: string }).type).toBe("error");
        expect(many.type).toBe("success"); // skipped, not errored (the count is reported, see below)
        expect(rest.type).toBe("error");
        expect(perm.type).toBe("error");
        expect(isFullyInScopeMock).toHaveBeenCalledWith(7, [202]);
        expect(findFullyInScopeIdsMock).toHaveBeenCalledWith([7], [202]);
        expect(softDeleteMock).not.toHaveBeenCalled();
        expect(restoreMock).not.toHaveBeenCalled();
        expect(permanentlyRemoveMock).not.toHaveBeenCalled();
      });

      it("a company partly out of scope is refused with the same text as an unreachable one", async () => {
        asAssigned();
        // Partly reachable and unreachable are one and the same answer for the
        // whole-company rule: one query, one refusal text.
        isFullyInScopeMock.mockResolvedValue(false);
        const partial = await restoreClient(7);
        const unreachable = await restoreClient(7);
        expect(partial.message).toBe(unreachable.message);
        expect(partial.message).toBe(fr.errors.forbidden);
      });

      it("deleteClients reports how many ids it skipped", async () => {
        asAssigned();
        findFullyInScopeIdsMock.mockResolvedValue([1]); // 2 is not entirely in scope
        findByIdMock.mockResolvedValue({ id: 1, companyName: "Acme" } as never);
        softDeleteMock.mockResolvedValue({ id: 1 } as never);

        const res = await deleteClients([1, 2]);

        expect(res.type).toBe("success");
        expect(softDeleteMock).toHaveBeenCalledTimes(1);
        expect(softDeleteMock).toHaveBeenCalledWith(1);
        // One query for the whole batch, not one per id.
        expect(findFullyInScopeIdsMock).toHaveBeenCalledTimes(1);
        expect(findFullyInScopeIdsMock).toHaveBeenCalledWith([1, 2], [202]);
        expect(isFullyInScopeMock).not.toHaveBeenCalled();
        expect(res.message).toBe(
          fr.clients.messages.deletedBulkSkipped.replace("{count}", "1").replace("{skipped}", "1")
        );
      });

      it("a company ENTIRELY in scope is trashed, restored and destroyed", async () => {
        asAssigned();
        isFullyInScopeMock.mockResolvedValue(true);
        findByIdMock.mockResolvedValue(trashed as never);
        softDeleteMock.mockResolvedValue({ id: 7 } as never);
        restoreMock.mockResolvedValue({ id: 7, companyName: "Acme" } as never);
        permanentlyRemoveMock.mockResolvedValue({ id: 7 } as never);
        findPublicIdsByClientMock.mockResolvedValue([]);

        // Trashing needs a LIVE company (a trashed one is refused, see below);
        // restoring and destroying need the trashed one.
        findByIdMock.mockResolvedValue({ ...trashed, deletedAt: null } as never);
        await deleteClient(7);
        expect(softDeleteMock).toHaveBeenCalledWith(7);
        findByIdMock.mockResolvedValue(trashed as never);
        expect((await restoreClient(7)).type).toBe("success");
        expect((await permanentlyDeleteClient(7)).type).toBe("success");
      });

      it("an unrestricted ADMIN never needs the outside count", async () => {
        authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
        findByIdMock.mockResolvedValue(trashed as never);
        permanentlyRemoveMock.mockResolvedValue({ id: 7 } as never);
        findPublicIdsByClientMock.mockResolvedValue([]);
        expect((await permanentlyDeleteClient(7)).type).toBe("success");
        expect(isFullyInScopeMock).not.toHaveBeenCalled();
        expect(findFullyInScopeIdsMock).not.toHaveBeenCalled();
      });

      it("a LIVE company cannot be destroyed or restored, and answers like an unknown one", async () => {
        authMock.mockResolvedValue({ user: { role: "ADMIN", email: "admin@example.com" } } as never);
        findByIdMock.mockResolvedValue({ id: 7, deletedAt: null, companyName: "Acme" } as never);
        const live = await permanentlyDeleteClient(7);
        const liveRestore = await restoreClient(7);
        findByIdMock.mockResolvedValue(null as never);
        const unknown = await permanentlyDeleteClient(7);

        expect(live.type).toBe("error");
        expect(live.message).toBe(unknown.message);
        expect(liveRestore.message).toBe(unknown.message);
        expect(permanentlyRemoveMock).not.toHaveBeenCalled();
        expect(restoreMock).not.toHaveBeenCalled();
        expect(findPublicIdsByClientMock).not.toHaveBeenCalled();
      });
    });

    it("getClient still resolves the client once one of its projects IS in scope", async () => {
      authMock.mockResolvedValue(scopedEditor as never);
      findAccessScopeByEmailMock.mockResolvedValue({
        hiddenSections: [],
        hiddenAreas: [],
        projectScope: "ASSIGNED",
        assignedProjectIds: [202],
      });
      hasProjectAmongMock.mockResolvedValue(true);
      findByIdMock.mockResolvedValue({ id: 489, companyName: "Entreprise assignee" } as never);

      const res = await getClient(489);

      expect(res.type).toBe("success");
      expect(res.data).toEqual(expect.objectContaining({ id: 489 }));
    });
  });
});
