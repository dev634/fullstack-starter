"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { requireCapability, requireProjectAccess, requireTrashedProjectAccess, requireClientAccess, requireClientAccessWithin } from "@/lib/access";
import { scopeRefusalMessage } from "@/lib/scopeRefusal";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireEverySectionAccess } from "@/lib/sectionAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { projectTrashState } from "@/lib/projectTrash";
import { createProjectSchema, updateProjectSchema } from "@/schemas/project";
import { create, findById, update, remove, softDelete, restore } from "@/repository/projects";
import { createDefaults as createDefaultFolders } from "@/repository/projectFolders";
import { findByEmail } from "@/repository/clients";
import { findPublicIdsByProject } from "@/repository/projectFiles";
import { destroyProjectFile } from "@/lib/cloudinary";
import { logActivity } from "@/repository/projectActivity";
import {
  readCsvUpload,
  csvHeaderOf,
  normalizeCsvDate,
  normalizeCsvNumber,
  PROJECT_CSV_COLUMNS,
  type CsvDelimiter,
} from "@/lib/csv";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import { csvRefusalResult } from "@/lib/csvRefusal";
import type { ProjectActionState } from "@/types/project";

const HEADER_TO_FIELD: Record<string, string> = Object.fromEntries(
  PROJECT_CSV_COLUMNS.map((c) => [c.header, c.key])
);
const CLIENT_EMAIL_HEADER = csvHeaderOf(PROJECT_CSV_COLUMNS, "clientEmail");

