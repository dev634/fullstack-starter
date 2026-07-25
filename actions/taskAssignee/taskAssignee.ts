"use server";
import { getErrorMessage } from "@/lib/helpers";
import { requireCapability } from "@/lib/access";
import { parseAssignee, ASSIGNEE_TARGET_KINDS, type AssigneeTargetKind } from "@/schemas/taskAssignee";
import { setAssignee as setTaskAssigneeRepo } from "@/repository/tasks";
import { setAssignee as setGroupAssigneeRepo } from "@/repository/taskGroups";
import { setAssignee as setCategoryAssigneeRepo } from "@/repository/taskCategories";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Assigns (or clears) the subcontractor company / intérimaire handling a
 * task, series or category. `assignee` is the picker's one-field encoding
 * ("company:<id>", "interim:<id>", or "" to clear); the two kinds are
 * mutually exclusive by construction. Bare-dropdown call (not a form), so
 * client/project ids are passed explicitly to revalidate the right page —
 * same pattern as setTaskCategory.
 */
export async function setAssignee(
  targetKind: AssigneeTargetKind,
  targetId: number,
  assignee: string,
  clientId: number,
  projectId: number
) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  if (!ASSIGNEE_TARGET_KINDS.includes(targetKind)) {
    return { type: "error" as const, message: t.errors.invalidValue };
  }

  try {
    if (isNaN(targetId)) {
      throw { type: "error", message: t.errors.invalidId };
    }
    const parsed = parseAssignee(assignee);
    if (targetKind === "task") await setTaskAssigneeRepo(targetId, parsed);
    else if (targetKind === "group") await setGroupAssigneeRepo(targetId, parsed);
    else await setCategoryAssigneeRepo(targetId, parsed);

    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.assignees.messages.updated };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
