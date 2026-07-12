"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireSession, requireRole } from "@/lib/authz";
import { createProjectSchema, updateProjectSchema } from "@/schemas/project";
import { create, findById, findByClient, update, remove } from "@/repository/projects";
import { revalidatePath } from "next/cache";
import type { ProjectActionState } from "@/types/project";

export async function addProject(
  prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const raw = formDataToObject(formData);
  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: "Validation error. Please check your input and try again.",
      fieldsForm: makeObjectFromZodError(parsed.error),
    };
  }

  try {
    const project = await create(parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return {
      ...prevState,
      type: "success",
      message: "Project created successfully.",
      data: project,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, "Server error creating project."),
    };
  }
}

export async function updateProject(
  prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const raw = formDataToObject(formData);
  const parsed = updateProjectSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: "Validation error. Please check your input and try again.",
      fieldsForm: makeObjectFromZodError(parsed.error),
    };
  }

  try {
    const project = await update(parsed.data.id, parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return {
      ...prevState,
      type: "success",
      message: "Project updated successfully.",
      data: project,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, "Server error updating project."),
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

  try {
    if (isNaN(id)) {
      throw { type: "error", message: "Invalid project ID" };
    }
    const project = await remove(id);
    revalidatePath(`/clients/${clientId}`);
    return { type: "success" as const, message: "Project deleted.", data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error deleting project."),
    };
  }
}

export async function getProjectsForClient(clientId: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const projects = await findByClient(clientId);
    return { type: "success" as const, data: projects };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error fetching projects."),
    };
  }
}

export async function getProject(id: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    if (isNaN(id)) {
      throw { type: "error", message: "Invalid project ID" };
    }
    const project = await findById(id);
    return { type: "success" as const, data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error fetching project."),
    };
  }
}
