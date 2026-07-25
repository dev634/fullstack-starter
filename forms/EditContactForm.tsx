'use client'
import { editContact } from "@/actions/contacts/contacts";
import { createPortalLogin } from "@/actions/portal/portal";
import { useActionState, useState, useTransition } from "react";
import { PencilIcon, KeyIcon, CheckBadgeIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import ModalShell from "@/components/ModalShell";
import ContactFields, { type JobFunctionOption } from "@/forms/ContactFields";
import type { ContactActionState } from "@/types/contact";

const initialState: ContactActionState = {
  type: null,
  message: "",
};

export type EditableContact = {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobFunctionId: number | null;
  linkedProjectIds: number[];
  hasLogin: boolean;
};

export default function EditContactForm({
  contact,
  clientId,
  functions,
  projects,
}: {
  contact: EditableContact;
  clientId: number;
  functions: JobFunctionOption[];
  projects: { id: number; name: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ContactActionState, FormData>(editContact, initialState);

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  // Portal-login provisioning (separate from the contact form submit).
  const [pending, startTransition] = useTransition();
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function provisionLogin() {
    setLoginError(null);
    startTransition(async () => {
      const res = await createPortalLogin(contact.id);
      if (res.ok) setResetUrl(`${window.location.origin}${res.resetPath}`);
      else setLoginError(res.message);
    });
  }

  const linked = new Set(contact.linkedProjectIds);
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={format(t.contacts.editContact, { name: fullName })}
        className="shrink-0 cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
      >
        <PencilIcon className="h-4 w-4" />
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.contacts.editTitle}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={contact.id} />
          <input type="hidden" name="clientId" value={clientId} />
          <ContactFields t={t} state={state} functions={functions} defaults={contact} />

          {/* Portal: which company projects this contact may see once it has a login. */}
          <fieldset className="rounded border border-gray-300 dark:border-gray-700 p-3">
            <legend className="px-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.portal.admin.linkedProjectsLabel}
            </legend>
            {projects.length ? (
              <ul className="flex flex-col gap-1">
                {projects.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-500/10">
                      <input
                        type="checkbox"
                        name="projectIds"
                        value={p.id}
                        defaultChecked={linked.has(p.id)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="min-w-0 truncate">{p.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.portal.admin.noProjectsToLink}</p>
            )}
          </fieldset>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {t.common.save}
            </button>
          </div>
        </form>

        {/* Portal login — created out of band (a User with role CLIENT + a
            one-time password-reset link the admin forwards to the contact). */}
        <div className="mt-4 border-t border-gray-300 dark:border-gray-700 pt-4">
          {contact.hasLogin || resetUrl ? (
            <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckBadgeIcon className="h-5 w-5 shrink-0" />
              {t.portal.admin.hasLogin}
            </p>
          ) : (
            <button
              type="button"
              onClick={provisionLogin}
              disabled={pending || !contact.email}
              className={`inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 ${
                pending || !contact.email ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
              }`}
            >
              <KeyIcon className="h-4 w-4" />
              {pending ? t.portal.admin.creating : t.portal.admin.createLogin}
            </button>
          )}
          {!contact.email && !contact.hasLogin && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.portal.admin.emailRequired}</p>
          )}
          {loginError && <p className="mt-1 text-xs text-red-500">{loginError}</p>}

          {resetUrl && (
            <div className="mt-3 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3">
              <p className="text-xs font-medium">{t.portal.admin.resetLinkTitle}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.portal.admin.resetLinkHint}</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly
                  value={resetUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(resetUrl);
                    setCopied(true);
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs hover:bg-gray-500/10 cursor-pointer"
                >
                  <ClipboardIcon className="h-3.5 w-3.5" />
                  {copied ? t.portal.admin.copied : t.portal.admin.copyLink}
                </button>
              </div>
            </div>
          )}
        </div>
      </ModalShell>
    </>
  );
}
