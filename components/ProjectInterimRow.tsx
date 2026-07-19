'use client'
import { deleteInterim } from "@/actions/interims/interims";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { useRowAction } from "@/lib/useRowAction";
import type { Interim } from "@/app/generated/prisma/client";

type ProjectInterimRowProps = {
  interim: Interim;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectInterimRow({ interim, clientId, projectId, canEdit }: ProjectInterimRowProps) {
  const { t } = useTranslation();
  const { pending, run } = useRowAction();

  const secondary = [interim.role, interim.agency].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{interim.name}</span>
        {secondary && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{secondary}</span>
        )}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={() => run(() => deleteInterim(interim.id, clientId, projectId))}
          disabled={pending}
          aria-label={format(t.interims.deleteInterim, { name: interim.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
