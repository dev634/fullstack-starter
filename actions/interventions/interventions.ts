"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability } from "@/lib/access";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createInterventionSchema, updateInterventionSchema, interventionStatusSchema } from "@/schemas/intervention";
import { create, update, updateStatus, remove } from "@/repository/interventions";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { InterventionActionState } from "@/types/intervention";

export async function addIntervention(
  prevState: InterventionActionState,
  formData: FormData
): Promise<InterventionActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("interventions");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createInterventionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const intervention = await create({
      projectId: parsed.data.projectId,
      scheduledAt: parsed.data.scheduledAt,
      description: parsed.data.description,
      technician: parsed.data.technician,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.interventions.messages.added,
      data: intervention,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function editIntervention(
  prevState: InterventionActionState,
  formData: FormData
): Promise<InterventionActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const sectionCheck = await requireSectionAccess("interventions");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = updateInterventionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const intervention = await update(parsed.data.id, {
      scheduledAt: parsed.data.scheduledAt,
      description: parsed.data.description,
      technician: parsed.data.technician,
      status: parsed.data.status,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.interventions.messages.updated,
      data: intervention,
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
 * Quick status change from the row's own select (not a form) — same
 * client/project-id-passed-explicitly pattern as tasks/toggleTask.
 */
export async function changeInterventionStatus(
  id: number,
  status: string,
  clientId: number,
  projectId: number
) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("interventions");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  const parsedStatus = interventionStatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { type: "error" as const, message: t.errors.invalidValue };
  }

  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.interventions.messages.invalidId };
    }
    const intervention = await updateStatus(id, parsedStatus.data);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.interventions.messages.updated, data: intervention };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function deleteIntervention(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const sectionCheck = await requireSectionAccess("interventions");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.interventions.messages.invalidId };
    }
    const intervention = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.interventions.messages.deleted, data: intervention };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
