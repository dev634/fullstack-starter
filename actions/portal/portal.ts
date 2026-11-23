"use server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { requireCapability, requireClientAccess } from "@/lib/access";
import { scopeRefusalMessage } from "@/lib/scopeRefusal";
import { requireAreaAccess } from "@/lib/areaAccess";
import { getAccessContext } from "@/lib/accessContext";
import { mayProvisionPortalLogin } from "@/lib/accountPolicy";
import { getErrorMessage } from "@/lib/helpers";
import { findById as findContactById, attachLogin } from "@/repository/contacts";
import { create as createUser, createResetToken } from "@/repository/users";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

type PortalLoginResult = { ok: true; resetPath: string } | { ok: false; message: string };

// 24h for the client to set their first password from the one-time link.
const FIRST_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Provision a client-portal login for a contact: create a linked CLIENT user
 * (with a throwaway password) and a one-time reset token, returning the path
 * the admin sends the contact to choose their own password. Gated by
 * users.manage — creating an authenticated identity is a privileged action.
 * Refused to a restricted ADMIN whose function hides what the portal shows
 * (lib/accountPolicy.ts::mayProvisionPortalLogin): the portal is a relay.
 */
export async function createPortalLogin(contactId: number): Promise<PortalLoginResult> {
  const roleCheck = await requireCapability("users.manage");
  if (roleCheck.error) return { ok: false, message: roleCheck.error.message };
  // We create an account (admin.users), from the contacts screen
  // (clients.contacts): both rubriques must be visible to the caller.
  const usersArea = await requireAreaAccess("admin.users");
  if (usersArea.error) return { ok: false, message: usersArea.error.message };
  const contactsArea = await requireAreaAccess("clients.contacts");
  if (contactsArea.error) return { ok: false, message: contactsArea.error.message };

  const t = getDictionary(await getLocale());
  // The reset link below is handed back to the caller, who could then sign in
  // as this CLIENT and read the projects the contact is linked to.
  const ctx = await getAccessContext();
  if (!mayProvisionPortalLogin({ role: ctx.role, hiddenAreas: ctx.hiddenAreas })) {
    return { ok: false, message: t.portal.admin.restrictedCannotProvision };
  }
  try {
    if (!Number.isInteger(contactId) || contactId <= 0) return { ok: false, message: t.errors.invalidId };
    const contact = await findContactById(contactId);
    if (!contact) return { ok: false, message: t.errors.invalidId };
    // Defence in depth, with no effect today: an ADMIN is never restricted in
    // projects, so this never refuses one. What closes F3 are the two
    // rubriques checked above (admin.users and clients.contacts). Out of
    // scope answers exactly like "not found" (no existence oracle).
    const scopeCheck = await requireClientAccess(contact.clientId);
    if (scopeCheck.error) return { ok: false, message: scopeRefusalMessage(scopeCheck, t.errors.invalidId) };
    if (!contact.email) return { ok: false, message: t.portal.admin.emailRequired };
    if (contact.userId) return { ok: false, message: t.portal.admin.alreadyHasLogin };

    const password = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
    const name = `${contact.firstName} ${contact.lastName}`.trim() || null;
    const user = await createUser({ email: contact.email, name, role: "CLIENT", password }, null);
    await attachLogin(contactId, user.id);

    const token = randomBytes(32).toString("hex");
    await createResetToken(user.id, token, new Date(Date.now() + FIRST_PASSWORD_TTL_MS));

    revalidatePath(`/clients/${contact.clientId}`);
    return { ok: true, resetPath: `/reset-password?token=${token}` };
  } catch (error) {
    if (error && typeof error === "object" && "type" in error && (error as { type: string }).type === "duplicate") {
      return { ok: false, message: t.portal.admin.emailInUse };
    }
    return { ok: false, message: getErrorMessage(error, t.errors.serverError) };
  }
}
