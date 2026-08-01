"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireClientAccess } from "@/lib/access";
import { createContactSchema, updateContactSchema } from "@/schemas/contact";
import { create, update, setPrimary, remove, setContactProjects, findById as findContactById } from "@/repository/contacts";
import { findByEmail } from "@/repository/clients";
import { findAll as findAllJobFunctions } from "@/repository/jobFunctions";
import { parseCsvRecords } from "@/lib/csv";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { ContactActionState } from "@/types/contact";
import type { ImportResult, ImportRowError } from "@/actions/clients/clients";

export async function addContact(
  prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = createContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  const scopeCheck = await requireClientAccess(parsed.data.clientId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

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
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = updateContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const existingContact = await findContactById(parsed.data.id);
    if (!existingContact) return { ...prevState, type: "error", message: t.contacts.messages.invalidId };
    const scopeCheck = await requireClientAccess(existingContact.clientId);
    if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };
    const contact = await update(parsed.data.id, parsed.data);
    // Portal project links (checkbox group) — the repository re-checks each id
    // belongs to this contact's company, so a tampered list can't cross tenants.
    const projectIds = formData
      .getAll("projectIds")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    await setContactProjects(parsed.data.id, projectIds);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { ...prevState, type: "success", message: t.contacts.messages.updated, data: contact };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

const PRIMARY_TRUE = /^(true|1|yes|oui)$/i;

/**
 * Bulk-create contacts from a CSV file (same column headers as
 * /clients/contacts/export). Each row is linked to an existing organisation by
 * its "Company Email" and validated independently — one bad row doesn't abort
 * the batch. Reuses the repository's primary-uniqueness handling.
 */
export async function importContacts(formData: FormData): Promise<ImportResult> {
  const roleCheck = await requireCapability("content.import");
  const t = getDictionary(await getLocale());
  if (roleCheck.error) {
    return { type: "error", message: roleCheck.error.message, created: 0, total: 0, errors: [] };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { type: "error", message: t.contacts.import.chooseCsvFile, created: 0, total: 0, errors: [] };
  }

  const records = parseCsvRecords(await file.text());
  if (records.length === 0) {
    return { type: "error", message: t.contacts.import.emptyCsvFile, created: 0, total: 0, errors: [] };
  }

  let created = 0;
  const errors: ImportRowError[] = [];
  const touchedClientIds = new Set<number>();

  // Resolve the free-text "Role"/"Fonction" column to a managed job function
  // by name (case-insensitive). Unknown names are left empty rather than
  // creating new functions — the managed list stays the single source of truth.
  const jobFunctions = await findAllJobFunctions();
  const fnIdByName = new Map(jobFunctions.map((f) => [f.name.trim().toLowerCase(), f.id]));

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const companyEmail = (record["Company Email"] ?? "").trim();

    try {
      if (!companyEmail) throw { type: "error", message: t.contacts.import.missingCompanyEmail };
      const org = await findByEmail(companyEmail);
      if (!org) throw { type: "error", message: t.contacts.import.unknownCompanyEmail };
      const scopeCheck = await requireClientAccess(org.id);
      if (scopeCheck.error) throw new Error(scopeCheck.error.message);

      const isPrimary = PRIMARY_TRUE.test((record["Primary"] ?? "").trim());
      const parsed = createContactSchema.safeParse({
        clientId: org.id,
        firstName: (record["First name"] ?? "").trim(),
        lastName: (record["Last name"] ?? "").trim(),
        jobFunctionId: fnIdByName.get((record["Role"] ?? "").trim().toLowerCase()) ?? undefined,
        email: (record["Email"] ?? "").trim() || undefined,
        phone: (record["Phone"] ?? "").trim() || undefined,
      });
      if (!parsed.success) throw { type: "error", message: t.contacts.import.invalidRow };

      await create({ ...parsed.data, isPrimary });
      touchedClientIds.add(org.id);
      created++;
    } catch (error) {
      errors.push({
        row: rowNumber,
        email: companyEmail || record["Email"],
        message: getErrorMessage(error, t.contacts.import.invalidRow),
      });
    }
  }

  if (created > 0) {
    revalidatePath("/clients");
    for (const clientId of touchedClientIds) revalidatePath(`/clients/${clientId}`);
  }

  return {
    type: created > 0 ? "success" : "error",
    message:
      errors.length === 0
        ? format(t.contacts.import.importedSuccess, { count: created })
        : format(t.contacts.import.importedPartial, { count: created, errors: errors.length }),
    created,
    total: records.length,
    errors,
  };
}

/** Bare action (called from a button, not a form) — makes a contact its client's primary. */
export async function setPrimaryContact(id: number, clientId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id) || isNaN(clientId)) throw { type: "error", message: t.contacts.messages.invalidId };
    const existingContact = await findContactById(id);
    if (!existingContact) return { type: "error" as const, message: t.contacts.messages.invalidId };
    const scopeCheck = await requireClientAccess(existingContact.clientId);
    if (scopeCheck.error) return scopeCheck.error;
    await setPrimary(id, existingContact.clientId);
    revalidatePath(`/clients/${existingContact.clientId}`);
    return { type: "success" as const, message: t.contacts.messages.primaryUpdated };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Bare action — deletes a contact and revalidates the client detail page. */
export async function deleteContact(id: number, clientId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.contacts.messages.invalidId };
    const existingContact = await findContactById(id);
    if (!existingContact) return { type: "error" as const, message: t.contacts.messages.invalidId };
    const scopeCheck = await requireClientAccess(existingContact.clientId);
    if (scopeCheck.error) return scopeCheck.error;
    const contact = await remove(id);
    revalidatePath(`/clients/${clientId}`);
    return { type: "success" as const, message: t.contacts.messages.deleted, data: contact };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