export async function addProject(
  prevState: ProjectActionState,
  formData: FormData
): Promise<ProjectActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

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
    // A payload carrying only ONE bound is compared to nothing by the schema
    // (no database read there): read the stored other one and apply the same
    // ordering rule, same message, on endDate. An explicit null on the other
    // bound clears it — nothing left to compare against.
    const { startDate, endDate } = parsed.data;
    const onlyStart = typeof startDate === "string" && endDate === undefined;
    const onlyEnd = typeof endDate === "string" && startDate === undefined;
    // The stored bound is read and the write made in ONE locked transaction
    // (repository update's `accept`): two partial updates racing each other
    // cannot both pass a check that, together, they break.
    const project =
      onlyStart || onlyEnd
        ? await update(parsed.data.id, parsed.data, (stored) => {
            const start = onlyStart ? startDate : stored.startDate;
            const end = onlyEnd ? endDate : stored.endDate;
            return !(start && end && end < start);
          })
        : await update(parsed.data.id, parsed.data);
    if (project === null) {
      return {
        ...prevState,
        type: "zodError",
        message: t.errors.validationError,
        fieldsForm: { endDate: t.errors.endBeforeStart },
      };
    }
    await logActivity({
      action: "UPDATED",
      projectId: parsed.data.id,
      // `name` is optional on an update (absent = unchanged): the name that
      // counts is the one the row carries now, as the repository returned it.
      projectName: project.name,
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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;

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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    // Only a project that IS in the trash can be restored; a live or unknown
    // one gets the same answer (requireTrashedProjectAccess).
    const scopeCheck = await requireTrashedProjectAccess(id, "restore");
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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  // The cascade takes every section of the chantier (tasks, materials, files and
  // their Cloudinary blobs, plans, réserves, interventions, workforce): a
  // function that hides one of them does not get to destroy it.
  const sectionsCheck = await requireEverySectionAccess();
  if (sectionsCheck.error) return sectionsCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    // Irreversible: only a project that is already in the trash may go (a
    // LIVE one used to be destroyed outright, files included). Live and
    // unknown answer the same — the guard owns that rule.
    const scopeCheck = await requireTrashedProjectAccess(id, "destroy");
    if (scopeCheck.error) return scopeCheck.error;
    const existing = await findById(id);
    // Clean up the Cloudinary blobs before the DB rows cascade-delete —
    // otherwise the files are orphaned in Cloudinary forever.
    const files = await findPublicIdsByProject(id);
    await Promise.all(
      files.map((f) => destroyProjectFile(f.publicId, { deliveryType: f.deliveryType, resourceType: f.resourceType }))
    );
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
 * Brings a spreadsheet-edited cell back to the shape the schema validates:
 * dates JJ/MM/AAAA -> AAAA-MM-JJ, numbers with a decimal comma and thousands
 * spaces -> plain digits — in a ";" file (Excel FR); a "," file follows the
 * English conventions (lib/csv.ts). Done BEFORE the schema, which stays
 * strict (F9), and anything not understood is handed to it unchanged.
 */
function normalizeImportedValue(field: string, value: string, delimiter: CsvDelimiter): string {
  if (field === "startDate" || field === "endDate") return normalizeCsvDate(value, delimiter);
  if (field === "power" || field === "budget") return normalizeCsvNumber(value, delimiter);
  return value;
}

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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) {
    return { type: "error", message: areaCheck.error.message, created: 0, total: 0, errors: [] };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { type: "error", message: t.projects.messages.chooseCsvFile, created: 0, total: 0, errors: [] };
  }

  // See lib/csv.ts's MAX_IMPORT_* — adversarial pass 2, point 7. This is the
  // heaviest of the three importers (up to three sequential repository calls
  // per row: findByEmail, then — for a caller restricted to some projects
  // only — hasProjectAmong, then create).
  const upload = await readCsvUpload(file);
  if (!upload.ok) return csvRefusalResult(upload, t, t.projects.messages.emptyCsvFile);
  const { records, delimiter } = upload;

  let created = 0;
  const errors: ImportRowError[] = [];
  // The caller's access context, read ONCE for the whole file: it cannot
  // change between two rows, and re-reading it per row (session + account
  // lookup) multiplied the cost by the row count.
  const ctx = await getAccessContext();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNumber = i + 2;
    const clientEmail = record[CLIENT_EMAIL_HEADER];

    const data: Record<string, string> = {};
    for (const [header, value] of Object.entries(record)) {
      const field = HEADER_TO_FIELD[header];
      if (field && field !== "clientEmail" && !((field === "type" || field === "status") && value === "")) {
        data[field] = normalizeImportedValue(field, value, delimiter);
      }
    }

    try {
      const client = clientEmail ? await findByEmail(clientEmail) : null;
      if (!client) {
        throw new Error(t.projects.messages.unknownClientEmail);
      }
      // A company the caller cannot reach reads exactly like an unknown
      // email: a distinct refusal would let a CSV probe which addresses are
      // companies. One in the trash that the caller DOES reach says so — the
      // actionable answer (restore it) — and tells a caller inside the scope
      // nothing new. findByEmail already returned the row (and its
      // deletedAt), so nothing is read again here.
      const scopeCheck = await requireClientAccessWithin(ctx, client);
      if (scopeCheck.error) {
        throw new Error(scopeRefusalMessage(scopeCheck, t.projects.messages.unknownClientEmail));
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

export async function getProject(id: number) {
  const roleCheck = await requireRole("VIEWER");
  if (roleCheck.error) return roleCheck.error;
  // Passe 3b, point 1: an EDITOR whose function hides "projects" (and
  // "clients") could still pull the full chantier row — budget/notes
  // included, the two fields the client portail deliberately never exposes
  // (app/portail/projets/[projectId]/page.tsx) — straight off this action.
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.projects.messages.invalidId };
    }
    const project = await findById(id);
    // A trashed project — or one whose company is trashed, the same rule
    // requireProjectAccess freezes its content on — is invisible to the
    // normal detail page (looks like "not found"); the trash page reads the
    // repository directly instead. A
    // project outside the caller's scope reads the same way — a distinct
    // response would confirm it exists to someone who shouldn't know that.
    const access = await getAccessContext();
    const visible = project && !projectTrashState(project).inTrash && canReachProject(access, project.id);
    return { type: "success" as const, data: visible ? project : null };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
