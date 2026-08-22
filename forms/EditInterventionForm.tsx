'use client'
import { editIntervention } from "@/actions/interventions/interventions";
import { useActionState, useState } from "react";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { toDatetimeLocal, datetimeLocalToIso } from "@/lib/datetimeLocal";
import type { InterventionActionState } from "@/types/intervention";

const initialState: InterventionActionState = {
  type: null,
  message: "",
}

export type EditableIntervention = {
  id: number;
  scheduledAt: Date;
  description: string;
  technician: string | null;
  status: string;
};

export default function EditInterventionForm({
  intervention,
  clientId,
  projectId,
}: {
  intervention: EditableIntervention;
  clientId: number;
  projectId: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Controlled so the visible (zone-less) input can be converted to a
  // timezone-unambiguous ISO instant in the hidden field the server reads.
  // Re-seeded from the prop each time the modal opens (below), since the
  // form isn't remounted between edits.
  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocal(intervention.scheduledAt));
  const [state, formAction, isPending] = useActionState<InterventionActionState, FormData>(
    editIntervention,
    initialState
  );

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setScheduledAt(toDatetimeLocal(intervention.scheduledAt));
          setOpen(true);
        }}
        aria-label={format(t.interventions.editIntervention, { description: intervention.description })}
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
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">{t.interventions.editTitle}</h2>
            <input type="hidden" name="id" value={intervention.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="projectId" value={projectId} />

            <div className="mb-3">
              {/* Zone-less local value shown to the user; the hidden field
                  carries the timezone-unambiguous instant the server stores. */}
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

            <div className="mb-3">
              <input
                type="text"
                name="description"
                defaultValue={intervention.description}
                placeholder={t.interventions.newPlaceholder}
                aria-label={t.interventions.descriptionLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {state.type === "zodError" && state.fieldsForm?.description && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.description}</p>
              )}
            </div>

            <div className="mb-3">
              <input
                type="text"
                name="technician"
                defaultValue={intervention.technician ?? ""}
                placeholder={t.interventions.technicianPlaceholder}
                aria-label={t.interventions.technicianLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {state.type === "zodError" && state.fieldsForm?.technician && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.technician}</p>
              )}
            </div>

            <div className="mb-4">
              <select
                name="status"
                defaultValue={intervention.status}
                aria-label={t.interventions.statusLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="PLANIFIEE">{t.interventions.status.PLANIFIEE}</option>
                <option value="FAITE">{t.interventions.status.FAITE}</option>
                <option value="ANNULEE">{t.interventions.status.ANNULEE}</option>
              </select>
            </div>

            {/* Was `type === "error"` only — a zodError rendered nothing. */}
            {(state.type === "error" || state.type === "zodError") && (
              <p className="mb-4 text-xs text-red-500">{state.message}</p>
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
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
