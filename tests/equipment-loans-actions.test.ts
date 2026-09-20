import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ accessConfig: {} }),
  APP_SETTINGS_TAG: "app-settings",
}));
vi.mock("@/lib/accessContext", () => ({
  getAccessContext: vi.fn(),
  canReachProject: vi.fn().mockReturnValue(true),
  projectIdFilter: () => undefined,
}));
vi.mock("@/repository/users", () => ({
  findIdByEmail: vi.fn(),
  findById: vi.fn(),
}));
vi.mock("@/repository/equipment", () => ({
  findOwnerId: vi.fn(),
}));
vi.mock("@/repository/equipmentLoans", () => ({
  create: vi.fn(),
  findById: vi.fn(),
  markReturned: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: vi.fn().mockResolvedValue("fr") }));

import { lendEquipment, returnLoan, editLoan, deleteLoan } from "@/actions/equipmentLoans/equipmentLoans";
import { auth } from "@/lib/auth";
import { getAccessContext } from "@/lib/accessContext";
import { findIdByEmail, findById as findUserById } from "@/repository/users";
import { findOwnerId } from "@/repository/equipment";
import {
  create as createLoan,
  findById as findLoanById,
  markReturned,
  update as updateLoan,
  remove as removeLoan,
} from "@/repository/equipmentLoans";
import fr from "@/lib/i18n/dictionaries/fr";

const authMock = vi.mocked(auth);
const getAccessContextMock = vi.mocked(getAccessContext);
const findIdByEmailMock = vi.mocked(findIdByEmail);
const findUserByIdMock = vi.mocked(findUserById);
const findOwnerIdMock = vi.mocked(findOwnerId);
const createLoanMock = vi.mocked(createLoan);
const findLoanByIdMock = vi.mocked(findLoanById);
const markReturnedMock = vi.mocked(markReturned);
const updateLoanMock = vi.mocked(updateLoan);
const removeLoanMock = vi.mocked(removeLoan);

const initial = { type: null, message: "" } as const;

