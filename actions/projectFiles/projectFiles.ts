"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability } from "@/lib/access";
import { createFolderSchema } from "@/schemas/projectFile";
import {
  create as createFolder,
  remove as removeFolder,
  collectDescendantFilePublicIds,
} from "@/repository/projectFolders";
import { create as createFile, remove as removeFile, findById as findFileById } from "@/repository/projectFiles";
import { uploadProjectFile, destroyProjectFile } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ProjectFileActionState } from "@/types/projectFile";

export async function addFolder(
  prevState: ProjectFileActionState,
  formData: FormData
): Promise<ProjectFileActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createFolderSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
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
      message: t.files.messages.folderCreated,
      data: folder,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function uploadFile(
  prevState: ProjectFileActionState,
  formData: FormData
): Promise<ProjectFileActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const projectId = Number(formData.get("projectId"));
  const clientId = Number(formData.get("clientId"));
  const folderIdRaw = formData.get("folderId");
  const folderId = folderIdRaw ? Number(folderIdRaw) : null;
  const file = formData.get("file");

  if (isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: t.files.messages.invalidProject };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.files.messages.chooseFileToUpload };
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
      message: t.files.messages.fileUploaded,
      data: record,
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
 * Delete/deleteFolder take the client id and project id explicitly (rather
 * than looking them up) so the caller — a bare button, not a form — can
 * revalidate the right project detail page without an extra round trip.
 */
export async function deleteFile(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.files.messages.invalidFileId };
    }
    const file = await findFileById(id);
    if (!file) {
      throw { type: "error", message: t.files.messages.fileNotFound };
    }
    await destroyProjectFile(file.publicId, file.mimeType);
    await removeFile(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.files.messages.fileDeleted };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function deleteFolder(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.files.messages.invalidFolderId };
    }
    const files = await collectDescendantFilePublicIds(projectId, id);
    await Promise.all(files.map((f) => destroyProjectFile(f.publicId, f.mimeType)));
    await removeFolder(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.files.messages.folderDeleted };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
