'use client'
import { StarIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { useRowAction } from "@/lib/useRowAction";
import { deleteContact, setPrimaryContact } from "@/actions/contacts/contacts";
import EditContactForm from "@/forms/EditContactForm";
import type { JobFunctionOption } from "@/forms/ContactFields";
import type { Contact } from "@/app/generated/prisma/client";

// The contact list joins in the job function name, the ids of its linked
// (portal-visible) projects, and its portal login if any.
type ContactWithFunction = Contact & {
  jobFunction: { name: string } | null;
  projects: { id: number }[];
  user: { id: number; email: string; role: string } | null;
};

export default function ContactRow({
  contact,
  clientId,
  canEdit,
  functions,
  projects,
}: {
  contact: ContactWithFunction;
  clientId: number;
  canEdit: boolean;
  functions: JobFunctionOption[];
  projects: { id: number; name: string }[];
}) {
  const { t } = useTranslation();
  const { pending, run } = useRowAction();

  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const secondary = [contact.jobFunction?.name, contact.email, contact.phone].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{fullName}</span>
          {contact.isPrimary && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              {t.contacts.primary}
            </span>
          )}
        </span>
        {secondary && <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{secondary}</span>}
      </span>
      {canEdit && (
        <>
          {!contact.isPrimary && (
            <button
              type="button"
              onClick={() => run(() => setPrimaryContact(contact.id, clientId))}
              disabled={pending}
              aria-label={t.contacts.setPrimary}
              title={t.contacts.setPrimary}
              className="shrink-0 cursor-pointer rounded p-1 text-gray-400 hover:bg-amber-500/10 hover:text-amber-500 disabled:opacity-50 dark:text-gray-500"
            >
              <StarIcon className="h-4 w-4" />
            </button>
          )}
          <EditContactForm
            contact={{
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              jobFunctionId: contact.jobFunctionId,
              linkedProjectIds: contact.projects.map((p) => p.id),
              hasLogin: contact.user != null,
            }}
            clientId={clientId}
            functions={functions}
            projects={projects}
          />
          <button
            type="button"
            onClick={() => run(() => deleteContact(contact.id, clientId))}
            disabled={pending}
            aria-label={format(t.contacts.deleteContact, { name: fullName })}
            className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </>
      )}
    </li>
  );
}
