"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createTaskSchema } from "@/schemas/task";
import { create, toggle, remove } from "@/repository/tasks";
import { revalidatePath } from "next/cache";
import type { TaskActionState } from "@/types/task";

export async function addTask(
  prevState: TaskActionState,
  formData: FormData
): Promise<TaskActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const raw = formDataToObject(formData);
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: "Validation error. Please check your input and try again.",
      fieldsForm: makeObjectFromZodError(parsed.error),
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
      message: "Task added.",
      data: task,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, "Server error adding task."),
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

  try {
    if (isNaN(id)) {
      throw { type: "error", message: "Invalid task ID" };
    }
    const task = await toggle(id, done);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: "Task updated.", data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error updating task."),
    };
  }
}

export async function deleteTask(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  try {
    if (isNaN(id)) {
      throw { type: "error", message: "Invalid task ID" };
    }
    const task = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: "Task deleted.", data: task };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error deleting task."),
    };
  }
}
