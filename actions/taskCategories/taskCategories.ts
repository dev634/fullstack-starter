"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createTaskCategorySchema } from "@/schemas/taskCategory";
import { create, remove, findProjectId as findCategoryProjectId } from "@/repository/taskCategories";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { TaskCategoryActionState } from "@/types/taskCategory";

export async function addTaskCategory(
  prevState: TaskCategoryActionState,
  formData: FormData
): Promise<TaskCategoryActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createTaskCategorySchema.safeParse(raw);
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
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.tasks.category.messages.added,
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
 * Delete the category only — its series are ungrouped (SetNull), not
 * deleted. Takes the client id and project id explicitly (rather than
 * looking them up) so the caller can revalidate the right project page.
 */
export async function deleteTaskCategory(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const realProjectId = await findCategoryProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    if (scopeCheck.error) return scopeCheck.error;
    const category = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.tasks.category.messages.deleted, data: category };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
