"use server";
import { requireCapability } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { createEquipmentSchema, updateEquipmentSchema } from "@/schemas/equipment";
import { getCurrentUserId, getLoansActor } from "@/lib/currentUser";
import { create, update, findById, removeIfNotLent, isPhotoPublicIdReferenced } from "@/repository/equipment";
import { assetCompensation, writeWithCompensation } from "@/lib/uploadCompensation";
import { uploadEquipmentPhoto, destroyEquipmentPhoto, type UploadedEquipmentPhoto } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { EquipmentActionState } from "@/types/equipment";

/**
 * Pull the uploaded "photo" file out of the form and push it to Cloudinary.
 * Returns `undefined` when no new file was provided, so callers can leave an
 * existing photo untouched — same contract as
 * actions/clients/clients.ts::extractPhotoUrl. `owner` is the account the role
 * guard resolved (never a form field): the decode is charged to its share of
 * the decoder (lib/imageMetadata.ts).
 */
async function extractEquipmentPhoto(formData: FormData, owner: string): Promise<UploadedEquipmentPhoto | undefined> {
  const file = formData.get("photo");
  if (file instanceof File && file.size > 0) {
    return uploadEquipmentPhoto(file, owner);
  }
  return undefined;
}

/** The compensation of a photo this call uploaded, or none when it uploaded nothing. */
function photoCompensation(photo: UploadedEquipmentPhoto | undefined) {
  return photo ? assetCompensation("equipment photo", photo, isPhotoPublicIdReferenced) : undefined;
}

export async function addEquipment(
  prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = createEquipmentSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const ownerId = await getCurrentUserId();
    if (!ownerId) return { ...prevState, type: "error", message: t.errors.unauthorized };

    const photo = await extractEquipmentPhoto(formData, roleCheck.email);
    // Only the write is wrapped (lib/uploadCompensation.ts): a failure of
    // `create` must not leave the uploaded photo orphaned, and a failure of
    // anything AFTER it must never destroy a photo a row now points at.
    await writeWithCompensation(
      () =>
        create({
          ownerId,
          name: parsed.data.name,
          reference: parsed.data.reference,
          photoUrl: photo?.url,
          photoPublicId: photo?.publicId,
        }),
      photoCompensation(photo)
    );

    revalidatePath("/loans");
    return { ...prevState, type: "success", message: t.equipment.messages.added };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError, t) };
  }
}

export async function editEquipment(
  prevState: EquipmentActionState,
  formData: FormData
): Promise<EquipmentActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = updateEquipmentSchema.safeParse(formDataToObject(formData));
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

    const existing = await findById(parsed.data.id);
    // Hors périmètre (n'existe pas OU appartient à quelqu'un d'autre, pour un
    // non-admin) ⇒ même message qu'inexistant — anti-énumération, comme
    // editIntervention/deleteIntervention (actions/interventions/interventions.ts).
    if (!existing || (!isAdmin && existing.ownerId !== userId)) {
      return { ...prevState, type: "error", message: t.equipment.messages.invalidId };
    }

    const uploadedPhoto = await extractEquipmentPhoto(formData, roleCheck.email);
    const removePhoto = formData.get("removePhoto") === "true";
    let photoUrl: string | null | undefined;
    let photoPublicId: string | null | undefined;
    if (uploadedPhoto) {
      photoUrl = uploadedPhoto.url;
      photoPublicId = uploadedPhoto.publicId;
    } else if (removePhoto) {
      photoUrl = null;
      photoPublicId = null;
    }

    await writeWithCompensation(
      () =>
        update(parsed.data.id, {
          name: parsed.data.name,
          reference: parsed.data.reference,
          photoUrl,
          photoPublicId,
        }),
      photoCompensation(uploadedPhoto)
    );

    // Drop the previous asset only once the write succeeded, and only when
    // it was actually replaced or removed — same ordering as
    // actions/clients/clients.ts::updateClient.
    if (photoUrl !== undefined && existing.photoPublicId) {
      await destroyEquipmentPhoto(existing.photoPublicId);
    }

    revalidatePath("/loans");
    return { ...prevState, type: "success", message: t.equipment.messages.updated };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError, t) };
  }
}

export async function deleteEquipment(id: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("loans");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(id) || id <= 0) {
      return { type: "error" as const, message: t.equipment.messages.invalidId };
    }

    const actor = await getLoansActor();
    if (!actor) return { type: "error" as const, message: t.errors.unauthorized };
    const { userId, isAdmin } = actor;

    const existing = await findById(id);
    if (!existing || (!isAdmin && existing.ownerId !== userId)) {
      return { type: "error" as const, message: t.equipment.messages.invalidId };
    }

    // ONE statement: the "not currently lent" check and the delete itself,
    // so a loan created between the read above and this call can't slip an
    // equipment through (repository/equipment.ts::removeIfNotLent's doc).
    const deletedCount = await removeIfNotLent(id, isAdmin ? null : userId);
    if (deletedCount === 0) {
      return { type: "error" as const, message: t.equipment.messages.cannotDeleteLent };
    }

    await destroyEquipmentPhoto(existing.photoPublicId);

    revalidatePath("/loans");
    return { type: "success" as const, message: t.equipment.messages.deleted };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
