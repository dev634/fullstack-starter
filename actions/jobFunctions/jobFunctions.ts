"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { createJobFunctionSchema } from "@/schemas/jobFunction";
import { create, remove, reorder, updateHiddenSections, updateHiddenAreas, updateProjectScope } from "@/repository/jobFunctions";
import { isProjectSectionKey } from "@/lib/projectSections";
import { normalizeHiddenAreas } from "@/lib/appAreas";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { JobFunctionActionState } from "@/types/jobFunction";

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