function actor(role: string, email = `${role.toLowerCase()}@x.com`) {
  authMock.mockResolvedValue({ user: { role, email } } as never);
  getAccessContextMock.mockResolvedValue({
    email,
    role,
    hiddenSections: new Set(),
    hiddenAreas: new Set(),
    projectIds: null,
  } as never);
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const loanRow = (overrides: Partial<{ id: number; equipmentId: number; borrowerId: number; ownerId: number; returnedAt: Date | null; lentAt: Date }> = {}) => ({
  id: 10,
  equipmentId: 5,
  borrowerId: 7,
  returnedAt: null,
  lentAt: new Date("2026-01-01"),
  ...overrides,
  equipment: { ownerId: overrides.ownerId ?? 3 },
});

describe("lendEquipment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a VIEWER (read-only capability)", async () => {
    actor("VIEWER");
    const res = await lendEquipment(
      initial,
      form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01" })
    );
    expect(res.type).toBe("error");
    expect(createLoanMock).not.toHaveBeenCalled();
  });

  it("rejects an inverted date range (dueAt before lentAt)", async () => {
    actor("EDITOR");
    const res = await lendEquipment(
      initial,
      form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-02-10", dueAt: "2026-02-01" })
    );
    expect(res.type).toBe("zodError");
    expect(createLoanMock).not.toHaveBeenCalled();
  });

  it("says the exact same thing for someone else's equipment as for one that doesn't exist (anti-enumeration)", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);

    findOwnerIdMock.mockResolvedValueOnce(99); // exists, owned by someone else
    const notOwned = await lendEquipment(initial, form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01" }));

    findOwnerIdMock.mockResolvedValueOnce(null); // doesn't exist
    const notFound = await lendEquipment(initial, form({ equipmentId: "999", borrowerId: "7", lentAt: "2026-01-01" }));

    expect(notOwned.message).toBe(fr.loans.messages.invalidId);
    expect(notFound.message).toBe(fr.loans.messages.invalidId);
    expect(createLoanMock).not.toHaveBeenCalled();
  });

  it("refuses lending a tool to its own owner (self-loan)", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findOwnerIdMock.mockResolvedValue(3);

    const res = await lendEquipment(initial, form({ equipmentId: "5", borrowerId: "3", lentAt: "2026-01-01" }));

    expect(res.message).toBe(fr.loans.messages.selfLoan);
    expect(createLoanMock).not.toHaveBeenCalled();
  });

  // Point 11 (revue "Prêts"): a CLIENT borrower reads as "not found", the
  // same message as an id that doesn't exist — anti-enumeration, so a
  // distinct message can't be used to probe which ids are portal accounts.
  it("refuses a borrower whose role is CLIENT — resolved in the database, not read from the form — the same way as an id that doesn't exist", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findOwnerIdMock.mockResolvedValue(3);
    findUserByIdMock.mockResolvedValue({ id: 7, email: "c@x.com", role: "CLIENT", jobFunctionId: null } as never);

    const res = await lendEquipment(initial, form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01" }));

    expect(res.message).toBe(fr.loans.messages.invalidId);
    expect(createLoanMock).not.toHaveBeenCalled();
  });

  it("lets an ADMIN lend someone else's equipment", async () => {
    actor("ADMIN", "admin@x.com");
    findIdByEmailMock.mockResolvedValue(1);
    findOwnerIdMock.mockResolvedValue(99);
    findUserByIdMock.mockResolvedValue({ id: 7, email: "e@x.com", role: "EDITOR", jobFunctionId: null } as never);
    createLoanMock.mockResolvedValue({ id: 10 } as never);

    const res = await lendEquipment(initial, form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01" }));

    expect(res.type).toBe("success");
    expect(createLoanMock).toHaveBeenCalledWith(
      expect.objectContaining({ equipmentId: 5, borrowerId: 7, lentAt: "2026-01-01" })
    );
  });

  // Point 13 (revue "Prêts"): dueAt/note are real <input>/<textarea>
  // elements with a `name` — the browser submits them as "" when left
  // empty, never omits the key entirely (unlike this file's other tests,
  // which never set them at all via the `form()` helper).
  it("maps empty dueAt/note strings (what the browser actually sends) to undefined, per the schema", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findOwnerIdMock.mockResolvedValue(3);
    findUserByIdMock.mockResolvedValue({ id: 7, email: "e@x.com", role: "EDITOR", jobFunctionId: null } as never);
    createLoanMock.mockResolvedValue({ id: 10 } as never);

    const res = await lendEquipment(
      initial,
      form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01", dueAt: "", note: "" })
    );

    expect(res.type).toBe("success");
    expect(createLoanMock).toHaveBeenCalledWith(
      expect.objectContaining({ dueAt: undefined, note: undefined })
    );
  });

  // Detection of the P2002 itself (array target vs. index-name string vs. an
  // unrelated constraint) now lives in repository/equipmentLoans.ts::create,
  // never on a pre-check findFirst — two concurrent requests would both pass
  // that (see the repository's own doc). This action-level test only proves
  // the RELAY: whatever clean, structured error the repository throws, the
  // action surfaces as the matching localized message — never a raw Prisma
  // object. The repository's own target-shape parsing is proved live against
  // the real database instead (not by this mocked test, which replaces the
  // repository entirely).
  it("surfaces the repository's 'already lent' i18n error as the localized message", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findOwnerIdMock.mockResolvedValue(3);
    findUserByIdMock.mockResolvedValue({ id: 7, email: "e@x.com", role: "EDITOR", jobFunctionId: null } as never);
    createLoanMock.mockRejectedValue({
      type: "error",
      message: "This equipment is already lent out.",
      i18n: "alreadyLent",
    });

    const res = await lendEquipment(initial, form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01" }));

    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.loans.messages.alreadyLent);
  });

  it("surfaces any other repository failure as the generic server error, never the raw repositoryError diagnostic", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findOwnerIdMock.mockResolvedValue(3);
    findUserByIdMock.mockResolvedValue({ id: 7, email: "e@x.com", role: "EDITOR", jobFunctionId: null } as never);
    createLoanMock.mockRejectedValue({ type: "repositoryError", message: "Database Error creating loan." });

    const res = await lendEquipment(initial, form({ equipmentId: "5", borrowerId: "7", lentAt: "2026-01-01" }));

    expect(res.type).toBe("error");
    expect(res.message).toBe(fr.errors.serverError);
  });
});

