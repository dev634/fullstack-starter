"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createMaterialSchema, updateMaterialSchema } from "@/schemas/projectMaterial";
import { create, update, remove, findProjectId as findMaterialProjectId } from "@/repository/projectMaterials";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";

export async function addMaterial(
  prevState: ProjectMaterialActionState,
  formData: FormData
): Promise<ProjectMaterialActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

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

  const scopeCheck = await requireProjectAccess(parsed.data.projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

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
      taskCategoryId: parsed.data.taskCategoryId,
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

export async function editMaterial(
  prevState: ProjectMaterialActionState,
  formData: FormData
): Promise<ProjectMaterialActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = updateMaterialSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const realProjectId = await findMaterialProjectId(parsed.data.id);
    if (realProjectId === null) return { ...prevState, type: "error", message: t.materials.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };
    const material = await update(parsed.data.id, {
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      supplierName: parsed.data.supplierName,
      reference: parsed.data.reference,
      taskId: parsed.data.taskId,
      taskGroupId: parsed.data.taskGroupId,
      taskCategoryId: parsed.data.taskCategoryId,
      requiredQuantity: parsed.data.requiredQuantity,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.materials.messages.updated,
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
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.materials.messages.invalidId };
    }
    const realProjectId = await findMaterialProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.materials.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    if (scopeCheck.error) return scopeCheck.error;
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
