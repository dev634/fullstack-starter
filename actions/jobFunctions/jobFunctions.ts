"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { auth } from "@/lib/auth";
import { getAccessContext } from "@/lib/accessContext";
import { hasMinRole } from "@/lib/authz";
import { createJobFunctionSchema } from "@/schemas/jobFunction";
import { create, remove, reorder, updateHiddenSections, updateHiddenAreas, updateProjectScope } from "@/repository/jobFunctions";
import { findAccountJobFunctionByEmail, countPrivilegedHolders } from "@/repository/users";
import { isProjectSectionKey } from "@/lib/projectSections";
import { normalizeHiddenAreas } from "@/lib/appAreas";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { JobFunctionActionState } from "@/types/jobFunction";

/**
 * Everything that touches an ADMIN or SUPERADMIN account goes through a
 * SUPERADMIN (lib/accountPolicy.ts). A function held by such an account is a
 * constraint ON that administrator, through ONE axis only: its hiddenAreas
 * (which can lift their restrictions, or lock them out of Administration). An
 * ADMIN is exempt from hiddenSections and from the project scope
 * (lib/accessContext.ts), a SUPERADMIN from every axis — so on sections and
 * scope this guard takes nothing from an attacker today: it is kept on all four
 * actions for the rule's coherence, and so it already holds the day an ADMIN
 * becomes subject to those axes. Deleting the function detaches its holders
 * (onDelete: SetNull on User.jobFunctionId). The self-lock guards below only
 * cover the caller's OWN function — this covers every OTHER administrator's.
 * Returns the refusal, or null when the call may go on.
 * The refusal can be explicit: it does depend on rows (who holds the function),
 * but the caller already reads that whole domain — the functions page lists
 * every function and marks the ones held by an administrator.
 */
async function refuseIfHeldByAdmin(id: number, t: Dictionary) {
  // The role comes from getAccessContext (a session reader already probed for
  // the no-session case) rather than a second auth() read: no session means no
  // role, so the check applies and the call is refused.
  const ctx = await getAccessContext();
  if (hasMinRole(ctx.role, "SUPERADMIN")) return null;
  if ((await countPrivilegedHolders(id)) === 0) return null;
  return { type: "error" as const, message: t.jobFunctions.messages.heldByAdminRequiresSuperadmin };
}