describe("returnLoan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says the exact same thing for someone else's loan as for one that doesn't exist", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);

    findLoanByIdMock.mockResolvedValueOnce(loanRow({ ownerId: 99 }) as never);
    const notOwned = await returnLoan(initial, form({ id: "10", returnedAt: "2026-01-05" }));

    findLoanByIdMock.mockResolvedValueOnce(null);
    const notFound = await returnLoan(initial, form({ id: "999", returnedAt: "2026-01-05" }));

    expect(notOwned.message).toBe(fr.loans.messages.invalidId);
    expect(notFound.message).toBe(fr.loans.messages.invalidId);
    expect(markReturnedMock).not.toHaveBeenCalled();
  });

  it("refuses returning an already-closed loan (reads as not found)", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow({ returnedAt: new Date("2026-01-02") }) as never);

    const res = await returnLoan(initial, form({ id: "10", returnedAt: "2026-01-05" }));

    expect(res.message).toBe(fr.loans.messages.invalidId);
    expect(markReturnedMock).not.toHaveBeenCalled();
  });

  it("rejects a return date before the loan date, checked against the DATABASE's lentAt", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow({ lentAt: new Date("2026-02-10") }) as never);

    const res = await returnLoan(initial, form({ id: "10", returnedAt: "2026-02-01" }));

    expect(res.message).toBe(fr.loans.messages.returnedBeforeLent);
    expect(markReturnedMock).not.toHaveBeenCalled();
  });

  it("marks the loan returned when authorized (owner)", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow() as never);
    markReturnedMock.mockResolvedValue(1);

    const res = await returnLoan(initial, form({ id: "10", returnedAt: "2026-01-05" }));

    expect(res.type).toBe("success");
    expect(markReturnedMock).toHaveBeenCalledWith(10, "2026-01-05");
  });

  // Decision A: the borrower may also mark THEIR OWN loan returned, on top of
  // the owner/admin authority above — editLoan/deleteLoan stay owner/admin
  // only (see the dedicated tests in their own describe blocks below).
  it("lets the borrower record their own return, without owner/admin authority", async () => {
    actor("EDITOR", "borrower@x.com");
    findIdByEmailMock.mockResolvedValue(7); // the loanRow() default borrowerId, owned by 3
    findLoanByIdMock.mockResolvedValue(loanRow() as never);
    markReturnedMock.mockResolvedValue(1);

    const res = await returnLoan(initial, form({ id: "10", returnedAt: "2026-01-05" }));

    expect(res.type).toBe("success");
    expect(markReturnedMock).toHaveBeenCalledWith(10, "2026-01-05");
  });

  it("refuses a caller who is neither the owner, an admin, nor the borrower", async () => {
    actor("EDITOR", "stranger@x.com");
    findIdByEmailMock.mockResolvedValue(42);
    findLoanByIdMock.mockResolvedValue(loanRow() as never); // owned by 3, borrowed by 7

    const res = await returnLoan(initial, form({ id: "10", returnedAt: "2026-01-05" }));

    expect(res.message).toBe(fr.loans.messages.invalidId);
    expect(markReturnedMock).not.toHaveBeenCalled();
  });

  // repository/equipmentLoans.ts::markReturned re-checks `returnedAt: null`
  // in the SAME statement as the write (updateMany), not just at the
  // findLoanById read above — a concurrent submission (e.g. the owner's and
  // the borrower's racing each other) can close the loan between the two.
  it("treats a concurrent close (updateMany matches zero rows) as not found, not a silent double-return", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow() as never); // read as still open
    markReturnedMock.mockResolvedValue(0); // but already closed by the time of the write

    const res = await returnLoan(initial, form({ id: "10", returnedAt: "2026-01-05" }));

    expect(res.message).toBe(fr.loans.messages.invalidId);
  });
});

