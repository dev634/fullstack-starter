"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createTaskSchema } from "@/schemas/task";
import { create, toggle, remove } from "@/repository/tasks";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { TaskActionState } from "@/types/task";

export async function addTask(
  prevState: TaskActionState,
  formData: FormData
): Promise<TaskActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const task = await create({
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.tasks.messages.added,
      data: task,
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
 * Toggle/delete take the client id and project id explicitly (rather than
 * looking them up) so the caller — a bare checkbox/button, not a form — can
 * revalidate the right project detail page without an extra round trip.
 */
export async function toggleTask(id: number, done: boolean, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const task = await toggle(id, done);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.tasks.messages.updated, data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function deleteTask(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const task = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.tasks.messages.deleted, data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
