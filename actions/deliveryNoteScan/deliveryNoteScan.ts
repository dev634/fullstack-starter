"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { requireRole } from "@/lib/authz";
import { extractDeliveryNoteItems } from "@/lib/deliveryNoteScan";
import { applyDeliveryScanSchema } from "@/schemas/deliveryNoteScan";
import { applyScanItems } from "@/repository/projectMaterials";
import { create as createFile } from "@/repository/projectFiles";
import { findChildren as findChildFolders } from "@/repository/projectFolders";
import { uploadProjectFile } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { DeliveryNoteScanActionState, ApplyDeliveryScanActionState } from "@/types/deliveryNoteScan";

/**
 * First step: read a delivery note photo and extract its line items — a
 * preview only, nothing is written to the database yet (see
 * applyDeliveryNoteScan for that), so the admin can review/correct the
 * scan before it touches stock.
 */
export async function scanDeliveryNote(
  prevState: DeliveryNoteScanActionState,
  formData: FormData
): Promise<DeliveryNoteScanActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.materials.scan.chooseFile };
  }

  try {
    const items = await extractDeliveryNoteItems(file);
    return { ...prevState, type: "success", message: t.materials.scan.messages.scanned, items };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Second step: apply the reviewed items — adds delivered quantity to an
 * existing material's stock (materialId set) or creates a new material
 * (materialId absent), then attaches the original photo to the project's
 * files, inside the "Bulletins de livraisons" folder when one exists at the
 * project root.
 */
export async function applyDeliveryNoteScan(
  prevState: ApplyDeliveryScanActionState,
  formData: FormData
): Promise<ApplyDeliveryScanActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = applyDeliveryScanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError };
  }

  const { projectId, clientId, items } = parsed.data;
  const file = formData.get("file");

  try {
    await applyScanItems(projectId, items);

    if (file instanceof File && file.size > 0) {
      const rootFolders = await findChildFolders(projectId, null);
      const deliveryFolder = rootFolders.find((f) => f.name.toLowerCase() === "bulletins de livraisons");
      const uploaded = await uploadProjectFile(file, projectId);
      await createFile({
        projectId,
        folderId: deliveryFolder?.id ?? null,
        name: file.name,
        url: uploaded.url,
        publicId: uploaded.publicId,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      });
    }

    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { ...prevState, type: "success", message: t.materials.scan.messages.applied };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}