describe("editLoan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a dueAt before the loan's real lentAt (read from the database)", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow({ lentAt: new Date("2026-02-10") }) as never);

    const res = await editLoan(initial, form({ id: "10", dueAt: "2026-02-01" }));

    expect(res.message).toBe(fr.loans.messages.dueBeforeLent);
    expect(updateLoanMock).not.toHaveBeenCalled();
  });

  it("trims the note and maps a whitespace-only one to undefined", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow() as never);
    updateLoanMock.mockResolvedValue({ id: 10 } as never);

    const res = await editLoan(initial, form({ id: "10", note: "   " }));

    expect(res.type).toBe("success");
    expect(updateLoanMock).toHaveBeenCalledWith(10, expect.objectContaining({ note: undefined }));
  });

  it("updates dueAt/note when authorized", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow() as never);
    updateLoanMock.mockResolvedValue({ id: 10 } as never);

    const res = await editLoan(initial, form({ id: "10", dueAt: "2026-02-01", note: "Rendre vendredi" }));

    expect(res.type).toBe("success");
    expect(updateLoanMock).toHaveBeenCalledWith(10, { dueAt: "2026-02-01", note: "Rendre vendredi" });
  });

  // Decision A only extends returnLoan's authority to the borrower — edit
  // stays owner/admin only, same message as a loan that doesn't exist.
  it("refuses the borrower (not owner, not admin) the same way as a non-existent loan", async () => {
    actor("EDITOR", "borrower@x.com");
    findIdByEmailMock.mockResolvedValue(7); // the loanRow() default borrowerId, owned by 3
    findLoanByIdMock.mockResolvedValue(loanRow() as never);

    const res = await editLoan(initial, form({ id: "10", dueAt: "2026-02-01" }));

    expect(res.message).toBe(fr.loans.messages.invalidId);
    expect(updateLoanMock).not.toHaveBeenCalled();
  });
});

describe("deleteLoan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says the exact same thing for someone else's loan as for one that doesn't exist", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);

    findLoanByIdMock.mockResolvedValueOnce(loanRow({ ownerId: 99 }) as never);
    const notOwned = await deleteLoan(10);

    findLoanByIdMock.mockResolvedValueOnce(null);
    const notFound = await deleteLoan(999);

    expect((notOwned as { message: string }).message).toBe(fr.loans.messages.invalidId);
    expect((notFound as { message: string }).message).toBe(fr.loans.messages.invalidId);
    expect(removeLoanMock).not.toHaveBeenCalled();
  });

  it("deletes when authorized", async () => {
    actor("EDITOR", "owner@x.com");
    findIdByEmailMock.mockResolvedValue(3);
    findLoanByIdMock.mockResolvedValue(loanRow() as never);
    removeLoanMock.mockResolvedValue({ id: 10 } as never);

    const res = await deleteLoan(10);

    expect((res as { type: string }).type).toBe("success");
    expect(removeLoanMock).toHaveBeenCalledWith(10);
  });

  // Decision A only extends returnLoan's authority to the borrower — delete
  // stays owner/admin only, same message as a loan that doesn't exist.
  it("refuses the borrower (not owner, not admin) the same way as a non-existent loan", async () => {
    actor("EDITOR", "borrower@x.com");
    findIdByEmailMock.mockResolvedValue(7); // the loanRow() default borrowerId, owned by 3
    findLoanByIdMock.mockResolvedValue(loanRow() as never);

    const res = await deleteLoan(10);

    expect((res as { message: string }).message).toBe(fr.loans.messages.invalidId);
    expect(removeLoanMock).not.toHaveBeenCalled();
  });
});
