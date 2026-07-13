"use server";
import { getErrorMessage } from "@/lib/helpers";
import { requireSession, requireRole } from "@/lib/authz";
import { findById, remove } from "@/repository/taskGroups";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function getTaskGroup(id: number) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
    const group = await findById(id);
    return { type: "success" as const, data: group };
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
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.tasks.messages.invalidId };
    }
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
