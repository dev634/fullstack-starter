'use client'
import { addInterim } from "@/actions/interims/interims";
import { useActionState, useEffect, useRef, useState } from "react";
import { UserPlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import type { InterimActionState } from "@/types/interim";
import JobFunctionOptions, { type JobFunctionOption } from "@/forms/JobFunctionOptions";

const initialState: InterimActionState = {
  type: null,
  message: "",
}

export default function AddInterimForm({
  clientId,
  projectId,
  functions,
}: {
  clientId: number;
  projectId: number;
  functions: JobFunctionOption[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<InterimActionState, FormData>(addInterim, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  // Close the modal once a successful add is reflected in state — done
  // during render (this repo's ESLint forbids setState inside useEffect).
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <UserPlusIcon className="h-3.5 w-3.5" />
        {t.interims.addToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.interims.addToggle}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="projectId" value={projectId} />
          <div>
            <input
              type="text"
              name="name"
              autoFocus
              placeholder={t.interims.namePlaceholder}
              aria-label={t.interims.nameLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.name && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
            )}
          </div>
          <select
            name="jobFunctionId"
            defaultValue=""
            aria-label={t.interims.roleLabel}
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
          >
            <JobFunctionOptions functions={functions} noneLabel={t.interims.functionNone} />
          </select>
          <div>
            <input
              type="text"
              name="agency"
              placeholder={t.interims.agencyPlaceholder}
              aria-label={t.interims.agencyLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.agency && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.agency}</p>
            )}
          </div>
          {/* Was `type === "error"` only — a zodError rendered nothing. */}
          {(state.type === "error" || state.type === "zodError") && (
            <p className="text-xs text-red-500">{state.message}</p>
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
