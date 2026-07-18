'use client'
import { addTask } from "@/actions/tasks/tasks";
import { useActionState, useEffect, useRef } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import type { TaskActionState } from "@/types/task";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";

const initialState: TaskActionState = {
  type: null,
  message: "",
}

export default function AddTaskForm({
  clientId,
  projectId,
  categories = [],
}: {
  clientId: number;
  projectId: number;
  categories?: TaskCategoryOption[];
}) {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<TaskActionState, FormData>(
    addTask,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-start gap-2 px-4 py-3 sm:px-6">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="min-w-[160px] flex-1">
        <input
          type="text"
          name="title"
          placeholder={t.tasks.newPlaceholder}
          aria-label={t.tasks.titleLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.title && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.title}</p>
        )}
      </div>
      <input
        type="date"
        name="dueDate"
        aria-label={t.tasks.dueDateLabel}
        className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
      />
      <div className="w-24">
        <input
          type="number"
          name="quantityTarget"
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
      {categories.length > 0 && (
        <div className="sm:min-w-[140px]">
          <select
            name="categoryId"
            defaultValue=""
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
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className={`rounded bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.common.add}
      </button>
      {state.type === "error" && (
        <p className="w-full text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
