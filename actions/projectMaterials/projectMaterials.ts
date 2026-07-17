"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createMaterialSchema } from "@/schemas/projectMaterial";
import { create, remove } from "@/repository/projectMaterials";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";

export async function addMaterial(
  prevState: ProjectMaterialActionState,
  formData: FormData
): Promise<ProjectMaterialActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createMaterialSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const material = await create({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      supplierName: parsed.data.supplierName,
      reference: parsed.data.reference,
      taskId: parsed.data.taskId,
      taskGroupId: parsed.data.taskGroupId,
      requiredQuantity: parsed.data.requiredQuantity,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.materials.messages.added,
      data: material,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/**
 * Delete takes the client id and project id explicitly (rather than looking
 * them up) so the caller — a bare button, not a form — can revalidate the
 * right project detail page without an extra round trip.
 */
export async function deleteMaterial(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.materials.messages.invalidId };
    }
    const material = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.materials.messages.deleted, data: material };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
