"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireSession, requireRole } from "@/lib/authz";
import { createProjectSchema, updateProjectSchema } from "@/schemas/project";
import { create, findById, findByClient, update, remove } from "@/repository/projects";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProjectActionState } from "@/types/project";

export async function addProject(
  prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const project = await create(parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return {
      ...prevState,
      type: "success",
      message: t.projects.messages.created,
      data: project,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function updateProject(
  prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = updateProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const project = await update(parsed.data.id, parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return {
      ...prevState,
      type: "success",
      message: t.projects.messages.updated,
      data: project,
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
 * Delete a project. Takes the client id explicitly (rather than looking it
 * up) so the caller — a bare button, not a form — can revalidate the right
 * client detail page without an extra round trip.
 */
export async function deleteProject(id: number, clientId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const project = await remove(id);
    revalidatePath(`/clients/${clientId}`);
    return { type: "success" as const, message: t.projects.messages.deleted, data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function getProjectsForClient(clientId: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const t = getDictionary(await getLocale());
  try {
    const projects = await findByClient(clientId);
    return { type: "success" as const, data: projects };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function getProject(id: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const project = await findById(id);
    return { type: "success" as const, data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
