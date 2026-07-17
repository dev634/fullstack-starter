'use client'
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { deleteTaskGroup, setTaskGroupCategory } from "@/actions/taskGroups/taskGroups";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";

type TaskGroupSummary = {
  id: number;
  name: string;
  doneCount: number;
  totalCount: number;
  categoryId?: number | null;
};

type ProjectTaskGroupRowProps = {
  group: TaskGroupSummary;
  clientId: number;
  projectId: number;
  canEdit: boolean;
  categories?: TaskCategoryOption[];
};

export default function ProjectTaskGroupRow({ group, clientId, projectId, canEdit, categories }: ProjectTaskGroupRowProps) {
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

  async function handleCategoryChange(value: string) {
    const categoryId = value ? Number(value) : null;
    await setTaskGroupCategory(group.id, categoryId, clientId, projectId);
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
      {canEdit && categories && categories.length > 0 && (
        <select
          value={group.categoryId ?? ""}
          onChange={(e) => handleCategoryChange(e.target.value)}
          disabled={pending}
          aria-label={t.tasks.series.categoryLabel}
          className="shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-xs text-gray-900 dark:text-gray-100"
        >
          <option value="">{t.tasks.series.noCategoryOption}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      )}
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
