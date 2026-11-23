'use client'
import { addTask } from "@/actions/tasks/tasks";
import { useActionState, useEffect, useRef, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import type { CreatedTaskData, TaskActionState } from "@/types/task";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";

const initialState: TaskActionState<CreatedTaskData> = {
  type: null,
  message: "",
}

export default function AddTaskForm({
  clientId,
  projectId,
  categories = [],
  onCreated,
}: {
  clientId: number;
  projectId: number;
  categories?: TaskCategoryOption[];
  onCreated?: (revealCategoryId: number | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<TaskActionState<CreatedTaskData>, FormData>(
    addTask,
    initialState
  );
  // Controlled fields: React 19 resets non-controlled fields of a <form action>
  // when the action returns, zodError included.
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [quantityTarget, setQuantityTarget] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const onCreatedRef = useRef(onCreated);
  useEffect(() => {
    onCreatedRef.current = onCreated;
  });

  useEffect(() => {
    if (state.type !== "success") return;
    onCreatedRef.current?.(state.data?.categoryId ?? null);
  }, [state]);

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setOpen(false);
      setTitle("");
      setDueDate("");
      setQuantityTarget("");
      setCategoryId("");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        {t.tasks.addToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.tasks.addToggle}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <input
              type="text"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder={t.tasks.newPlaceholder}
              aria-label={t.tasks.titleLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.title && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.title}</p>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="sm:flex-1">
              <input
                type="date"
                name="dueDate"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label={t.tasks.dueDateLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
              />
              {state.type === "zodError" && state.fieldsForm?.dueDate && (
                <p className="mt-1 text-xs text-red-500" aria-live="polite">{state.fieldsForm.dueDate}</p>
              )}
            </div>
            <div className="sm:w-28">
              <input
                type="number"
                name="quantityTarget"
                value={quantityTarget}
                onChange={(e) => setQuantityTarget(e.target.value)}
                min="1"
                step="1"
                placeholder={t.tasks.quantityTargetPlaceholder}
                aria-label={t.tasks.quantityTargetLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {state.type === "zodError" && state.fieldsForm?.quantityTarget && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.quantityTarget}</p>
              )}
            </div>
          </div>
          {categories.length > 0 && (
            <select
              name="categoryId"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label={t.tasks.series.categoryLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">{t.tasks.series.noCategoryOption}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          {(state.type === "error" || state.type === "zodError") && (
            <p className="text-xs text-red-500" aria-live="polite">{state.message}</p>
          )}
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
              className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                isPending ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {t.common.add}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
