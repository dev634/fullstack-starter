'use client'
import { deleteSubcontractorPerson } from "@/actions/subcontractors/subcontractors";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import type { SubcontractorPerson } from "@/app/generated/prisma/client";

type ProjectSubcontractorPersonRowProps = {
  person: SubcontractorPerson;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectSubcontractorPersonRow({ person, clientId, projectId, canEdit }: ProjectSubcontractorPersonRowProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    await deleteSubcontractorPerson(person.id, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  const secondary = [person.role, person.phone].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{person.name}</span>
        {secondary && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{secondary}</span>
        )}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={format(t.subcontractors.person.deletePerson, { name: person.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
