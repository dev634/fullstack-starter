"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createMaterialCategorySchema, updateMaterialCategorySchema } from "@/schemas/materialCategory";
import { create, rename, remove, findProjectId as findCategoryProjectId } from "@/repository/materialCategories";
import { revalidateMaterials } from "@/lib/revalidateMaterials";
import { format } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { MaterialCategoryActionState } from "@/types/materialCategory";

export async function addMaterialCategory(
  prevState: MaterialCategoryActionState,
  formData: FormData
): Promise<MaterialCategoryActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createMaterialCategorySchema.safeParse(raw);
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
    const category = await create({ projectId: parsed.data.projectId, name: parsed.data.name });
    revalidateMaterials(parsed.data.clientId, parsed.data.projectId);
    return {
      ...prevState,
      type: "success",
      message: t.materials.category.messages.added,
      data: category,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function editMaterialCategory(
  prevState: MaterialCategoryActionState,
  formData: FormData
): Promise<MaterialCategoryActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("materials");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = updateMaterialCategorySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const realProjectId = await findCategoryProjectId(parsed.data.id);
    if (realProjectId === null) return { ...prevState, type: "error", message: t.materials.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // A category resolved from THIS id that sits outside the caller's scope
    // must read exactly like one that doesn't exist — both are resolved from
    // the database, so a distinct "forbidden" response would let a
    // restricted EDITOR enumerate ids across the whole company
    // (docs/CONVENTIONS.md), same rule as deleteTaskCategory/deleteMaterial.
    if (scopeCheck.error) return { ...prevState, type: "error", message: t.materials.messages.invalidId };

    const category = await rename(parsed.data.id, parsed.data.name);
    revalidateMaterials(parsed.data.clientId, parsed.data.projectId);
    return {
      ...prevState,
      type: "success",
      message: t.materials.category.messages.updated,
      data: category,
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
 * Delete the category — its materials are never deleted, only unfiled back
 * to "non classé" (database SetNull, repository/materialCategories.ts's own
 * comment). Takes the client id and project id explicitly (rather than
 * looking them up) so the caller can revalidate the right project page.
 * Reports how many materials just lost their filing: the base loses
 * nothing, the classification does, and the user is told the real count the
 * delete produced — not an estimate computed on the client from a possibly
 * stale list.
 */
export async function deleteMaterialCategory(id: number, clientId: number, projectId: number) {
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
    const realProjectId = await findCategoryProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.materials.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Same anti-enumeration rule as editMaterialCategory above.
    if (scopeCheck.error) return { type: "error" as const, message: t.materials.messages.invalidId };
    const { category, unfiledCount } = await remove(id);
    revalidateMaterials(clientId, projectId);
    return {
      type: "success" as const,
      message:
        unfiledCount > 0
          ? format(t.materials.category.messages.deletedWithUnfiled, { count: unfiledCount })
          : t.materials.category.messages.deleted,
      data: category,
    };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
