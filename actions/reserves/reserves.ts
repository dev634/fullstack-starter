"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createReserveSchema, updateReserveSchema, updateReserveStatusStyleSchema } from "@/schemas/reserve";
import {
  create as createReserve,
  update as updateReserveRow,
  remove as removeReserve,
  findProjectId as findReserveProjectId,
} from "@/repository/reserves";
import { updateReserveStatusStyle as updateReserveStatusStyleRow } from "@/repository/projects";
import { create as createPlan, findById as findPlanById, remove as removePlan, setFolder as setPlanFolder } from "@/repository/reservePlans";
import {
  create as createFolder,
  remove as removeFolder,
  findProjectId as findReserveFolderProjectId,
} from "@/repository/reservePlanFolders";
import {
  create as createPhoto,
  findById as findPhotoById,
  remove as removePhoto,
  findProjectId as findPhotoProjectId,
} from "@/repository/reservePhotos";
import { uploadReservePlan, destroyReservePlan, uploadReservePhoto, destroyReservePhoto } from "@/lib/cloudinary";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ReservePlanActionState, ReserveActionState, ReserveStatusStyleActionState } from "@/types/reserve";

function projectPath(clientId: number, projectId: number) {
  return `/clients/${clientId}/projects/${projectId}`;
}

/**
 * Every réserve/plan/folder mutation invalidates both the project hub (its
 * Réserves link card shows a plan count + open tally, both derived straight
 * from this data — repository/reservePlans.ts::countByProject and
 * repository/reserves.ts::tallyByProject) AND the dedicated réserves page
 * (`.../reserves`), which now owns the actual list/viewer this data feeds.
 * Applied uniformly to every mutation in this file rather than special-cased
 * per call site (e.g. a folder create/delete never changes the hub's plan
 * count or tally): a stale réserves page is a silent defect exactly of the
 * kind this refactor exists to close, and telling ALL eleven call sites
 * apart correctly is a standing invitation to miss one the day a mutation's
 * effect on the counters changes.
 */
function revalidateReserves(clientId: number, projectId: number) {
  const base = projectPath(clientId, projectId);
  revalidatePath(base);
  revalidatePath(`${base}/reserves`);
}

/** Upload a PDF plan for a project and store it (ADMIN). */
export async function addReservePlan(
  prevState: ReservePlanActionState,
  formData: FormData
): Promise<ReservePlanActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const projectId = Number(formData.get("projectId"));
  const clientId = Number(formData.get("clientId"));
  const file = formData.get("file");
  const rawName = (formData.get("name")?.toString() ?? "").trim();

  if (isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: t.errors.invalidId };
  }
  const scopeCheck = await requireProjectAccess(projectId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.reserves.messages.chooseFile };
  }

  const rawFolderId = Number(formData.get("folderId"));
  const folderId = Number.isInteger(rawFolderId) && rawFolderId > 0 ? rawFolderId : null;

  // The `<select>` only ever lists this project's own folders — but nothing
  // server-side checked that before, so a submitted folderId from another
  // project silently filed the plan there, invisible in both projects' plan
  // lists (which filter by projectId AND by folder). Same pattern already
  // used for a folder's parentId in addReserveFolder, below.
  if (folderId != null && (await findReserveFolderProjectId(folderId)) !== projectId) {
    return { ...prevState, type: "error", message: t.errors.invalidId };
  }

  try {
    const { url, publicId, deliveryType, resourceType, format, version } = await uploadReservePlan(file, projectId);
    const name = rawName || file.name.replace(/\.pdf$/i, "") || "Plan";
    const plan = await createPlan({
      projectId,
      name,
      url,
      publicId,
      deliveryType,
      resourceType,
      format,
      version,
      folderId,
    });
    revalidateReserves(clientId, projectId);
    return { ...prevState, type: "success", message: t.reserves.messages.planAdded, data: plan };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError, t) };
  }
}

