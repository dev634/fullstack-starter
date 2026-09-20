'use client'
import { returnLoan } from "@/actions/equipmentLoans/equipmentLoans";
import { useActionState, useState } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import type { EquipmentLoanActionState } from "@/types/equipment";

const initialState: EquipmentLoanActionState = {
  type: null,
  message: "",
};

/** Today, as the `type="date"` input's own "YYYY-MM-DD" value in the
 * viewer's local time. Duplicated (not extracted) from
 * forms/LendEquipmentForm.tsx's identical helper — below the two-occurrence
 * threshold this repo's DRY rule extracts at; flagged as a shared-helper
 * candidate for lib/ the day a third caller needs it. */
function todayDateValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function ReturnLoanForm({ loanId }: { loanId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<EquipmentLoanActionState, FormData>(
    returnLoan,
    initialState
  );
  const [returnedAt, setReturnedAt] = useState(todayDateValue);

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setReturnedAt(todayDateValue());
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <CheckCircleIcon className="h-3.5 w-3.5" />
        {t.loans.returnAction}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.loans.returnAction}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={loanId} />
          <div>
            <label htmlFor={`return-date-${loanId}`} className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.loans.returnedAtLabel}
            </label>
            <input
              id={`return-date-${loanId}`}
              type="date"
              name="returnedAt"
              value={returnedAt}
              onChange={(e) => setReturnedAt(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            />
            {state.type === "zodError" && state.fieldsForm?.returnedAt && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.returnedAt}</p>
            )}
          </div>
          {(state.type === "error" || state.type === "zodError") && (
            <p className="text-xs text-red-500">{state.message}</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className={`min-h-11 rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                isPending ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {t.loans.returnAction}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
