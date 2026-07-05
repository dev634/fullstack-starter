"use server";
import { createClient } from "@/service/clients";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { uploadClientPhoto, destroyClientPhoto } from "@/lib/cloudinary";
import { auth } from "@/lib/auth";
import { CreateClientInput, UpdateClientInput } from "@/schemas/client";
import { findById, remove, update } from "@/repository/clients";
import { revalidatePath } from "next/cache";
import type { ClientActionState } from "@/types/client";

export async function addClient(
  prevState: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const unauthorized = await requireRole("ADMIN");
  if (unauthorized) return { ...prevState, ...unauthorized };

  const clientDatas = formDataToObject(formData) as CreateClientInput;

  try {
    const photoUrl = await extractPhotoUrl(formData);
    const client = await createClient({ ...clientDatas, photoUrl });
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
      message: getErrorMessage(error, "Server error adding client."),
    };
  }
}

export async function getClient(id: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: "Invalid client ID.",
      };
    }

    const client = await findById(id);
    return {
      type: "success",
      data: client,
    };
  } catch (error) {
    console.log("Action getClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, "Server error fetching client."),
    };
  }
}

export async function updateClient(
  prevState: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
  const unauthorized = await requireRole("ADMIN");
  if (unauthorized) return { ...prevState, ...unauthorized };

  const clientDatas = formDataToObject(formData) as UpdateClientInput;
  try {
    if (!clientDatas.id) {
      return { type: "error", message: "Missing client ID" };
    }
    const id = parseInt(clientDatas.id.toString(), 10);
    if (isNaN(id)) {
      throw {
        type: "error",
        message: "Invalid client ID",
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

    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return {
      type: "success",
      message: "Client updated successfully.",
      data: client,
    };
  } catch (error) {
    console.log("Action updateClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, "Server error updating client."),
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
 * Guard actions behind an authenticated session. Returns an error payload
 * when there is no session, or `null` when the caller may proceed. Server
 * actions are callable directly, so page-level middleware isn't enough.
 */
async function requireSession(): Promise<{ type: "error"; message: string } | null> {
  const session = await auth();
  if (!session) {
    return { type: "error", message: "Unauthorized. Please sign in." };
  }
  return null;
}

/**
 * Guard mutations behind a minimum role. VIEWER accounts can read but not
 * create/edit/delete clients.
 */
async function requireRole(role: "ADMIN"): Promise<{ type: "error"; message: string } | null> {
  const session = await auth();
  if (!session) {
    return { type: "error", message: "Unauthorized. Please sign in." };
  }
  if (session.user?.role !== role) {
    return { type: "error", message: "Forbidden. Your role does not allow this action." };
  }
  return null;
}

export async function deleteClient(id: number) {
  const unauthorized = await requireRole("ADMIN");
  if (unauthorized) return unauthorized;

  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: "Invalid client ID",
      };
    }
    const existing = await findById(id);
    const client = await remove(id);
    // Clean up the client's photo from Cloudinary after a successful delete.
    await destroyClientPhoto(existing?.photoUrl);
    revalidatePath("/clients");
    return client;
  } catch (error) {
    console.log("Action deleteClient error:", error);
    return {
      type: "error",
      message: getErrorMessage(error, "Server error deleting client."),
    };
  }
}

/**
 * Delete several clients at once (bulk selection). Cleans up each client's
 * Cloudinary photo. Returns a success/error payload for the caller.
 */
export async function deleteClients(ids: number[]) {
  const unauthorized = await requireRole("ADMIN");
  if (unauthorized) return unauthorized;

  try {
    const valid = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (valid.length === 0) {
      return { type: "error" as const, message: "No client selected." };
    }
    for (const id of valid) {
      const existing = await findById(id);
      await remove(id);
      await destroyClientPhoto(existing?.photoUrl);
    }
    revalidatePath("/clients");
    return { type: "success" as const, message: `${valid.length} client(s) deleted.` };
  } catch (error) {
    console.log("Action deleteClients error:", error);
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error deleting clients."),
    };
  }
}
