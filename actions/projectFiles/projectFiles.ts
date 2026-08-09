"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createFolderSchema } from "@/schemas/projectFile";
import {
  create as createFolder,
  remove as removeFolder,
  findById as findFolderById,
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
  const sectionCheck = await requireSectionAccess("files");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

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

  const scopeCheck = await requireProjectAccess(parsed.data.projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  // The <select> only ever lists this project's own folders — but nothing
  // server-side verified that before, so a submitted parentId from another
  // project silently grafted the new folder under that project's tree,
  // invisible in both projects' listings (which filter by projectId AND by
  // parent). Same pattern already used for a folder's parentId in
  // addReserveFolder (actions/reserves/reserves.ts).
  if (parsed.data.parentId != null) {
    const parent = await findFolderById(parsed.data.parentId);
    if (!parent || parent.projectId !== parsed.data.projectId) {
      return { ...prevState, type: "error", message: t.files.messages.invalidFolderId };
    }
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
  const sectionCheck = await requireSectionAccess("files");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const projectId = Number(formData.get("projectId"));
  const clientId = Number(formData.get("clientId"));
  const folderIdRaw = formData.get("folderId");
  const parsedFolderId = folderIdRaw ? Number(folderIdRaw) : null;
  const folderId = parsedFolderId != null && Number.isInteger(parsedFolderId) && parsedFolderId > 0 ? parsedFolderId : null;
  const file = formData.get("file");

  if (isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: t.files.messages.invalidProject };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.files.messages.chooseFileToUpload };
  }
  const scopeCheck = await requireProjectAccess(projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  // The <select> only ever lists this project's own folders — but nothing
  // server-side verified that before, so a submitted folderId from another
  // project silently filed the upload there, invisible in both projects'
  // file listings (which filter by projectId AND by folder).
  if (folderId != null) {
    const folder = await findFolderById(folderId);
    if (!folder || folder.projectId !== projectId) {
      return { ...prevState, type: "error", message: t.files.messages.invalidFolderId };
    }
  }

  try {
    const uploaded = await uploadProjectFile(file, projectId);
    const record = await createFile({
      projectId,
      folderId,
      name: file.name,
      url: uploaded.url,
      publicId: uploaded.publicId,
      deliveryType: uploaded.deliveryType,
      resourceType: uploaded.resourceType,
      format: uploaded.format,
      version: uploaded.version,
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
  const sectionCheck = await requireSectionAccess("files");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.files.messages.invalidFileId };
    }
    const file = await findFileById(id);
    if (!file) {
      throw { type: "error", message: t.files.messages.fileNotFound };
    }
    const scopeCheck = await requireProjectAccess(file.projectId);
    // Passe 3b, point 2: a file resolved from THIS id that sits outside the
    // caller's scope must read exactly like one that doesn't exist — both
    // are resolved from the database, so a distinct "forbidden" response
    // would let a restricted EDITOR enumerate ids across the whole company
    // (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { type: "error" as const, message: t.files.messages.fileNotFound };
    await destroyProjectFile(file.publicId, { deliveryType: file.deliveryType, resourceType: file.resourceType });
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
  const sectionCheck = await requireSectionAccess("files");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.files.messages.invalidFolderId };
    }
    const folder = await findFolderById(id);
    if (!folder) throw { type: "error", message: t.files.messages.invalidFolderId };
    const scopeCheck = await requireProjectAccess(folder.projectId);
    // Passe 3b, point 2 — see deleteFile's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.files.messages.invalidFolderId };
    const files = await collectDescendantFilePublicIds(folder.projectId, id);
    await Promise.all(
      files.map((f) => destroyProjectFile(f.publicId, { deliveryType: f.deliveryType, resourceType: f.resourceType }))
    );
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
