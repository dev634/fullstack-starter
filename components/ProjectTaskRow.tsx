'use client'
import { toggleTask, deleteTask, updateTaskQuantity, setTaskCategory } from "@/actions/tasks/tasks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { localeTag } from "@/lib/i18n/formatDate";
import EditTaskForm from "@/forms/EditTaskForm";
import AssigneePicker, { type AssigneeOption } from "@/components/AssigneePicker";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import type { ProjectTask } from "@/app/generated/prisma/client";

type ProjectTaskRowProps = {
  task: ProjectTask;
  clientId: number;
  projectId: number;
  canEdit: boolean;
  categories?: TaskCategoryOption[];
  assignees?: { companies: AssigneeOption[]; interims: AssigneeOption[] };
};

export default function ProjectTaskRow({ task, clientId, projectId, canEdit, categories, assignees }: ProjectTaskRowProps) {
  const { t, locale } = useTranslation();
  const [pending, setPending] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const router = useRouter();

  async function handleToggle() {
    if (!canEdit || pending) return;
    setPending(true);
    await toggleTask(task.id, !task.done, clientId, projectId, task.groupId);
    setPending(false);
    router.refresh();
  }

  async function handleCategoryChange(value: string) {
    const categoryId = value ? Number(value) : null;
    setCategoryError(null);
    const res = await setTaskCategory(task.id, categoryId, clientId, projectId);
    if (res.type === "error") {
      setCategoryError(res.message);
      return;
    }
    router.refresh();
  }

  async function handleQuantityChange(value: string) {
    if (!canEdit || pending) return;
    const quantityDone = Number(value);
    if (!Number.isInteger(quantityDone) || quantityDone < 0) return;
    setPending(true);
    await updateTaskQuantity(task.id, quantityDone, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    await deleteTask(task.id, clientId, projectId, task.groupId);
    setPending(false);
    router.refresh();
  }

  return (
    <li>
    <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      {task.quantityTarget != null ? (
        <span className="flex shrink-0 items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
          <input
            key={task.quantityDone}
            type="number"
            min="0"
            max={task.quantityTarget}
            step="1"
            defaultValue={task.quantityDone ?? 0}
            disabled={!canEdit || pending}
            onBlur={(e) => handleQuantityChange(e.target.value)}
            aria-label={format(t.tasks.quantityDoneLabel, { title: task.title })}
            className="w-14 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-sm text-gray-900 dark:text-gray-100 disabled:cursor-not-allowed"
          />
          <span className="text-gray-400 dark:text-gray-500">/ {task.quantityTarget}</span>
        </span>
      ) : (
        <input
          type="checkbox"
          checked={task.done}
          disabled={!canEdit || pending}
          onChange={handleToggle}
          aria-label={format(task.done ? t.tasks.markUndone : t.tasks.markDone, { title: task.title })}
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 dark:border-gray-600 disabled:cursor-not-allowed"
        />
      )}
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          task.done ? "text-gray-400 line-through dark:text-gray-500" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {task.title}
      </span>
      {task.dueDate && (
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {new Date(task.dueDate).toLocaleDateString(localeTag(locale))}
        </span>
      )}
      {canEdit && categories && categories.length > 0 && (
        <select
          value={task.categoryId ?? ""}
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
          targetKind="task"
          targetId={task.id}
          clientId={clientId}
          projectId={projectId}
          companies={assignees.companies}
          interims={assignees.interims}
          assignedCompanyId={task.assignedCompanyId}
          assignedInterimId={task.assignedInterimId}
        />
      )}
      {canEdit && (
        <EditTaskForm
          task={{ id: task.id, title: task.title, dueDate: task.dueDate, quantityTarget: task.quantityTarget }}
          clientId={clientId}
          projectId={projectId}
        />
      )}
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={format(t.tasks.deleteTask, { title: task.title })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </div>
    {categoryError && (
      <p className="px-4 pb-2 text-xs text-red-500 sm:px-6">{categoryError}</p>
    )}
    </li>
  );
}
