"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createTaskSchema, createTaskSeriesSchema } from "@/schemas/task";
import { create, createMany, toggle, updateQuantity, remove } from "@/repository/tasks";
import { create as createGroup } from "@/repository/taskGroups";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
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
      quantityTarget: parsed.data.quantityTarget,
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
 * Bulk-generate numbered tasks from a pattern (e.g. "String {n}" from 1 to
 * 27 creates 27 tasks). See schemas/task.ts's createTaskSeriesSchema for the
 * validation rules (placeholder required, range bounds).
 */
export async function addTaskSeries(
  prevState: TaskActionState,
  formData: FormData
): Promise<TaskActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createTaskSeriesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const { projectId, clientId, name, pattern, from, to, categoryId } = parsed.data;
    const group = await createGroup({ projectId, name, pattern, categoryId });
    const items = [];
    for (let n = from; n <= to; n++) {
      items.push({ projectId, groupId: group.id, title: pattern.replaceAll("{n}", String(n)) });
    }
    const result = await createMany(items);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return {
      ...prevState,
      type: "success",
      message: format(t.tasks.series.generated, { count: result.count }),
      data: { group, ...result },
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
 * `groupId` is passed when the task belongs to a series, so its dedicated
 * page gets revalidated too.
 */
export async function toggleTask(
  id: number,
  done: boolean,
  clientId: number,
  projectId: number,
  groupId?: number | null
) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const task = await toggle(id, done);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    if (groupId) revalidatePath(`/clients/${clientId}/projects/${projectId}/tasks/${groupId}`);
    return { type: "success" as const, message: t.tasks.messages.updated, data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/** Updates a quantity-tracked standalone task's progress (see repository/tasks.ts's updateQuantity). */
export async function updateTaskQuantity(
  id: number,
  quantityDone: number,
  clientId: number,
  projectId: number
) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const task = await updateQuantity(id, quantityDone);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.tasks.messages.updated, data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function deleteTask(
  id: number,
  clientId: number,
  projectId: number,
  groupId?: number | null
) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const task = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    if (groupId) revalidatePath(`/clients/${clientId}/projects/${projectId}/tasks/${groupId}`);
    return { type: "success" as const, message: t.tasks.messages.deleted, data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
