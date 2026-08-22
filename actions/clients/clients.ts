"use server";
import { createClient } from "@/service/clients";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { uploadClientPhoto, destroyClientPhoto, destroyProjectFile } from "@/lib/cloudinary";
import { findPublicIdsByClient } from "@/repository/projectFiles";
import { requireRole } from "@/lib/authz";
import { requireCapability, requireClientAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { getAccessContext } from "@/lib/accessContext";
import { hasProjectAmong } from "@/repository/projects";
import { logActivity } from "@/repository/activity";
import { CreateClientInput, updateClientSchema } from "@/schemas/client";
import { makeObjectFromZodError } from "@/lib/zod";
import { findById, softDelete, restore, permanentlyRemove, update } from "@/repository/clients";
import { parseCsvRecords, CLIENT_CSV_COLUMNS, MAX_IMPORT_ROWS } from "@/lib/csv";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { ClientActionState } from "@/types/client";

const HEADER_TO_FIELD: Record<string, string> = Object.fromEntries(
  CLIENT_CSV_COLUMNS.map((c) => [c.header, c.key])
);

/**
 * deleteClients (below) had no cap at all (adversarial pass 2, point 7):
 * `ids: number[]` straight off a forged client call, four repository round
 * trips per id in a loop. The grid this is called from (ClientsGrid) selects
 * from a single page of results (9 rows — app/clients/page.tsx's PAGE_SIZE),
 * so any real selection is nowhere near this; 200 mirrors MAX_SCAN_ITEMS
 * (schemas/deliveryNoteScan.ts) — this project's existing "generous but
 * bounded" convention for a batch operation — rather than inventing a new
 * number.
 */
const MAX_BULK_DELETE_IDS = 200;

export async function addClient(
  prevState: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const clientDatas = formDataToObject(formData) as CreateClientInput;

  try {
    const photoUrl = await extractPhotoUrl(formData);
    const client = await createClient({ ...clientDatas, photoUrl });
    await logActivity({
      action: "CREATED",
      clientId: client.data?.id ?? null,
      clientName: clientDatas.companyName,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/clients");
    return {
      ...prevState,
      type: "success",
      message: client.message,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      Object.keys(error).includes("type") &&
      Object.keys(error).includes("message") &&
      (error as { type?: unknown }).type === "zodError"
    ) {
      return {
        ...prevState,
        ...error,
      };
    }

    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError, t),
    };
  }
}

export async function getClient(id: number) {
  const roleCheck = await requireRole("VIEWER");
  if (roleCheck.error) return roleCheck.error;
  // Passe 3b, point 1: this used to only check the role, not the rubrique —
  // a function whose hiddenAreas hides "clients" could still read the full
  // company row (including fields the portail deliberately never exposes)
  // straight off this action. tests/authz-coverage.test.ts's READS allowlist
  // used to exempt this file's reads for exactly that reason; the exemption
  // is gone now that this guard actually exists.
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: t.errors.invalidId,
      };
    }

    const client = await findById(id);
    // A trashed client is invisible to the normal detail page (looks like
    // "not found"); the trash page reads the repository directly instead. A
    // client outside the caller's scope reads the same way — a distinct
    // response would confirm it exists to someone who shouldn't know that.
    const access = await getAccessContext();
    const reachable =
      access.projectIds === null || (await hasProjectAmong(id, [...access.projectIds]));
    const visible = client && !client.deletedAt && reachable;
    return {
      type: "success",
      data: visible ? client : null,
    };
  } catch (error) {
    console.log("Action getClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function updateClient(
  prevState: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  // Was previously `formDataToObject(formData) as UpdateClientInput` — a type
  // cast, not a parse. updateClientSchema was declared but never imported
  // anywhere in the app, so an update could write an invalid email or blank
  // required fields straight to the database (see adversarial pass 2, point
  // 1). Parsed here now, same zodError + fieldsForm shape as every other
  // action in this file/dépôt.
  const parsed = updateClientSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }
  const clientDatas = parsed.data;
  try {
    const id = clientDatas.id;
    const scopeCheck = await requireClientAccess(id);
    if (scopeCheck.error) return { type: "error", message: scopeCheck.error.message };

    const existing = await findById(id);
    // Resolve the new photo state: a freshly uploaded file wins; otherwise an
    // explicit removal sets it to null; otherwise leave the existing one.
    const uploadedUrl = await extractPhotoUrl(formData);
    const removePhoto = formData.get("removePhoto") === "true";
    let photoUrl: string | null | undefined = undefined;
    if (uploadedUrl) photoUrl = uploadedUrl;
    else if (removePhoto) photoUrl = null;

    const client = await update({
      ...clientDatas,
      id,
      phone: clientDatas.phone || null,
      website: clientDatas.website || null,
      photoUrl,
    });

    // Drop the previous asset once it has been replaced or removed.
    if (photoUrl !== undefined && existing?.photoUrl && existing.photoUrl !== photoUrl) {
      await destroyClientPhoto(existing.photoUrl);
    }

    await logActivity({
      action: "UPDATED",
      clientId: id,
      clientName: clientDatas.companyName,
      actorEmail: roleCheck.email,
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return {
      type: "success",
      message: t.clients.messages.updated,
      data: client,
    };
  } catch (error) {
    console.log("Action updateClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, t.errors.serverError, t),
    };
  }
}

/**
 * Pull the uploaded "photo" file out of the form and push it to Cloudinary.
 * Returns the resulting URL, or `undefined` when no new file was provided
 * (so callers can leave an existing photo untouched).
 */
async function extractPhotoUrl(formData: FormData): Promise<string | undefined> {
  const file = formData.get("photo");
  if (file instanceof File && file.size > 0) {
    return uploadClientPhoto(file);
  }
  return undefined;
}

/**
 * Move a client to the trash (reversible). The photo is kept untouched so a
 * restore doesn't lose it — it's only cleaned up on permanent deletion.
 */
export async function deleteClient(id: number) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: t.errors.invalidId,
      };
    }
    const scopeCheck = await requireClientAccess(id);
    if (scopeCheck.error) return { type: "error", message: scopeCheck.error.message };
    const existing = await findById(id);
    const client = await softDelete(id);
    await logActivity({
      action: "DELETED",
      clientId: id,
      clientName: existing?.companyName ?? `#${id}`,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/clients");
    return client;
  } catch (error) {
    console.log("Action deleteClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/**
 * Move several clients to the trash at once (bulk selection). Returns a
 * success/error payload for the caller.
 */
export async function deleteClients(ids: number[]) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    const valid = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (valid.length === 0) {
      return { type: "error" as const, message: t.clients.messages.noneSelected };
    }
    if (valid.length > MAX_BULK_DELETE_IDS) {
      return {
        type: "error" as const,
        message: format(t.errors.tooManySelected, { count: valid.length, max: MAX_BULK_DELETE_IDS }),
      };
    }
    let deleted = 0;
    for (const id of valid) {
      // A client outside the caller's scope is silently skipped, not
      // errored — a restricted actor selecting a mixed batch must not be
      // able to tell which ids in it belonged to companies they can't reach.
      const scopeCheck = await requireClientAccess(id);
      if (scopeCheck.error) continue;
      const existing = await findById(id);
      await softDelete(id);
      await logActivity({
        action: "DELETED",
        clientId: id,
        clientName: existing?.companyName ?? `#${id}`,
        actorEmail: roleCheck.email,
      });
      deleted++;
    }
    revalidatePath("/clients");
    return { type: "success" as const, message: format(t.clients.messages.deletedBulk, { count: deleted }) };
  } catch (error) {
    console.log("Action deleteClients error:", error);
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/** Bring a trashed client back into the normal listings. */
export async function restoreClient(id: number) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.errors.invalidId };
    }
    const scopeCheck = await requireClientAccess(id);
    if (scopeCheck.error) return scopeCheck.error;
    const client = await restore(id);
    await logActivity({
      action: "RESTORED",
      clientId: id,
      clientName: client.companyName,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/clients");
    revalidatePath("/clients/trash");
    return { type: "success" as const, message: t.clients.messages.restored, data: client };
  } catch (error) {
    console.log("Action restoreClient error:", error);
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/**
 * Permanently delete a trashed client — irreversible. Cleans up the
 * Cloudinary photo, since there is no longer any way to restore it.
 */
export async function permanentlyDeleteClient(id: number) {
  const roleCheck = await requireCapability("content.trash");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.errors.invalidId };
    }
    const scopeCheck = await requireClientAccess(id);
    if (scopeCheck.error) return scopeCheck.error;
    const existing = await findById(id);
    // Collect the project files BEFORE deleting the client — deleting cascades
    // through projects to files, so afterwards the rows (and their publicIds)
    // are gone and the Cloudinary blobs would be orphaned.
    const projectFiles = await findPublicIdsByClient(id);
    const client = await permanentlyRemove(id);
    await destroyClientPhoto(existing?.photoUrl);
    await Promise.all(
      projectFiles.map((f) =>
        destroyProjectFile(f.publicId, { deliveryType: f.deliveryType, resourceType: f.resourceType })
      )
    );
    await logActivity({
      action: "PERMANENTLY_DELETED",
      clientId: id,
      clientName: existing?.companyName ?? `#${id}`,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/clients/trash");
    return { type: "success" as const, message: t.clients.messages.permanentlyDeleted, data: client };
  } catch (error) {
    console.log("Action permanentlyDeleteClient error:", error);
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
 * Bulk-create clients from a CSV file (same column headers as
 * /clients/export, so an exported file can be edited and re-imported).
 * Every row is validated independently — one bad row doesn't abort the
 * rest of the batch.
 */
export async function importClients(formData: FormData): Promise<ImportResult> {
  const roleCheck = await requireCapability("content.import");
  const t = getDictionary(await getLocale());
  if (roleCheck.error) {
    return { type: "error", message: roleCheck.error.message, created: 0, total: 0, errors: [] };
  }
  const areaCheck = await requireAreaAccess("clients");
  if (areaCheck.error) {
    return { type: "error", message: areaCheck.error.message, created: 0, total: 0, errors: [] };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { type: "error", message: t.clients.messages.chooseCsvFile, created: 0, total: 0, errors: [] };
  }

  const text = await file.text();
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return { type: "error", message: t.clients.messages.emptyCsvFile, created: 0, total: 0, errors: [] };
  }
  // No row-count limit before this (adversarial pass 2, point 7): the only
  // real ceiling was the 10 MB Server Action body cap, i.e. ~170 000 rows,
  // each costing its own repository round trip. See lib/csv.ts's
  // MAX_IMPORT_ROWS for the measured rationale.
  if (records.length > MAX_IMPORT_ROWS) {
    return {
      type: "error",
      message: format(t.errors.tooManyRows, { count: records.length, max: MAX_IMPORT_ROWS }),
      created: 0,
      total: records.length,
      errors: [],
    };
  }

  let created = 0;
  const errors: ImportRowError[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row

    const data: Record<string, string> = {};
    for (const [header, value] of Object.entries(record)) {
      const field = HEADER_TO_FIELD[header];
      // Blank status is omitted so the schema's default("PROSPECT") applies,
      // instead of failing enum validation on an empty string.
      if (field && !(field === "status" && value === "")) {
        data[field] = value;
      }
    }

    try {
      await createClient(data as unknown as CreateClientInput);
      created++;
    } catch (error) {
      errors.push({
        row: rowNumber,
        email: record.Email,
        message: getErrorMessage(error, t.clients.messages.invalidRow),
      });
    }
  }

  if (created > 0) {
    await logActivity({
      action: "IMPORTED",
      clientId: null,
      clientName: `${created} entreprise(s) via import CSV`,
      actorEmail: roleCheck.email,
    });
    revalidatePath("/clients");
  }

  return {
    type: created > 0 ? "success" : "error",
    message:
      errors.length === 0
        ? format(t.clients.messages.importedSuccess, { count: created })
        : format(t.clients.messages.importedPartial, { count: created, errors: errors.length }),
    created,
    total: records.length,
    errors,
  };
}
