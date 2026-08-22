"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireProjectAccess } from "@/lib/access";
import { requireAreaAccess } from "@/lib/areaAccess";
import { requireSectionAccess } from "@/lib/sectionAccess";
import { createInterimSchema } from "@/schemas/interim";
import { create, remove, findProjectId as findInterimProjectId } from "@/repository/interims";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { InterimActionState } from "@/types/interim";

export async function addInterim(
  prevState: InterimActionState,
  formData: FormData
): Promise<InterimActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };
  const sectionCheck = await requireSectionAccess("interims");
  if (sectionCheck.error) return { ...prevState, ...sectionCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createInterimSchema.safeParse(raw);
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
    const interim = await create({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      jobFunctionId: parsed.data.jobFunctionId,
      agency: parsed.data.agency,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.interims.messages.added,
      data: interim,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function deleteInterim(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("projects");
  if (areaCheck.error) return areaCheck.error;
  const sectionCheck = await requireSectionAccess("interims");
  if (sectionCheck.error) return sectionCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.interims.messages.invalidId };
    }
    const realProjectId = await findInterimProjectId(id);
    if (realProjectId === null) return { type: "error" as const, message: t.interims.messages.invalidId };
    const scopeCheck = await requireProjectAccess(realProjectId);
    // Passe 3b, point 2: an intérimaire resolved from THIS id that sits
    // outside the caller's scope must read exactly like one that doesn't
    // exist — both are resolved from the database, so a distinct
    // "forbidden" response would let a restricted EDITOR enumerate ids
    // across the whole company (docs/CONVENTIONS.md).
    if (scopeCheck.error) return { type: "error" as const, message: t.interims.messages.invalidId };
    const interim = await remove(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.interims.messages.deleted, data: interim };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