/** Create a folder to organise a project's reserve plans (content.edit). */
export async function addReserveFolder(
  name: string,
  clientId: number,
  projectId: number,
  parentId?: number | null
) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return { type: "error" as const, message: t.errors.validationError };
    if (!Number.isInteger(projectId) || projectId <= 0) return { type: "error" as const, message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(projectId);
    if (scopeCheck.error) return scopeCheck.error;

    // A parent, if given, must belong to THIS project — otherwise a stray id
    // could graft a folder under another project's tree.
    let validParentId: number | null = null;
    if (parentId != null) {
      if (!Number.isInteger(parentId) || parentId <= 0) return { type: "error" as const, message: t.errors.invalidId };
      if ((await findReserveFolderProjectId(parentId)) !== projectId) {
        return { type: "error" as const, message: t.errors.invalidId };
      }
      validParentId = parentId;
    }

    const folder = await createFolder({ projectId, name: trimmed, parentId: validParentId });
    revalidateReserves(clientId, projectId);
    return { type: "success" as const, message: t.reserves.messages.folderAdded, data: folder };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a folder; its plans fall back to the project root (content.edit). */
export async function deleteReserveFolder(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(id) || id <= 0) return { type: "error" as const, message: t.errors.invalidId };
    const realProjectId = await findReserveFolderProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2: a folder that exists but sits outside the caller's
    // scope must read exactly like one that doesn't exist at all — both are
    // resolved from THIS id via the database, so a distinct "forbidden"
    // response here would let a restricted EDITOR enumerate ids across the
    // whole company just from the response shape (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { type: "error" as const, message: t.errors.invalidId };
    const folder = await removeFolder(id, realProjectId);
    revalidateReserves(clientId, projectId);
    return { type: "success" as const, message: t.reserves.messages.folderDeleted, data: folder };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Move a plan into a folder (or back to the root when folderId is null). */
export async function moveReservePlan(planId: number, folderId: number | null, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (!Number.isInteger(planId) || planId <= 0) return { type: "error" as const, message: t.errors.invalidId };
    const plan = await findPlanById(planId);
    if (!plan) return { type: "error" as const, message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(plan.projectId);
    // Passe 3b, point 2 — see deleteReserveFolder's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.errors.invalidId };
    await setPlanFolder(planId, folderId, plan.projectId);
    revalidateReserves(clientId, projectId);
    return { type: "success" as const, message: t.reserves.messages.planMoved };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a plan (and its réserves) + its Cloudinary asset (ADMIN). */
export async function deleteReservePlan(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.errors.invalidId };
    const existing = await findPlanById(id);
    if (!existing) return { type: "error" as const, message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(existing.projectId);
    // Passe 3b, point 2 — see deleteReserveFolder's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.errors.invalidId };
    const plan = await removePlan(id);
    await destroyReservePlan(existing);
    revalidateReserves(clientId, projectId);
    return { type: "success" as const, message: t.reserves.messages.planDeleted, data: plan };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Drop a réserve pin on a plan (ADMIN). */
export async function addReserve(
  prevState: ReserveActionState,
  formData: FormData
): Promise<ReserveActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const projectId = Number(formData.get("projectId"));
  const parsed = createReserveSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const plan = await findPlanById(parsed.data.planId);
    if (!plan) return { ...prevState, type: "error", message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(plan.projectId);
    // Passe 3b, point 2 — see deleteReserveFolder's comment above.
    if (scopeCheck.error) return { ...prevState, type: "error", message: t.errors.invalidId };
    const reserve = await createReserve(parsed.data);
    revalidateReserves(clientId, projectId);
    return { ...prevState, type: "success", message: t.reserves.messages.added, data: reserve };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Edit a réserve's description / status / GPS (ADMIN). */
export async function updateReserve(
  prevState: ReserveActionState,
  formData: FormData
): Promise<ReserveActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const projectId = Number(formData.get("projectId"));
  const parsed = updateReserveSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const realProjectId = await findReserveProjectId(parsed.data.id);
    if (realProjectId === null) return { ...prevState, type: "error", message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see deleteReserveFolder's comment above.
    if (scopeCheck.error) return { ...prevState, type: "error", message: t.errors.invalidId };
    const reserve = await updateReserveRow(parsed.data.id, parsed.data);
    revalidateReserves(clientId, projectId);
    return { ...prevState, type: "success", message: t.reserves.messages.updated, data: reserve };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Attach a photo to a réserve (ADMIN). */
export async function addReservePhoto(
  prevState: ReserveActionState,
  formData: FormData
): Promise<ReserveActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const projectId = Number(formData.get("projectId"));
  const reserveId = Number(formData.get("reserveId"));
  const file = formData.get("file");

  if (isNaN(reserveId) || isNaN(projectId) || isNaN(clientId)) {
    return { ...prevState, type: "error", message: t.reserves.messages.invalidId };
  }
  const realProjectId = await findReserveProjectId(reserveId);
  if (realProjectId === null) return { ...prevState, type: "error", message: t.reserves.messages.invalidId };
  const scopeCheck = await requireProjectAccess(realProjectId);
  // Passe 3b, point 2 — see deleteReserveFolder's comment above.
  if (scopeCheck.error) return { ...prevState, type: "error", message: t.reserves.messages.invalidId };
  if (!(file instanceof File) || file.size === 0) {
    return { ...prevState, type: "error", message: t.reserves.messages.choosePhoto };
  }

  try {
    const { url, publicId, deliveryType, resourceType, format, version } = await uploadReservePhoto(
      file,
      realProjectId
    );
    const photo = await createPhoto({ reserveId, url, publicId, deliveryType, resourceType, format, version });
    revalidateReserves(clientId, projectId);
    return { ...prevState, type: "success", message: t.reserves.messages.photoAdded, data: photo };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError, t) };
  }
}

/** Delete a réserve photo + its Cloudinary asset (ADMIN). */
export async function deleteReservePhoto(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.reserves.messages.invalidId };
    const realProjectId = await findPhotoProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.reserves.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see deleteReserveFolder's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.reserves.messages.invalidId };
    const existing = await findPhotoById(id);
    const photo = await removePhoto(id);
    await destroyReservePhoto(existing);
    revalidateReserves(clientId, projectId);
    return { type: "success" as const, message: t.reserves.messages.photoDeleted, data: photo };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Delete a réserve (ADMIN). */
export async function deleteReserve(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.reserves.messages.invalidId };
    const realProjectId = await findReserveProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.reserves.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see deleteReserveFolder's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.reserves.messages.invalidId };
    const reserve = await removeReserve(id);
    revalidateReserves(clientId, projectId);
    return { type: "success" as const, message: t.reserves.messages.deleted, data: reserve };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/**
 * Configure this project's OPEN/RESOLVED réserve status labels + colours
 * (the ReserveStatus enum itself never changes — see prisma/schema.prisma's
 * Project doc). Whoever may write on the project may set this: no new
 * capability, same content.edit gate as every other mutation in this file.
 *
 * `projectId` is used directly for requireProjectAccess, not resolved via a
 * separate lookup — unlike a child réserve/plan/photo above, this mutation's
 * target row IS the project the caller names, exactly the way updateProject
 * (actions/projects/projects.ts) checks `parsed.data.id`. There is no other
 * row whose real project this claim could diverge from.
 *
 * The integrator's screen (not built here) consumes this as a `useActionState`
 * form action, same shape as updateReserve above: fields `projectId`,
 * `clientId` (revalidatePath only), `openLabel`, `openColor`, `resolvedLabel`,
 * `resolvedColor` — an empty label/color field clears that value back to the
 * product default (see schemas/reserve.ts's updateReserveStatusStyleSchema).
 * Reading it back for display goes through
 * lib/reserveStatusStyle.ts::resolveReserveStatusStyle, not the raw columns.
 */
export async function updateReserveStatusStyle(
  prevState: ReserveStatusStyleActionState,
  formData: FormData
): Promise<ReserveStatusStyleActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("reserves");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const clientId = Number(formData.get("clientId"));
  const parsed = updateReserveStatusStyleSchema.safeParse(formDataToObject(formData));
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

  try {
    const project = await updateReserveStatusStyleRow(parsed.data.projectId, {
      openLabel: parsed.data.openLabel ?? null,
      openColor: parsed.data.openColor ?? null,
      resolvedLabel: parsed.data.resolvedLabel ?? null,
      resolvedColor: parsed.data.resolvedColor ?? null,
    });
    revalidateReserves(clientId, parsed.data.projectId);
    return { ...prevState, type: "success", message: t.reserves.messages.statusStyleUpdated, data: project };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}
