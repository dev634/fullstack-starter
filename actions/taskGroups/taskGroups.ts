"use server";
import { getErrorMessage } from "@/lib/helpers";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { remove, setCategory, findProjectId as findGroupProjectId } from "@/repository/taskGroups";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Assign (or clear, when categoryId is null) the category an existing
 * series belongs to — takes the client/project id explicitly (rather than
 * looking them up) so the caller can revalidate the right project page.
 */
export async function setTaskGroupCategory(
  id: number,
  categoryId: number | null,
  clientId: number,
  projectId: number
) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const realProjectId = await findGroupProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2: a group resolved from THIS id that sits outside the
    // caller's scope must read exactly like one that doesn't exist — both
    // are resolved from the database, so a distinct "forbidden" response
    // would let a restricted EDITOR enumerate ids across the whole company
    // (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const group = await setCategory(id, categoryId);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.tasks.messages.updated, data: group };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

/**
 * Delete an entire named series and, via cascade, every task in it. Takes
 * the client id and project id explicitly (rather than looking them up) so
 * the caller can revalidate the right project detail page.
 */
export async function deleteTaskGroup(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const realProjectId = await findGroupProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2 — see setTaskGroupCategory's comment above.
    if (scopeCheck.error) return { type: "error" as const, message: t.tasks.messages.invalidId };
    const group = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.tasks.group.messages.deleted, data: group };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
