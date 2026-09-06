'use client'
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon, Squares2X2Icon, ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import { deleteTaskGroup, setTaskGroupCategory } from "@/actions/taskGroups/taskGroups";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import { NESTED_LIST_INDENT } from "@/lib/nesting";
import AssigneePicker, { type AssigneeOption } from "@/components/AssigneePicker";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import type { ProjectTask } from "@/app/generated/prisma/client";

type TaskGroupSummary = {
  id: number;
  name: string;
  doneCount: number;
  totalCount: number;
  categoryId?: number | null;
  assignedCompanyId?: number | null;
  assignedInterimId?: number | null;
  tasks: ProjectTask[];
};

type ProjectTaskGroupRowProps = {
  group: TaskGroupSummary;
  clientId: number;
  projectId: number;
  canEdit: boolean;
  categories?: TaskCategoryOption[];
  assignees?: { companies: AssigneeOption[]; interims: AssigneeOption[] };
};

export default function ProjectTaskGroupRow({ group, clientId, projectId, canEdit, categories, assignees }: ProjectTaskGroupRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const router = useRouter();
  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(() =>
    deleteTaskGroup(group.id, clientId, projectId)
  );

  async function handleCategoryChange(value: string) {
    const categoryId = value ? Number(value) : null;
    setCategoryError(null);
    const res = await setTaskGroupCategory(group.id, categoryId, clientId, projectId);
    if (res.type === "error") {
      setCategoryError(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 hover:opacity-80"
        >
          {open ? (
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
          )}
          <Squares2X2Icon className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-900 dark:text-gray-100">
            {group.name}
          </span>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            ({group.doneCount}/{group.totalCount})
          </span>
        </button>
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
        {canEdit && assignees && (
          <AssigneePicker
            targetKind="group"
            targetId={group.id}
            clientId={clientId}
            projectId={projectId}
            companies={assignees.companies}
            interims={assignees.interims}
            assignedCompanyId={group.assignedCompanyId ?? null}
            assignedInterimId={group.assignedInterimId ?? null}
          />
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
      </div>
      {categoryError && (
        <p className="px-4 pb-2 text-xs text-red-500 sm:px-6">{categoryError}</p>
      )}

      {open && (
        group.tasks.length ? (
          <ul className={`${NESTED_LIST_INDENT} divide-y divide-gray-300 bg-gray-50 dark:divide-gray-700 dark:bg-gray-900/40`}>
            {group.tasks.map((task) => (
              <ProjectTaskRow key={task.id} task={task} clientId={clientId} projectId={projectId} canEdit={canEdit} />
            ))}
          </ul>
        ) : (
          <p className={`${NESTED_LIST_INDENT} bg-gray-50 px-4 py-3 text-center text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400 sm:px-6`}>
            {t.projects.detail.noTasks}
          </p>
        )
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
