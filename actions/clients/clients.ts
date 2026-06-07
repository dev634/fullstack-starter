"use server";
import { createClient } from "@/service/clients";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
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
    const client = await createClient({ ...clientDatas });
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
    const client = await update({ ...clientDatas, id });
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
