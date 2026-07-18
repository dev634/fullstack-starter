'use client'
import { addIntervention } from "@/actions/interventions/interventions";
import { useActionState, useEffect, useRef } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import type { InterventionActionState } from "@/types/intervention";

const initialState: InterventionActionState = {
  type: null,
  message: "",
}

export default function AddInterventionForm({ clientId, projectId }: { clientId: number; projectId: number }) {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<InterventionActionState, FormData>(
    addIntervention,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:px-6"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="sm:w-52">
        <input
          type="datetime-local"
          name="scheduledAt"
          aria-label={t.interventions.scheduledAtLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
        />
        {state.type === "zodError" && state.fieldsForm?.scheduledAt && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.scheduledAt}</p>
        )}
      </div>
      <div className="sm:min-w-[160px] sm:flex-1">
        <input
          type="text"
          name="description"
          placeholder={t.interventions.newPlaceholder}
          aria-label={t.interventions.descriptionLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.description && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.description}</p>
        )}
      </div>
      <input
        type="text"
        name="technician"
        placeholder={t.interventions.technicianPlaceholder}
        aria-label={t.interventions.technicianLabel}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-auto sm:min-w-[140px]"
      />
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
