"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireRole } from "@/lib/authz";
import { createContactSchema, updateContactSchema } from "@/schemas/contact";
import { create, update, setPrimary, remove } from "@/repository/contacts";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ContactActionState } from "@/types/contact";

export async function addContact(
  prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = createContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const contact = await create(parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { ...prevState, type: "success", message: t.contacts.messages.added, data: contact };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

export async function editContact(
  prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = updateContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const contact = await update(parsed.data.id, parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { ...prevState, type: "success", message: t.contacts.messages.updated, data: contact };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Bare action (called from a button, not a form) — makes a contact its client's primary. */
export async function setPrimaryContact(id: number, clientId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id) || isNaN(clientId)) throw { type: "error", message: t.contacts.messages.invalidId };
    await setPrimary(id, clientId);
    revalidatePath(`/clients/${clientId}`);
    return { type: "success" as const, message: t.contacts.messages.primaryUpdated };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Bare action — deletes a contact and revalidates the client detail page. */
export async function deleteContact(id: number, clientId: number) {
  const roleCheck = await requireRole("ADMIN");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.contacts.messages.invalidId };
    const contact = await remove(id);
    revalidatePath(`/clients/${clientId}`);
    return { type: "success" as const, message: t.contacts.messages.deleted, data: contact };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
