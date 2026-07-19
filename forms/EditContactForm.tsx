'use client'
import { editContact } from "@/actions/contacts/contacts";
import { useActionState, useState } from "react";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import ModalShell from "@/components/ModalShell";
import ContactFields from "@/forms/ContactFields";
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
  role: string | null;
};

export default function EditContactForm({ contact, clientId }: { contact: EditableContact; clientId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ContactActionState, FormData>(editContact, initialState);

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

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
          <ContactFields t={t} state={state} defaults={contact} />
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
      </ModalShell>
    </>
  );
}
