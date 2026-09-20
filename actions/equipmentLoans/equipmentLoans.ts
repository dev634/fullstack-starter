"use server";
import { requireCapability } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { lendEquipmentSchema, returnLoanSchema, editLoanSchema } from "@/schemas/equipmentLoan";
import { getLoansActor } from "@/lib/currentUser";
import { findOwnerId } from "@/repository/equipment";
import { findById as findUserById } from "@/repository/users";
import {
  create as createLoan,
  findById as findLoanById,
  markReturned,
  update as updateLoan,
  remove as removeLoan,
} from "@/repository/equipmentLoans";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { EquipmentLoanActionState } from "@/types/equipment";

export async function lendEquipment(
  prevState: EquipmentLoanActionState,
  formData: FormData
): Promise<EquipmentLoanActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = lendEquipmentSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const actor = await getLoansActor();
    if (!actor) return { ...prevState, type: "error", message: t.errors.unauthorized };
    const { userId, isAdmin } = actor;

    const ownerId = await findOwnerId(parsed.data.equipmentId);
    // Hors périmètre (n'existe pas OU appartient à quelqu'un d'autre, pour un
    // non-admin) ⇒ même message qu'inexistant — anti-énumération.
    if (ownerId === null || (!isAdmin && ownerId !== userId)) {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }

    // One does not lend a tool to its own owner.
    if (parsed.data.borrowerId === ownerId) {
      return { ...prevState, type: "error", message: t.loans.messages.selfLoan };
    }

    // The borrower's role, resolved in the DATABASE — never read from the
    // form — the portal (CLIENT) never takes part in this module. A CLIENT
    // id reads as "not found" too, same message and all — anti-enumeration:
    // a distinct "this id is a portal account" message would let a caller
    // probe arbitrary ids to learn which ones belong to a CLIENT login.
    const borrower = await findUserById(parsed.data.borrowerId);
    if (!borrower || borrower.role === "CLIENT") {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }

    const loan = await createLoan({
      equipmentId: parsed.data.equipmentId,
      borrowerId: parsed.data.borrowerId,
      lentAt: parsed.data.lentAt,
      dueAt: parsed.data.dueAt,
      note: parsed.data.note,
    });

    revalidatePath("/loans");
    return { ...prevState, type: "success", message: t.loans.messages.lent, data: loan };
  } catch (error) {
    // "Already lent" is detected in the REPOSITORY, on the P2002 the partial
    // unique index raises — NEVER on a pre-check findFirst, which two
    // concurrent requests would both pass (repository/equipmentLoans.ts::create's
    // doc). This action never inspects Prisma internals itself: the
    // repository already turned that into a plain `{ i18n: "alreadyLent" }`
    // error, translated below like any other app-thrown i18n code.
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError, t) };
  }
}

export async function returnLoan(
  prevState: EquipmentLoanActionState,
  formData: FormData
): Promise<EquipmentLoanActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = returnLoanSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const actor = await getLoansActor();
    if (!actor) return { ...prevState, type: "error", message: t.errors.unauthorized };
    const { userId, isAdmin } = actor;

    const loan = await findLoanById(parsed.data.id);
    // Decision A: the equipment's owner, an admin, OR the borrower
    // themselves may record a return — editLoan/deleteLoan stay owner/admin
    // only. An already-closed loan reads as "not found" too: there is
    // nothing left to return.
    if (
      !loan ||
      loan.returnedAt !== null ||
      (!isAdmin && loan.equipment.ownerId !== userId && loan.borrowerId !== userId)
    ) {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }

    if (Date.parse(parsed.data.returnedAt) < loan.lentAt.getTime()) {
      return { ...prevState, type: "error", message: t.loans.messages.returnedBeforeLent };
    }

    // Idempotent-safe: the WHERE clause re-checks `returnedAt: null` at the
    // moment of the write, not just at the read above — two concurrent
    // "mark returned" submissions (the owner's and the borrower's, now both
    // authorized) could otherwise both pass that earlier read and both
    // re-mark an already-closed loan.
    const updatedCount = await markReturned(parsed.data.id, parsed.data.returnedAt);
    if (updatedCount === 0) {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }

    revalidatePath("/loans");
    return {
      ...prevState,
      type: "success",
      message: t.loans.messages.returned,
      data: { id: parsed.data.id, returnedAt: parsed.data.returnedAt },
    };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function editLoan(
  prevState: EquipmentLoanActionState,
  formData: FormData
): Promise<EquipmentLoanActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = editLoanSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const actor = await getLoansActor();
    if (!actor) return { ...prevState, type: "error", message: t.errors.unauthorized };
    const { userId, isAdmin } = actor;

    const loan = await findLoanById(parsed.data.id);
    if (!loan || (!isAdmin && loan.equipment.ownerId !== userId)) {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }

    // dueAt isn't part of this payload's own cross-field check
    // (schemas/equipmentLoan.ts) since lentAt isn't submitted on edit —
    // compared here against the value read back from the database instead.
    if (parsed.data.dueAt !== undefined && Date.parse(parsed.data.dueAt) < loan.lentAt.getTime()) {
      return { ...prevState, type: "error", message: t.loans.messages.dueBeforeLent };
    }

    const updated = await updateLoan(parsed.data.id, { dueAt: parsed.data.dueAt, note: parsed.data.note });
    revalidatePath("/loans");
    return { ...prevState, type: "success", message: t.loans.messages.updated, data: updated };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function deleteLoan(id: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(id) || id <= 0) {
      return { type: "error" as const, message: t.loans.messages.invalidId };
    }

    const actor = await getLoansActor();
    if (!actor) return { type: "error" as const, message: t.errors.unauthorized };
    const { userId, isAdmin } = actor;

    const loan = await findLoanById(id);
    if (!loan || (!isAdmin && loan.equipment.ownerId !== userId)) {
      return { type: "error" as const, message: t.loans.messages.invalidId };
    }

    await removeLoan(id);
    revalidatePath("/loans");
    return { type: "success" as const, message: t.loans.messages.deleted };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
