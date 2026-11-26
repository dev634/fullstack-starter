"use server";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { requireCapability, requireClientAccess, requireClientAccessWithin } from "@/lib/access";
import { scopeRefusalMessage } from "@/lib/scopeRefusal";
import { canAccessArea, requireAreaAccess } from "@/lib/areaAccess";
import { canRemoveContact } from "@/lib/contactPolicy";
import { getAccessContext, projectIdFilter, type AccessContext } from "@/lib/accessContext";
import { createContactSchema, updateContactSchema } from "@/schemas/contact";
import { create, update, setPrimary, remove, setContactProjects, findLinkedProjectIds, findById as findContactById } from "@/repository/contacts";
import { findByEmail } from "@/repository/clients";
import type { Contact } from "@/app/generated/prisma/client";
import { findAllOptions as findAllJobFunctions } from "@/repository/jobFunctions";
import { readCsvUpload, csvHeaderOf, CONTACT_CSV_COLUMNS } from "@/lib/csv";
import { csvRefusalResult } from "@/lib/csvRefusal";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import type { ContactActionState } from "@/types/contact";
import type { ImportResult, ImportRowError } from "@/actions/clients/clients";

type ContactInScope =
  | { contact: Contact; ctx: AccessContext }
  | { contact: null; message: string };

/**
 * A contact the caller may act on, resolved from the database by id, with the
 * access context read once for it (the caller reuses it rather than reading
 * it again) — or the message to answer instead. "Absent" and "its company is
 * out of the caller's scope" both answer `invalidId`: a distinct refusal for
 * the out-of-scope case would let a forged id map which contacts exist (same
 * rule as actions/portal/portal.ts::createPortalLogin). A company in the
 * trash is only ever reported to a caller already inside its scope, so that
 * one keeps its own message (lib/scopeRefusal.ts).
 */
async function findContactInScope(id: number, invalidId: string): Promise<ContactInScope> {
  const contact = await findContactById(id);
  if (!contact) return { contact: null, message: invalidId };
  const ctx = await getAccessContext();
  const scopeCheck = await requireClientAccess(contact.clientId, ctx);
  if (scopeCheck.error) return { contact: null, message: scopeRefusalMessage(scopeCheck, invalidId) };
  return { contact, ctx };
}

export async function addContact(
  prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return { ...prevState, ...roleCheck.error };
  const areaCheck = await requireAreaAccess("clients.contacts");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = createContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  const scopeCheck = await requireClientAccess(parsed.data.clientId);
  if (scopeCheck.error) return { ...prevState, ...scopeCheck.error };

  try {
    await create(parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { ...prevState, type: "success", message: t.contacts.messages.added };
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
  const areaCheck = await requireAreaAccess("clients.contacts");
  if (areaCheck.error) return { ...prevState, ...areaCheck.error };

  const t = getDictionary(await getLocale());
  const parsed = updateContactSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { ...prevState, type: "zodError", message: t.errors.validationError, fieldsForm: makeObjectFromZodError(parsed.error, t) };
  }

  try {
    const found = await findContactInScope(parsed.data.id, t.contacts.messages.invalidId);
    if (!found.contact) return { ...prevState, type: "error", message: found.message };
    await update(parsed.data.id, parsed.data);
    // Portal project links (checkbox group) — only for a caller who reaches the
    // `projects` rubrique: what the portal shows IS that rubrique's content
    // (lib/accountPolicy.ts::PORTAL_EXPOSED_AREAS), so linking projects to a
    // contact is a way of exposing them. Without it the links are left as they
    // are (absent, not emptied): the form is not offered the checkboxes, and
    // would otherwise send an empty set that wipes them.
    // For a caller who does: the repository only touches the links THIS caller
    // can edit — live projects of the contact's company inside the caller's
    // scope, computed server-side from `scope` — and keeps every other link as
    // it is. The form only ever shows that set, so saving must not erase what
    // it never displayed, nor link a project the caller cannot reach.
    if (await canAccessArea("projects")) {
      const projectIds = formData
        .getAll("projectIds")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0);
      await setContactProjects(parsed.data.id, projectIds, projectIdFilter(found.ctx));
    }
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { ...prevState, type: "success", message: t.contacts.messages.updated };
  } catch (error) {
    return { ...prevState, type: "error", message: getErrorMessage(error, t.errors.serverError) };
  }
}

const PRIMARY_TRUE = /^(true|1|yes|oui)$/i;

