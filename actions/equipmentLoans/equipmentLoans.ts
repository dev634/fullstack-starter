"use server";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { requireCapability } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { lendEquipmentSchema, returnLoanSchema, editLoanSchema } from "@/schemas/equipmentLoan";
import { getCurrentUserId } from "@/lib/currentUser";
import { findOwnerId } from "@/repository/equipment";
import { findById as findUserById } from "@/repository/users";
import {
  create as createLoan,
  findById as findLoanById,
  markReturned,
  update as updateLoan,
  remove as removeLoan,
} from "@/repository/equipmentLoans";
import { Prisma } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { EquipmentLoanActionState } from "@/types/equipment";

/**
 * `EquipmentLoan` carries exactly one unique constraint — the partial index
 * `EquipmentLoan_equipmentId_open_key` (migration 20260918120000) — so any
 * P2002 on this table can only be that "already lent" conflict. Still checks
 * `meta.target` when the driver provides it, rather than treating every
 * P2002 as this one conflict by assumption: a future second unique
 * constraint on this table must not get silently misattributed.
 */
function isOpenLoanConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (typeof target === "string") return target.includes("EquipmentLoan_equipmentId_open_key");
  if (Array.isArray(target)) return target.includes("EquipmentLoan_equipmentId_open_key");
  return true;
}

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
    const session = await auth();
    const isAdmin = hasMinRole(session?.user?.role, "ADMIN");
    const userId = await getCurrentUserId();
    if (!userId) return { ...prevState, type: "error", message: t.errors.unauthorized };

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
    // form — the portal (CLIENT) never takes part in this module.
    const borrower = await findUserById(parsed.data.borrowerId);
    if (!borrower) {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }
    if (borrower.role === "CLIENT") {
      return { ...prevState, type: "error", message: t.loans.messages.borrowerIsClient };
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
    // "Already lent" is detected on the P2002 the partial unique index
    // raises — NEVER on a pre-check findFirst, which two concurrent requests
    // would both pass (repository/equipmentLoans.ts::create's doc).
    if (isOpenLoanConflict(error)) {
      return { ...prevState, type: "error", message: t.loans.messages.alreadyLent };
    }
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
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
    const session = await auth();
    const isAdmin = hasMinRole(session?.user?.role, "ADMIN");
    const userId = await getCurrentUserId();
    if (!userId) return { ...prevState, type: "error", message: t.errors.unauthorized };

    const loan = await findLoanById(parsed.data.id);
    // Decision (flagged for arbitration): only the equipment's owner or an
    // admin may record a return — same authority as lending it — not the
    // borrower. An already-closed loan reads as "not found" too: there is
    // nothing left to return.
    if (!loan || loan.returnedAt !== null || (!isAdmin && loan.equipment.ownerId !== userId)) {
      return { ...prevState, type: "error", message: t.loans.messages.invalidId };
    }

    if (Date.parse(parsed.data.returnedAt) < loan.lentAt.getTime()) {
      return { ...prevState, type: "error", message: t.loans.messages.returnedBeforeLent };
    }

    const updated = await markReturned(parsed.data.id, parsed.data.returnedAt);
    revalidatePath("/loans");
    return { ...prevState, type: "success", message: t.loans.messages.returned, data: updated };
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
    const session = await auth();
    const isAdmin = hasMinRole(session?.user?.role, "ADMIN");
    const userId = await getCurrentUserId();
    if (!userId) return { ...prevState, type: "error", message: t.errors.unauthorized };

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

    const session = await auth();
    const isAdmin = hasMinRole(session?.user?.role, "ADMIN");
    const userId = await getCurrentUserId();
    if (!userId) return { type: "error" as const, message: t.errors.unauthorized };

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
