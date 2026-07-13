'use client'
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { deleteTaskGroup } from "@/actions/taskGroups/taskGroups";

type TaskGroupSummary = {
  id: number;
  name: string;
  doneCount: number;
  totalCount: number;
};

type ProjectTaskGroupRowProps = {
  group: TaskGroupSummary;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectTaskGroupRow({ group, clientId, projectId, canEdit }: ProjectTaskGroupRowProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    setPending(true);
    setError(null);
    const res = await deleteTaskGroup(group.id, clientId, projectId);
    setPending(false);
    if (res.type === "error") {
      setError(res.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <Link
        href={`/clients/${clientId}/projects/${projectId}/tasks/${group.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-80"
      >
        <Squares2X2Icon className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {group.name}
        </span>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          ({group.doneCount}/{group.totalCount})
        </span>
      </Link>
      {canEdit && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          aria-label={format(t.tasks.group.deleteAriaLabel, { name: group.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}

      {confirming && (
        <Modal
          title={t.tasks.group.deleteSeriesTitle}
          text={format(t.tasks.group.deleteSeriesText, { name: group.name, count: group.totalCount })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.tasks.group.deleting : t.tasks.group.deleteSeries}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </li>
  );
}
