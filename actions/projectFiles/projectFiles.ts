"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createFolderSchema } from "@/schemas/projectFile";
import {
  create as createFolder,
  remove as removeFolder,
  collectDescendantFilePublicIds,
} from "@/repository/projectFolders";
import { create as createFile, remove as removeFile, findById as findFileById } from "@/repository/projectFiles";
import { uploadProjectFile, destroyProjectFile } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import type { ProjectFileActionState } from "@/types/projectFile";

export async function addFolder(
  prevState: ProjectFileActionState,
  formData: FormData
): Promise<ProjectFileActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const raw = formDataToObject(formData);
  const parsed = createFolderSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: "Validation error. Please check your input and try again.",
      fieldsForm: makeObjectFromZodError(parsed.error),
    };
  }

  try {
    const folder = await createFolder({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? null,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: "Folder created.",
      data: folder,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, "Server error creating folder."),
    };
  }
}

export async function uploadFile(
  prevState: ProjectFileActionState,
  formData: FormData
): Promise<ProjectFileActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const projectId = Number(formData.get("projectId"));
  const clientId = Number(formData.get("clientId"));
  const folderIdRaw = formData.get("folderId");
  const folderId = folderIdRaw ? Number(folderIdRaw) : null;
  const file = formData.get("file");

  if (isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: "Invalid project." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: "Please choose a file to upload." };
  }

  try {
    const uploaded = await uploadProjectFile(file, projectId);
    const record = await createFile({
      projectId,
      folderId,
      name: file.name,
      url: uploaded.url,
      publicId: uploaded.publicId,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
    });
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return {
      ...prevState,
      type: "success",
      message: "File uploaded.",
      data: record,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, "Server error uploading file."),
    };
  }
}

/**
 * Delete/deleteFolder take the client id and project id explicitly (rather
 * than looking them up) so the caller — a bare button, not a form — can
 * revalidate the right project detail page without an extra round trip.
 */
export async function deleteFile(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  try {
    if (isNaN(id)) {
      throw { type: "error", message: "Invalid file ID" };
    }
    const file = await findFileById(id);
    if (!file) {
      throw { type: "error", message: "File not found." };
    }
    await destroyProjectFile(file.publicId, file.mimeType);
    await removeFile(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: "File deleted." };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error deleting file."),
    };
  }
}

export async function deleteFolder(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  try {
    if (isNaN(id)) {
      throw { type: "error", message: "Invalid folder ID" };
    }
    const files = await collectDescendantFilePublicIds(projectId, id);
    await Promise.all(files.map((f) => destroyProjectFile(f.publicId, f.mimeType)));
    await removeFolder(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: "Folder deleted." };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, "Server error deleting folder."),
    };
  }
}
