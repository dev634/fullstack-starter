"use server";
import { createClient } from "@/service/clients";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { uploadClientPhoto, destroyClientPhoto, destroyProjectFile } from "@/lib/cloudinary";
import { findPublicIdsByClient } from "@/repository/projectFiles";
import { requireSession, requireRole } from "@/lib/authz";
import { logActivity } from "@/repository/activity";
import { CreateClientInput, UpdateClientInput } from "@/schemas/client";
import { findById, softDelete, restore, permanentlyRemove, update } from "@/repository/clients";
import { parseCsvRecords, CLIENT_CSV_COLUMNS } from "@/lib/csv";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { ClientActionState } from "@/types/client";

const HEADER_TO_FIELD: Record<string, string> = Object.fromEntries(
  CLIENT_CSV_COLUMNS.map((c) => [c.header, c.key])
);

export async function addClient(
  prevState: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const roleCheck = await requireRole("EDITOR");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

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
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function getClient(id: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: t.errors.invalidId,
      };
    }

    const client = await findById(id);
    return {
      type: "success",
      // A trashed client is invisible to the normal detail page (looks like
      // "not found"); the trash page reads the repository directly instead.
      data: client?.deletedAt ? null : client,
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
  const roleCheck = await requireRole("EDITOR");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const clientDatas = formDataToObject(formData) as UpdateClientInput;
  try {
    if (!clientDatas.id) {
      return { type: "error", message: t.clients.messages.missingId };
    }
    const id = parseInt(clientDatas.id.toString(), 10);
    if (isNaN(id)) {
      throw {
        type: "error",
        message: t.errors.invalidId,
      };
    }

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
      message: getErrorMessage(error, t.errors.serverError),
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
  const roleCheck = await requireRole("EDITOR");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: t.errors.invalidId,
      };
    }
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
  const roleCheck = await requireRole("EDITOR");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    const valid = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (valid.length === 0) {
      return { type: "error" as const, message: t.clients.messages.noneSelected };
    }
    for (const id of valid) {
      const existing = await findById(id);
      await softDelete(id);
      await logActivity({
        action: "DELETED",
        clientId: id,
        clientName: existing?.companyName ?? `#${id}`,
        actorEmail: roleCheck.email,
      });
    }
    revalidatePath("/clients");
    return { type: "success" as const, message: format(t.clients.messages.deletedBulk, { count: valid.length }) };
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
  const roleCheck = await requireRole("EDITOR");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.errors.invalidId };
    }
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
  const roleCheck = await requireRole("EDITOR");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.errors.invalidId };
    }
    const existing = await findById(id);
    // Collect the project files BEFORE deleting the client — deleting cascades
    // through projects to files, so afterwards the rows (and their publicIds)
    // are gone and the Cloudinary blobs would be orphaned.
    const projectFiles = await findPublicIdsByClient(id);
    const client = await permanentlyRemove(id);
    await destroyClientPhoto(existing?.photoUrl);
    await Promise.all(projectFiles.map((f) => destroyProjectFile(f.publicId, f.mimeType)));
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
  const roleCheck = await requireRole("EDITOR");
  const t = getDictionary(await getLocale());
  if (roleCheck.error) {
    return { type: "error", message: roleCheck.error.message, created: 0, total: 0, errors: [] };
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