// Headers come from CONTACT_CSV_COLUMNS, the list the export writes — one
// source, so the two can't drift.
const HEADER = {
  companyEmail: csvHeaderOf(CONTACT_CSV_COLUMNS, "companyEmail"),
  firstName: csvHeaderOf(CONTACT_CSV_COLUMNS, "firstName"),
  lastName: csvHeaderOf(CONTACT_CSV_COLUMNS, "lastName"),
  role: csvHeaderOf(CONTACT_CSV_COLUMNS, "role"),
  email: csvHeaderOf(CONTACT_CSV_COLUMNS, "email"),
  phone: csvHeaderOf(CONTACT_CSV_COLUMNS, "phone"),
  isPrimary: csvHeaderOf(CONTACT_CSV_COLUMNS, "isPrimary"),
};

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
  const areaCheck = await requireAreaAccess("clients.contacts");
  if (areaCheck.error) {
    return { type: "error", message: areaCheck.error.message, created: 0, total: 0, errors: [] };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { type: "error", message: t.contacts.import.chooseCsvFile, created: 0, total: 0, errors: [] };
  }

  // See lib/csv.ts's MAX_IMPORT_* — adversarial pass 2, point 7.
  const upload = await readCsvUpload(file);
  if (!upload.ok) return csvRefusalResult(upload, t, t.contacts.import.emptyCsvFile);
  const { records } = upload;

  let created = 0;
  const errors: ImportRowError[] = [];
  const touchedClientIds = new Set<number>();

  // Resolve the free-text "Role"/"Fonction" column to a managed job function
  // by name (case-insensitive). Unknown names are left empty rather than
  // creating new functions — the managed list stays the single source of truth.
  const jobFunctions = await findAllJobFunctions();
  const fnIdByName = new Map(jobFunctions.map((f) => [f.name.trim().toLowerCase(), f.id]));
  // The caller's access context, read ONCE for the whole file: it cannot
  // change between two rows, and re-reading it per row (session + account
  // lookup) multiplied the cost by the row count.
  const ctx = await getAccessContext();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const companyEmail = (record[HEADER.companyEmail] ?? "").trim();

    try {
      if (!companyEmail) throw { type: "error", message: t.contacts.import.missingCompanyEmail };
      const org = await findByEmail(companyEmail);
      if (!org) throw { type: "error", message: t.contacts.import.unknownCompanyEmail };
      // Out of scope reads exactly like an unknown email: a distinct refusal
      // would let a CSV probe which addresses are companies. A company in the
      // trash that the caller DOES reach says so — it is the actionable answer
      // (restore it), and tells a caller inside the scope nothing new.
      const scopeCheck = await requireClientAccessWithin(ctx, org);
      if (scopeCheck.error) {
        throw { type: "error", message: scopeRefusalMessage(scopeCheck, t.contacts.import.unknownCompanyEmail) };
      }

      const isPrimary = PRIMARY_TRUE.test((record[HEADER.isPrimary] ?? "").trim());
      const parsed = createContactSchema.safeParse({
        clientId: org.id,
        firstName: (record[HEADER.firstName] ?? "").trim(),
        lastName: (record[HEADER.lastName] ?? "").trim(),
        jobFunctionId: fnIdByName.get((record[HEADER.role] ?? "").trim().toLowerCase()) ?? undefined,
        email: (record[HEADER.email] ?? "").trim() || undefined,
        phone: (record[HEADER.phone] ?? "").trim() || undefined,
      });
      if (!parsed.success) throw { type: "error", message: t.contacts.import.invalidRow };

      await create({ ...parsed.data, isPrimary });
      touchedClientIds.add(org.id);
      created++;
    } catch (error) {
      errors.push({
        row: rowNumber,
        email: companyEmail || record[HEADER.email],
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
  const areaCheck = await requireAreaAccess("clients.contacts");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id) || isNaN(clientId)) throw { type: "error", message: t.contacts.messages.invalidId };
    const found = await findContactInScope(id, t.contacts.messages.invalidId);
    if (!found.contact) return { type: "error" as const, message: found.message };
    await setPrimary(id, found.contact.clientId);
    revalidatePath(`/clients/${found.contact.clientId}`);
    return { type: "success" as const, message: t.contacts.messages.primaryUpdated };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}

/** Bare action — deletes a contact and revalidates the client detail page. */
export async function deleteContact(id: number, clientId: number) {
  const roleCheck = await requireCapability("content.edit");
  if (roleCheck.error) return roleCheck.error;
  const areaCheck = await requireAreaAccess("clients.contacts");
  if (areaCheck.error) return areaCheck.error;

  const t = getDictionary(await getLocale());
  try {
    if (isNaN(id)) throw { type: "error", message: t.contacts.messages.invalidId };
    const found = await findContactInScope(id, t.contacts.messages.invalidId);
    if (!found.contact) return { type: "error" as const, message: found.message };
    // Deleting a contact also deletes its portal login (repository remove),
    // which cuts the client's access to EVERY project the contact is linked
    // to. Reaching the company is not enough to do that: a restricted caller
    // needs ALL the links (trash included) inside its own scope, otherwise
    // the answer is the one for an absent contact. Unrestricted: unchanged.
    const scope = found.ctx.projectIds;
    if (scope !== null) {
      // null = the contact vanished since it was resolved above: the same
      // answer as an absent one, never "no links, so allowed".
      const linked = await findLinkedProjectIds(id);
      if (linked === null || !canRemoveContact(linked, scope)) {
        return { type: "error" as const, message: t.contacts.messages.invalidId };
      }
    }
    await remove(id);
    revalidatePath(`/clients/${clientId}`);
    return { type: "success" as const, message: t.contacts.messages.deleted };
  } catch (error) {
    return { type: "error" as const, message: getErrorMessage(error, t.errors.serverError) };
  }
}
