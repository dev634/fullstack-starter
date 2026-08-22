"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createMaterialSchema, updateMaterialSchema } from "@/schemas/projectMaterial";
import { createOrAccumulate, update, remove, findProjectId as findMaterialProjectId } from "@/repository/projectMaterials";
import { findProjectId as findTaskProjectId } from "@/repository/tasks";
import { findProjectId as findTaskGroupProjectId } from "@/repository/taskGroups";
import { findProjectId as findTaskCategoryProjectId } from "@/repository/taskCategories";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";

/**
 * Confirms a parsed link (at most one of taskId/taskGroupId/taskCategoryId,
 * mutually exclusive by construction of the picker — see schemas/projectMaterial.ts)
 * resolves, in the database, to the same project the material belongs to.
 *
 * The picker (AddMaterialForm/EditMaterialForm) only ever lists the current
 * project's own tasks/series/categories, but that's a client-side filter —
 * nothing server-side checked the submitted id before. Same class of gap as
 * setAssignee's assignedCompanyId/assignedInterimId cross-check
 * (actions/taskAssignee/taskAssignee.ts): an id is encoded in a string
 * (`task:<id>`) rather than carried as its own form field, which is exactly
 * why the earlier sweep of FK-shaped fields missed it.
 */
async function linkTargetInProject(
  data: { taskId?: number; taskGroupId?: number; taskCategoryId?: number },
  projectId: number
): Promise<boolean> {
  if (data.taskId !== undefined) return (await findTaskProjectId(data.taskId)) === projectId;
  if (data.taskGroupId !== undefined) return (await findTaskGroupProjectId(data.taskGroupId)) === projectId;
  if (data.taskCategoryId !== undefined) return (await findTaskCategoryProjectId(data.taskCategoryId)) === projectId;
  return true;
}

export async function addMaterial(
  prevState: ProjectMaterialActionState,
  formData: FormData
): Promise<ProjectMaterialActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
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

  // Passe 3b (C2), point 1: see linkTargetInProject's own comment above.
  if (!(await linkTargetInProject(parsed.data, parsed.data.projectId))) {
    return { ...prevState, type: "error", message: t.errors.invalidId };
  }

  try {
    const { material, accumulated } = await createOrAccumulate({
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
      // Same reference + supplier tops up the existing line, like a scan does.
      message: accumulated ? t.materials.messages.accumulated : t.materials.messages.added,
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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
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
    // Passe 3b, point 2: a material resolved from THIS id that sits outside
    // the caller's scope must read exactly like one that doesn't exist —
    // both are resolved from the database, so a distinct "forbidden"
    // response would let a restricted EDITOR enumerate ids across the whole
    // company (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { ...prevState, type: "error", message: t.materials.messages.invalidId };

    // Passe 3b (C2), point 1: see linkTargetInProject's own comment above —
    // the material's real project (realProjectId), not the client-submitted
    // parsed.data.projectId, is what the new link must resolve into.
    if (!(await linkTargetInProject(parsed.data, realProjectId))) {
      return { ...prevState, type: "error", message: t.errors.invalidId };
    }

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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
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
    // Passe 3b, point 2 — see editMaterial's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.materials.messages.invalidId };
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
