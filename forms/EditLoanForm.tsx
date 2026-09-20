'use client'
import { editLoan } from "@/actions/equipmentLoans/equipmentLoans";
import { useActionState, useState } from "react";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import { toDateInputValue } from "@/lib/datetimeLocal";
import type { EquipmentLoanActionState } from "@/types/equipment";

const initialState: EquipmentLoanActionState = {
  type: null,
  message: "",
};

export type EditableLoan = {
  id: number;
  dueAt: Date | null;
  note: string | null;
};

export default function EditLoanForm({ loan }: { loan: EditableLoan }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<EquipmentLoanActionState, FormData>(
    editLoan,
    initialState
  );
  // Controlled fields: React 19 resets NON-controlled fields of a <form
  // action> as soon as the action's state changes, zodError included — a
  // zodError used to wipe the user's edit back to the original loan values.
  const [dueAt, setDueAt] = useState(toDateInputValue(loan.dueAt));
  const [note, setNote] = useState(loan.note ?? "");

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setOpen(false);
      setDueAt(toDateInputValue(loan.dueAt));
      setNote(loan.note ?? "");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.loans.editTitle}
        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
      >
        <PencilIcon className="h-4 w-4" />
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.loans.editTitle}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={loan.id} />
          <div>
            <label htmlFor={`loan-edit-dueAt-${loan.id}`} className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.loans.dueAtLabel}
            </label>
            <input
              id={`loan-edit-dueAt-${loan.id}`}
              type="date"
              name="dueAt"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            />
            {state.type === "zodError" && state.fieldsForm?.dueAt && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.dueAt}</p>
            )}
          </div>
          <div>
            <label htmlFor={`loan-edit-note-${loan.id}`} className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.loans.noteLabel}
            </label>
            <textarea
              id={`loan-edit-note-${loan.id}`}
              name="note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.loans.notePlaceholder}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.note && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.note}</p>
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
              {t.common.save}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
