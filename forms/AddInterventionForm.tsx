'use client'
import { addIntervention } from "@/actions/interventions/interventions";
import { useActionState, useEffect, useRef, useState } from "react";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { datetimeLocalToIso } from "@/lib/datetimeLocal";
import ModalShell from "@/components/ModalShell";
import type { InterventionActionState } from "@/types/intervention";

const initialState: InterventionActionState = {
  type: null,
  message: "",
}

export default function AddInterventionForm({ clientId, projectId }: { clientId: number; projectId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<InterventionActionState, FormData>(
    addIntervention,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Controlled so the visible (zone-less) input can be converted to a
  // timezone-unambiguous ISO instant in the hidden field the server reads.
  const [scheduledAt, setScheduledAt] = useState("");

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  // On success, clear the controlled date and close the modal during render
  // (this repo's ESLint forbids setState inside useEffect).
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setScheduledAt("");
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <CalendarDaysIcon className="h-3.5 w-3.5" />
        {t.interventions.addToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.interventions.addToggle}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            {/* Zone-less local value shown to the user; the hidden field carries
                the timezone-unambiguous instant the server actually stores. */}
            <input type="hidden" name="scheduledAt" value={datetimeLocalToIso(scheduledAt)} />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              aria-label={t.interventions.scheduledAtLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            />
            {state.type === "zodError" && state.fieldsForm?.scheduledAt && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.scheduledAt}</p>
            )}
          </div>
          <div>
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
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
          />
          {state.type === "error" && <p className="text-xs text-red-500">{state.message}</p>}
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