/** Add a job function (ADMIN+). */
export async function addJobFunction(
  prevState: JobFunctionActionState,
  formData: FormData
): Promise<JobFunctionActionState> {
  const roleCheck = await requireCapability("functions.manage");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("admin.functions");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = createJobFunctionSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const created = await create(parsed.data.name);
    revalidatePath("/admin/settings/fonctions");
    return { ...prevState, type: "success", message: t.jobFunctions.messages.added, data: created };
  } catch (error) {
    if (error && typeof error === "object" && "type" in error && error.type === "duplicate") {
      return { ...prevState, type: "error", message: t.jobFunctions.messages.duplicate };
    }
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Persist a drag-and-drop reorder of the functions (ADMIN+). */
export async function reorderJobFunctions(orderedIds: number[]) {
  const roleCheck = await requireCapability("functions.manage");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("admin.functions");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    const ids = orderedIds.filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return { type: "error" as const, message: t.errors.invalidId };
    await reorder(ids);
    revalidatePath("/admin/settings/fonctions");
    return { type: "success" as const, message: t.jobFunctions.messages.reordered };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a job function (ADMIN+). */
export async function deleteJobFunction(id: number) {
  const roleCheck = await requireCapability("functions.manage");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("admin.functions");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.errors.invalidId };

    // Adversarial pass, lot C1, #2: a THIRD lever on top of setFunctionAreas
    // and updateUser (both closed in passe 3b). onDelete: SetNull on
    // User.jobFunctionId means deleting the function CURRENTLY ASSIGNED to
    // the caller's own account clears their jobFunctionId in the same
    // transaction — every hiddenAreas/hiddenSections/projectScope
    // restriction it imposed disappears with it, with no SUPERADMIN
    // involved. Same self-check as setFunctionAreas, for the same reason:
    // the escape hatch stays SUPERADMIN, who bypasses hiddenAreas
    // unconditionally anyway (lib/accessContext.ts) — a user must never be
    // able to lock themselves out with no recourse.
    const session = await auth();
    if (!hasMinRole(session?.user?.role, "SUPERADMIN")) {
      const email = session?.user?.email;
      // `null` here means "no account" (sessionAccountWhere found nothing) —
      // refused outright, not read as "has no function" (which would make
      // `ownFunctionId === id` false and silently let the call through for a
      // session whose account just vanished).
      const own = email ? await findAccountJobFunctionByEmail(email) : null;
      if (!own) return { type: "error" as const, message: t.errors.unauthorized };
      if (own.jobFunctionId === id) {
        return { type: "error" as const, message: t.jobFunctions.messages.cannotDeleteOwnFunction };
      }
    }
    const heldByAdmin = await refuseIfHeldByAdmin(id, t);
    if (heldByAdmin) return heldByAdmin;

    const deleted = await remove(id);
    revalidatePath("/admin/settings/fonctions");
    return { type: "success" as const, message: t.jobFunctions.messages.deleted, data: deleted };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Set which project-detail sections are hidden from users holding this
 * function. The incoming keys are filtered to known section keys server-side,
 * so a tampered payload can't store arbitrary values.
 */
export async function setFunctionSections(id: number, hiddenSections: string[]) {
  const roleCheck = await requireCapability("functions.manage");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("admin.functions");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(id) || id <= 0) return { type: "error" as const, message: t.errors.invalidId };
    const heldByAdmin = await refuseIfHeldByAdmin(id, t);
    if (heldByAdmin) return heldByAdmin;
    const valid = Array.isArray(hiddenSections) ? [...new Set(hiddenSections.filter(isProjectSectionKey))] : [];
    await updateHiddenSections(id, valid);
    revalidatePath("/admin/settings/fonctions");
    return { type: "success" as const, message: t.jobFunctions.messages.sectionsSaved };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Set which top-level app rubriques (and sub-parts) are hidden from users
 * holding this function — the exact mirror of setFunctionSections, applied to
 * lib/appAreas.ts's tree instead of a project's sections. Incoming keys are
 * filtered to known area keys server-side via normalizeHiddenAreas, so a
 * tampered payload can't store arbitrary values.
 */
export async function setFunctionAreas(id: number, hiddenAreas: string[]) {
  const roleCheck = await requireCapability("functions.manage");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("admin.functions");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(id) || id <= 0) return { type: "error" as const, message: t.errors.invalidId };

    // Passe 3b, point 3: an ADMIN whose OWN function hides some rubriques
    // could call setFunctionAreas(theirOwnFunctionId, []) and lift that
    // restriction on themselves in a single call, with no SUPERADMIN
    // involved — proven during this pass. Block editing the function
    // CURRENTLY ASSIGNED to the caller's own account. The escape hatch
    // stays SUPERADMIN, who bypasses hiddenAreas unconditionally anyway
    // (lib/accessContext.ts) — a user must never be able to lock themselves
    // out with no recourse, and SUPERADMIN is that recourse: it can always
    // still fix a misconfigured function, including its own.
    const session = await auth();
    if (!hasMinRole(session?.user?.role, "SUPERADMIN")) {
      const email = session?.user?.email;
      // Same "absent account refuses, absent function does not" distinction
      // as deleteJobFunction above.
      const own = email ? await findAccountJobFunctionByEmail(email) : null;
      if (!own) return { type: "error" as const, message: t.errors.unauthorized };
      if (own.jobFunctionId === id) {
        return { type: "error" as const, message: t.jobFunctions.messages.cannotEditOwnFunction };
      }
    }
    const heldByAdmin = await refuseIfHeldByAdmin(id, t);
    if (heldByAdmin) return heldByAdmin;

    const valid = Array.isArray(hiddenAreas) ? normalizeHiddenAreas(hiddenAreas) : [];
    await updateHiddenAreas(id, valid);
    revalidatePath("/admin/settings/fonctions");
    return { type: "success" as const, message: t.jobFunctions.messages.sectionsSaved };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Set a function's project scope. Same gate as the section config — both are
 * halves of the same question, "what may this function reach".
 */
export async function setFunctionScope(id: number, scope: string) {
  const roleCheck = await requireCapability("functions.manage");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("admin.functions");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(id) || id <= 0) return { type: "error" as const, message: t.errors.invalidId };
    const heldByAdmin = await refuseIfHeldByAdmin(id, t);
    if (heldByAdmin) return heldByAdmin;
    // Anything unrecognised falls back to the permissive default rather than
    // silently locking people out of every chantier.
    const valid = scope === "ASSIGNED" ? "ASSIGNED" : "ALL";
    await updateProjectScope(id, valid);
    revalidatePath("/admin/settings/fonctions");
    return { type: "success" as const, message: t.jobFunctions.messages.sectionsSaved };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
