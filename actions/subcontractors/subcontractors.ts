"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createSubcontractorCompanySchema, addSubcontractorPersonSchema } from "@/schemas/subcontractor";
import { createCompany, removeCompany, addPerson, removePerson } from "@/repository/subcontractors";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { SubcontractorActionState } from "@/types/subcontractor";

export async function addSubcontractorCompany(
  prevState: SubcontractorActionState,
  formData: FormData
): Promise<SubcontractorActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = createSubcontractorCompanySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const company = await createCompany({ projectId: parsed.data.projectId, name: parsed.data.name });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.subcontractors.messages.companyAdded,
      data: company,
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
 * Deletes the company and, via cascade, every person under it. Takes the
 * client/project id explicitly (rather than looking them up) so the caller
 * — a bare button, not a form — can revalidate the right project page.
 */
export async function deleteSubcontractorCompany(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.subcontractors.messages.invalidId };
    }
    const company = await removeCompany(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.subcontractors.messages.companyDeleted, data: company };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function addSubcontractorPerson(
  prevState: SubcontractorActionState,
  formData: FormData
): Promise<SubcontractorActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const raw = formDataToObject(formData);
  const parsed = addSubcontractorPersonSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  try {
    const person = await addPerson({
      companyId: parsed.data.companyId,
      name: parsed.data.name,
      role: parsed.data.role,
      phone: parsed.data.phone,
    });
    revalidatePath(`/clients/${parsed.data.clientId}/projects/${parsed.data.projectId}`);
    return {
      ...prevState,
      type: "success",
      message: t.subcontractors.messages.personAdded,
      data: person,
    };
  } catch (error) {
    return {
      ...prevState,
      type: "error",
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}

export async function deleteSubcontractorPerson(id: number, clientId: number, projectId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) {
      throw { type: "error", message: t.subcontractors.messages.invalidId };
    }
    const person = await removePerson(id);
    revalidatePath(`/clients/${clientId}/projects/${projectId}`);
    return { type: "success" as const, message: t.subcontractors.messages.personDeleted, data: person };
  } catch (error) {
    return {
      type: "error" as const,
      message: getErrorMessage(error, t.errors.serverError),
    };
  }
}
