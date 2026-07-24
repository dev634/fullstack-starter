"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createReserveSchema, updateReserveSchema } from "@/schemas/reserve";
import { create as createReserve, update as updateReserveRow, remove as removeReserve } from "@/repository/reserves";
import { create as createPlan, findById as findPlanById, remove as removePlan } from "@/repository/reservePlans";
import { create as createPhoto, findById as findPhotoById, remove as removePhoto } from "@/repository/reservePhotos";
import { uploadReservePlan, destroyReservePlan, uploadReservePhoto, destroyReservePhoto } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ReservePlanActionState, ReserveActionState } from "@/types/reserve";

function projectPath(clientId: number, projectId: number) {
  return `/clients/${clientId}/projects/${projectId}`;
}

/** Upload a PDF plan for a project and store it (ADMIN). */
export async function addReservePlan(
  prevState: ReservePlanActionState,
  formData: FormData
): Promise<ReservePlanActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const projectId = Number(formData.get("projectId"));
  const clientId = Number(formData.get("clientId"));
  const file = formData.get("file");
  const rawName = (formData.get("name")?.toString() ?? "").trim();

  if (isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: t.errors.invalidId };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.reserves.messages.chooseFile };
  }

  try {
    const { url, publicId } = await uploadReservePlan(file, projectId);
    const name = rawName || file.name.replace(/\.pdf$/i, "") || "Plan";
    const plan = await createPlan({ projectId, name, url, publicId });
    revalidatePath(projectPath(clientId, projectId));
    return { ...prevState, type: "success", message: t.reserves.messages.planAdded, data: plan };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a plan (and its réserves) + its Cloudinary asset (ADMIN). */
export async function deleteReservePlan(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.errors.invalidId };
    const existing = await findPlanById(id);
    const plan = await removePlan(id);
    await destroyReservePlan(existing?.publicId);
    revalidatePath(projectPath(clientId, projectId));
    return { type: "success" as const, message: t.reserves.messages.planDeleted, data: plan };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Drop a réserve pin on a plan (ADMIN). */
export async function addReserve(
  prevState: ReserveActionState,
  formData: FormData
): Promise<ReserveActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const projectId = Number(formData.get("projectId"));
  const parsed = createReserveSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const reserve = await createReserve(parsed.data);
    revalidatePath(projectPath(clientId, projectId));
    return { ...prevState, type: "success", message: t.reserves.messages.added, data: reserve };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Edit a réserve's description / status / GPS (ADMIN). */
export async function updateReserve(
  prevState: ReserveActionState,
  formData: FormData
): Promise<ReserveActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const projectId = Number(formData.get("projectId"));
  const parsed = updateReserveSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const reserve = await updateReserveRow(parsed.data.id, parsed.data);
    revalidatePath(projectPath(clientId, projectId));
    return { ...prevState, type: "success", message: t.reserves.messages.updated, data: reserve };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Attach a photo to a réserve (ADMIN). */
export async function addReservePhoto(
  prevState: ReserveActionState,
  formData: FormData
): Promise<ReserveActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const projectId = Number(formData.get("projectId"));
  const reserveId = Number(formData.get("reserveId"));
  const file = formData.get("file");

  if (isNaN(reserveId) || isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: t.reserves.messages.invalidId };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.reserves.messages.choosePhoto };
  }

  try {
    const { url, publicId } = await uploadReservePhoto(file, projectId);
    const photo = await createPhoto({ reserveId, url, publicId });
    revalidatePath(projectPath(clientId, projectId));
    return { ...prevState, type: "success", message: t.reserves.messages.photoAdded, data: photo };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a réserve photo + its Cloudinary asset (ADMIN). */
export async function deleteReservePhoto(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.reserves.messages.invalidId };
    const existing = await findPhotoById(id);
    const photo = await removePhoto(id);
    await destroyReservePhoto(existing?.publicId);
    revalidatePath(projectPath(clientId, projectId));
    return { type: "success" as const, message: t.reserves.messages.photoDeleted, data: photo };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a réserve (ADMIN). */
export async function deleteReserve(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.reserves.messages.invalidId };
    const reserve = await removeReserve(id);
    revalidatePath(projectPath(clientId, projectId));
    return { type: "success" as const, message: t.reserves.messages.deleted, data: reserve };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
