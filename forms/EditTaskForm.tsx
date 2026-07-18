'use client'
import { editTask } from "@/actions/tasks/tasks";
import { useActionState, useState } from "react";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import type { TaskActionState } from "@/types/task";

const initialState: TaskActionState = {
  type: null,
  message: "",
}

export type EditableTask = {
  id: number;
  title: string;
  dueDate: Date | string | null;
  quantityTarget: number | null;
};

export default function EditTaskForm({
  task,
  clientId,
  projectId,
}: {
  task: EditableTask;
  clientId: number;
  projectId: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<TaskActionState, FormData>(editTask, initialState);

  // Close the modal once a successful edit is reflected in state — done
  // during render (not an effect), same pattern as AddTaskCategoryForm.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  const dueDateValue = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={format(t.tasks.editTask, { title: task.title })}
        className="shrink-0 cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
      >
        <PencilIcon className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            action={formAction}
            className="w-full max-w-md rounded border border-gray-300 bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">{t.tasks.editTitle}</h2>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="projectId" value={projectId} />

            <div className="mb-3">
              <input
                type="text"
                name="title"
                defaultValue={task.title}
                placeholder={t.tasks.newPlaceholder}
                aria-label={t.tasks.titleLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {state.type === "zodError" && state.fieldsForm?.title && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.title}</p>
              )}
            </div>

            <div className="mb-3">
              <input
                type="date"
                name="dueDate"
                defaultValue={dueDateValue}
                aria-label={t.tasks.dueDateLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="mb-4">
              <input
                type="number"
                name="quantityTarget"
                min="1"
                step="1"
                defaultValue={task.quantityTarget ?? ""}
                placeholder={t.tasks.quantityTargetPlaceholder}
                aria-label={t.tasks.quantityTargetLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {state.type === "zodError" && state.fieldsForm?.quantityTarget && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.quantityTarget}</p>
              )}
            </div>

            {state.type === "error" && <p className="mb-4 text-xs text-red-500">{state.message}</p>}

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
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
