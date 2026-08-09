"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createTaskSchema, createTaskSeriesSchema, updateTaskSchema, updateTaskQuantitySchema } from "@/schemas/task";
import {
  create,
  createMany,
  toggle,
  updateQuantity,
  update,
  remove,
  setCategory,
  findProjectId as findTaskProjectId,
} from "@/repository/tasks";
import { create as createGroup } from "@/repository/taskGroups";
import { findProjectId as findTaskCategoryProjectId } from "@/repository/taskCategories";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { TaskActionState } from "@/types/task";
import type { ProjectTask, ProjectTaskGroup } from "@/app/generated/prisma/client";

export async function addTask(
  prevState: TaskActionState<ProjectTask>,
  formData: FormData
): Promise<TaskActionState<ProjectTask>> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

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

  const scopeCheck = await requireProjectAccess(parsed.data.projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  // The category <select> only ever lists this project's own categories —
  // but nothing server-side checked that before, so a submitted categoryId
  // from another project silently filed the task there, invisible in both
  // projects' listings (which filter by projectId AND by category).
  if (
    parsed.data.categoryId != null &&
    (await findTaskCategoryProjectId(parsed.data.categoryId)) !== parsed.data.projectId
  ) {
    return { ...prevState, type: "error", message: t.errors.invalidId };
  }

  try {
    const task = await create({
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
      quantityTarget: parsed.data.quantityTarget,
      categoryId: parsed.data.categoryId,
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

/** Shape of `addTaskSeries`'s success `data`: the newly-created group plus the bulk-insert count. */
export type AddTaskSeriesData = { group: ProjectTaskGroup; count: number };

/**
 * Bulk-generate numbered tasks from a pattern (e.g. "String {n}" from 1 to
 * 27 creates 27 tasks). See schemas/task.ts's createTaskSeriesSchema for the
 * validation rules (placeholder required, range bounds).
 */
export async function addTaskSeries(
  prevState: TaskActionState<AddTaskSeriesData>,
  formData: FormData
): Promise<TaskActionState<AddTaskSeriesData>> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

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

  const scopeCheck = await requireProjectAccess(parsed.data.projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  // Same cross-check as addTask, above, for the series's own categoryId.
  if (
    parsed.data.categoryId != null &&
    (await findTaskCategoryProjectId(parsed.data.categoryId)) !== parsed.data.projectId
  ) {
    return { ...prevState, type: "error", message: t.errors.invalidId };
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
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const realProjectId = await findTaskProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2: a task resolved from THIS id that sits outside the
    // caller's scope must read exactly like one that doesn't exist — both
    // cases are resolved from the database, so a distinct "forbidden"
    // response would let a restricted EDITOR enumerate ids across the whole
    // company (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { type: "error" as const, message: t.tasks.messages.invalidId };
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

export async function editTask(
  prevState: TaskActionState,
  formData: FormData
): Promise<TaskActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = updateTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const realProjectId = await findTaskProjectId(parsed.data.id);
    if (realProjectId === null) return { ...prevState, type: "error", message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see toggleTask's comment above.
    if (scopeCheck.error) return { ...prevState, type: "error", message: t.errors.invalidId };
    const task = await update(parsed.data.id, {
      title: parsed.data.title,
      dueDate: parsed.data.dueDate,
      quantityTarget: parsed.data.quantityTarget,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.tasks.messages.updated,
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

/** Updates a quantity-tracked standalone task's progress (see repository/tasks.ts's updateQuantity). */
export async function updateTaskQuantity(
  id: number,
  quantityDone: number,
  clientId: number,
  projectId: number
) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  // Called with raw arguments (not FormData) from a client component, but
  // still reachable with a NaN quantityDone from a forged client — see
  // updateTaskQuantitySchema's comment in schemas/task.ts (adversarial pass
  // 2, point 8).
  const parsed = updateTaskQuantitySchema.safeParse({ id, quantityDone, clientId, projectId });
  if (!parsed.success) {
    return { type: "error" as const, message: t.tasks.messages.invalidId };
  }
  try {
    const realProjectId = await findTaskProjectId(parsed.data.id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see toggleTask's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const task = await updateQuantity(parsed.data.id, parsed.data.quantityDone);
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return { type: "success" as const, message: t.tasks.messages.updated, data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/**
 * Assign (or clear, when categoryId is null) the category a standalone task
 * belongs to — takes the client/project id explicitly (rather than looking
 * them up) so the caller can revalidate the right project page, same
 * pattern as taskGroups/setTaskGroupCategory.
 */
export async function setTaskCategory(
  id: number,
  categoryId: number | null,
  clientId: number,
  projectId: number
) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const realProjectId = await findTaskProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see toggleTask's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.tasks.messages.invalidId };
    // Same cross-check as addTask/addTaskSeries: the category <select> only
    // ever lists this project's own categories.
    if (categoryId != null && (await findTaskCategoryProjectId(categoryId)) !== realProjectId) {
      return { type: "error" as const, message: t.tasks.messages.invalidId };
    }
    const task = await setCategory(id, categoryId);
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
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const realProjectId = await findTaskProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see toggleTask's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.tasks.messages.invalidId };
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
