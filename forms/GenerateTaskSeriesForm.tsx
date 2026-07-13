'use client'
import { addTaskSeries } from "@/actions/tasks/tasks";
import { useActionState, useEffect, useRef, useState } from "react";
import { Squares2X2Icon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import type { TaskActionState } from "@/types/task";

const initialState: TaskActionState = {
  type: null,
  message: "",
}

export default function GenerateTaskSeriesForm({ clientId, projectId }: { clientId: number; projectId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<TaskActionState, FormData>(
    addTaskSeries,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  // Collapse the form once a successful generation is reflected in state —
  // done during render (not an effect), same pattern as CreateFolderForm.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <Squares2X2Icon className="h-3.5 w-3.5" />
        {t.tasks.series.toggle}
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-start gap-2 px-4 py-3 sm:px-6">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="min-w-[140px] flex-1">
        <input
          type="text"
          name="name"
          autoFocus
          placeholder={t.tasks.series.namePlaceholder}
          aria-label={t.tasks.series.nameLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.name && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
        )}
      </div>
      <div className="min-w-[140px] flex-1">
        <input
          type="text"
          name="pattern"
          placeholder={t.tasks.series.patternPlaceholder}
          aria-label={t.tasks.series.patternLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.pattern && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.pattern}</p>
        )}
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t.tasks.series.patternHint}</p>
      </div>
      <div className="w-20">
        <input
          type="number"
          name="from"
          defaultValue="1"
          placeholder={t.tasks.series.fromLabel}
          aria-label={t.tasks.series.fromLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
      </div>
      <div className="w-20">
        <input
          type="number"
          name="to"
          placeholder={t.tasks.series.toLabel}
          aria-label={t.tasks.series.toLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.to && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.to}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className={`rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.tasks.series.generate}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer"
      >
        {t.common.cancel}
      </button>
      {state.type === "error" && (
        <p className="w-full text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
