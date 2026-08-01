"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { requireCapability, requireProjectAccess, requireClientAccess } from "@/lib/access";
import { getAccessContext, canReachProject, projectIdFilter } from "@/lib/accessContext";
import { createProjectSchema, updateProjectSchema } from "@/schemas/project";
import { create, findById, findByClient, update, remove, softDelete, restore } from "@/repository/projects";
import { createDefaults as createDefaultFolders } from "@/repository/projectFolders";
import { findByEmail } from "@/repository/clients";
import { findPublicIdsByProject } from "@/repository/projectFiles";
import { destroyProjectFile } from "@/lib/cloudinary";
import { logActivity } from "@/repository/projectActivity";
import { parseCsvRecords, PROJECT_CSV_COLUMNS } from "@/lib/csv";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { ProjectActionState } from "@/types/project";

const HEADER_TO_FIELD: Record<string, string> = Object.fromEntries(
  PROJECT_CSV_COLUMNS.map((c) => [c.header, c.key])
);

export async function addProject(
  prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const roleCheck = await requireCapability("content.edit");
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

  const scopeCheck = await requireClientAccess(parsed.data.clientId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  try {
    const project = await create(parsed.data);
    await createDefaultFolders(project.id);
    await logActivity({
      action: "CREATED",
      projectId: project.id,
      projectName: parsed.data.name,
      actorEmail: roleCheck.email,
    });
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
  const roleCheck = await requireCapability("content.edit");
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

  const scopeCheck = await requireProjectAccess(parsed.data.id);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  try {
    const project = await update(parsed.data.id, parsed.data);
    await logActivity({
      action: "UPDATED",
      projectId: parsed.data.id,
      projectName: parsed.data.name,
      actorEmail: roleCheck.email,
    });
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
 * Move a project to the trash (reversible). Takes the client id explicitly
 * (rather than looking it up) so the caller — a bare button, not a form —
 * can revalidate the right client detail page without an extra round trip.
 */
export async function deleteProject(id: number, clientId: number) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const scopeCheck = await requireProjectAccess(id);
    if (scopeCheck.error) return scopeCheck.error;
    const existing = await findById(id);
    const project = await softDelete(id);
    await logActivity({
      action: "DELETED",
      projectId: id,
      projectName: existing?.name ?? `#${id}`,
      actorEmail: roleCheck.email,
    });
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/projects");
    return { type: "success" as const, message: t.projects.messages.deleted, data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/** Bring a trashed project back into the normal listings. */
export async function restoreProject(id: number) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const scopeCheck = await requireProjectAccess(id);
    if (scopeCheck.error) return scopeCheck.error;
    const project = await restore(id);
    await logActivity({
      action: "RESTORED",
      projectId: id,
      projectName: project.name,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/projects");
    revalidatePath("/projects/trash");
    return { type: "success" as const, message: t.projects.messages.restored, data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/**
 * Permanently delete a trashed project — irreversible.
 */
export async function permanentlyDeleteProject(id: number) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const scopeCheck = await requireProjectAccess(id);
    if (scopeCheck.error) return scopeCheck.error;
    const existing = await findById(id);
    // Clean up the Cloudinary blobs before the DB rows cascade-delete —
    // otherwise the files are orphaned in Cloudinary forever.
    const files = await findPublicIdsByProject(id);
    await Promise.all(files.map((f) => destroyProjectFile(f.publicId, f.mimeType)));
    const project = await remove(id);
    await logActivity({
      action: "PERMANENTLY_DELETED",
      projectId: id,
      projectName: existing?.name ?? `#${id}`,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/projects/trash");
    return { type: "success" as const, message: t.projects.messages.permanentlyDeleted, data: project };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export type ImportRowError = { row: number; email?: string; message: string };
export type ImportResult = {
  type: "success" | "error";
  message: string;
  created: number;
  total: number;
  errors: ImportRowError[];
};

/**
 * Bulk-create projects from a CSV file (same column headers as
 * /projects/export). Each row is matched to an existing client by email —
 * a project can't exist without one, so an unknown email fails that row
 * rather than the whole batch.
 */
export async function importProjects(formData: FormData): Promise<ImportResult> {
  const roleCheck = await requireCapability("content.import");
  const t = getDictionary(await getLocale());
  if (roleCheck.error) {
    return { type: "error", message: roleCheck.error.message, created: 0, total: 0, errors: [] };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { type: "error", message: t.projects.messages.chooseCsvFile, created: 0, total: 0, errors: [] };
  }

  const text = await file.text();
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return { type: "error", message: t.projects.messages.emptyCsvFile, created: 0, total: 0, errors: [] };
  }

  let created = 0;
  const errors: ImportRowError[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNumber = i + 2;
    const clientEmail = record["Client Email"];

    const data: Record<string, string> = {};
    for (const [header, value] of Object.entries(record)) {
      const field = HEADER_TO_FIELD[header];
      if (field && field !== "clientEmail" && !((field === "type" || field === "status") && value === "")) {
        data[field] = value;
      }
    }

    try {
      const client = clientEmail ? await findByEmail(clientEmail) : null;
      if (!client) {
        throw new Error(t.projects.messages.unknownClientEmail);
      }
      const scopeCheck = await requireClientAccess(client.id);
      if (scopeCheck.error) {
        throw new Error(scopeCheck.error.message);
      }
      const parsed = createProjectSchema.safeParse({ ...data, clientId: client.id });
      if (!parsed.success) {
        throw new Error(t.projects.messages.invalidRow);
      }
      await create(parsed.data);
      created++;
    } catch (error) {
      errors.push({
        row: rowNumber,
        email: clientEmail,
        message: getErrorMessage(error, t.projects.messages.invalidRow),
      });
    }
  }

  if (created > 0) {
    await logActivity({
      action: "IMPORTED",
      projectId: null,
      projectName: `${created} project(s) via CSV import`,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/projects");
  }

  return {
    type: created > 0 ? "success" : "error",
    message:
      errors.length === 0
        ? format(t.projects.messages.importedSuccess, { count: created })
        : format(t.projects.messages.importedPartial, { count: created, errors: errors.length }),
    created,
    total: records.length,
    errors,
  };
}

export async function getProjectsForClient(clientId: number) {
  const roleCheck = await requireRole("VIEWER");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    const projects = await findByClient(clientId, projectIdFilter(await getAccessContext()));
    return { type: "success" as const, data: projects };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function getProject(id: number) {
  const roleCheck = await requireRole("VIEWER");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const project = await findById(id);
    // A trashed project is invisible to the normal detail page (looks like
    // "not found"); the trash page reads the repository directly instead. A
    // project outside the caller's scope reads the same way — a distinct
    // response would confirm it exists to someone who shouldn't know that.
    const access = await getAccessContext();
    const visible = project && !project.deletedAt && canReachProject(access, project.id);
    return { type: "success" as const, data: visible ? project : null };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
