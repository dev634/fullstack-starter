import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", () => ({ requireRole: vi.fn() }));
vi.mock("@/repository/contacts", () => ({
  create: vi.fn(),
  update: vi.fn(),
  setPrimary: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { addContact, editContact, setPrimaryContact, deleteContact } from "@/actions/contacts/contacts";
import { requireRole } from "@/lib/authz";
import { create, update, setPrimary, remove } from "@/repository/contacts";

const requireRoleMock = vi.mocked(requireRole);
const createMock = vi.mocked(create);
const updateMock = vi.mocked(update);
const setPrimaryMock = vi.mocked(setPrimary);
const removeMock = vi.mocked(remove);
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
});
