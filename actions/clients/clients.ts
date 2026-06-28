"use server";
import { createClient } from "@/service/clients";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { uploadClientPhoto } from "@/lib/cloudinary";
import { CreateClientInput, UpdateClientInput } from "@/schemas/client";
import { findById, remove, update } from "@/repository/clients";
import { revalidatePath } from "next/cache";
import type { ClientActionState } from "@/types/client";

export async function addClient(
  prevState: ClientActionState,
  formData: FormData
): Promise<ClientActionState> {
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
    // Only upload (and overwrite) the photo when a new file was picked.
    const photoUrl = await extractPhotoUrl(formData);
    const client = await update({ ...clientDatas, id, photoUrl });
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

export async function deleteClient(id: number) {
  try {
    if (isNaN(id)) {
      throw {
        type: "error",
        message: "Invalid client ID",
      };
    }
    const client = await remove(id);
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
