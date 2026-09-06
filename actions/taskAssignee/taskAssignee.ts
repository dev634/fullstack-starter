"use server";
import { getErrorMessage } from "@/lib/helpers";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { parseAssignee, ASSIGNEE_TARGET_KINDS, type AssigneeTargetKind } from "@/schemas/taskAssignee";
import { setAssignee as setTaskAssigneeRepo, findProjectId as findTaskProjectId } from "@/repository/tasks";
import { setAssignee as setGroupAssigneeRepo, findProjectId as findGroupProjectId } from "@/repository/taskGroups";
import { setAssignee as setCategoryAssigneeRepo, findProjectId as findCategoryProjectId } from "@/repository/taskCategories";
import { findCompanyProjectId } from "@/repository/subcontractors";
import { findProjectId as findInterimProjectId } from "@/repository/interims";
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
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("tasks");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  if (!ASSIGNEE_TARGET_KINDS.includes(targetKind)) {
    return { type: "error" as const, message: t.errors.invalidValue };
  }

  try {
    if (isNaN(targetId)) {
      throw { type: "error", message: t.errors.invalidId };
    }
    const realProjectId =
      targetKind === "task"
        ? await findTaskProjectId(targetId)
        : targetKind === "group"
          ? await findGroupProjectId(targetId)
          : await findCategoryProjectId(targetId);
    if (realProjectId === null) return { type: "error" as const, message: t.errors.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2: a target resolved from THIS id that sits outside
    // the caller's scope must read exactly like one that doesn't exist —
    // both are resolved from the database, so a distinct "forbidden"
    // response would let a restricted EDITOR enumerate ids across the whole
    // company (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { type: "error" as const, message: t.errors.invalidId };

    const parsed = parseAssignee(assignee);

    // The picker only ever lists this project's own subcontractor companies
    // / intérimaires — but nothing server-side checked that before, so a
    // submitted id from another project silently assigned a task to a
    // company/intérimaire that never appears anywhere in this project's UI.
    if (parsed.assignedCompanyId != null) {
      if ((await findCompanyProjectId(parsed.assignedCompanyId)) !== realProjectId) {
        return { type: "error" as const, message: t.errors.invalidId };
      }
    } else if (parsed.assignedInterimId != null) {
      if ((await findInterimProjectId(parsed.assignedInterimId)) !== realProjectId) {
        return { type: "error" as const, message: t.errors.invalidId };
      }
    }

    if (targetKind === "task") await setTaskAssigneeRepo(targetId, parsed);
    else if (targetKind === "group") await setGroupAssigneeRepo(targetId, parsed);
    else await setCategoryAssigneeRepo(targetId, parsed);

    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    revalidatePath(`/clients/${clientId}/projects/${projectId}/tasks`);
    return { type: "success" as const, message: t.assignees.messages.updated };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
