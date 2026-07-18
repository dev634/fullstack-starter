'use client'
import { useState } from "react";
import { TrashIcon, FolderIcon, ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import { deleteTaskCategory } from "@/actions/taskCategories/taskCategories";
import ProjectTaskGroupRow from "@/components/ProjectTaskGroupRow";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import type { ProjectTask } from "@/app/generated/prisma/client";

type TaskGroupSummary = {
  id: number;
  name: string;
  createdAt: Date;
  doneCount: number;
  totalCount: number;
  categoryId?: number | null;
  tasks: ProjectTask[];
};

type ProjectTaskCategorySectionProps = {
  category: { id: number; name: string };
  groups: TaskGroupSummary[];
  // Standalone (non-series) tasks assigned directly to this category —
  // rendered alongside the series, same section, same "Groupe" concept.
  tasks: ProjectTask[];
  categories: TaskCategoryOption[];
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectTaskCategorySection({
  category,
  groups,
  tasks,
  categories,
  clientId,
  projectId,
  canEdit,
}: ProjectTaskCategorySectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(() =>
    deleteTaskCategory(category.id, clientId, projectId)
  );

  const doneCount = groups.reduce((sum, group) => sum + group.doneCount, 0) + tasks.filter((t) => t.done).length;
  const totalCount = groups.reduce((sum, group) => sum + group.totalCount, 0) + tasks.length;

  // Combine standalone tasks and series into one chronological list within
  // the category — unfinished first, oldest first — same rule as the
  // top-level (uncategorized) list on the project detail page.
  type TaskRow = { kind: "task"; createdAt: Date; done: boolean; data: ProjectTask };
  type GroupRow = { kind: "group"; createdAt: Date; done: boolean; data: TaskGroupSummary };
  const rows: (TaskRow | GroupRow)[] = [
    ...tasks.map((task): TaskRow => ({ kind: "task", createdAt: task.createdAt, done: task.done, data: task })),
    ...groups.map((group): GroupRow => ({
      kind: "group",
      createdAt: group.createdAt,
      done: group.totalCount > 0 && group.doneCount === group.totalCount,
      data: group,
    })),
  ].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <div className="border-b border-gray-300 dark:border-gray-700">
      <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800/60 px-4 py-2 sm:px-6">
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
          <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
            {category.name}
          </span>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            ({doneCount}/{totalCount})
          </span>
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            aria-label={format(t.tasks.category.deleteAriaLabel, { name: category.name })}
            className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <ul className="divide-y divide-gray-300 dark:divide-gray-700">
          {rows.map((row) =>
            row.kind === "task" ? (
              <ProjectTaskRow
                key={`task-${row.data.id}`}
                task={row.data}
                clientId={clientId}
                projectId={projectId}
                canEdit={canEdit}
                categories={categories}
              />
            ) : (
              <ProjectTaskGroupRow
                key={`group-${row.data.id}`}
                group={row.data}
                clientId={clientId}
                projectId={projectId}
                canEdit={canEdit}
                categories={categories}
              />
            )
          )}
        </ul>
      )}

      {confirming && (
        <Modal
          title={t.tasks.category.deleteCategoryTitle}
          text={format(t.tasks.category.deleteCategoryText, { name: category.name })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.tasks.category.deleting : t.tasks.category.deleteCategory}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
