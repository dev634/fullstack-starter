'use client'
import { lendEquipment } from "@/actions/equipmentLoans/equipmentLoans";
import { useActionState, useState } from "react";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import type { EquipmentLoanActionState, BorrowerOption } from "@/types/equipment";

const initialState: EquipmentLoanActionState = {
  type: null,
  message: "",
};

export type LendableEquipment = { id: number; name: string; reference: string | null };

/** Today, as the `type="date"` input's own "YYYY-MM-DD" value in the
 * viewer's local time — same manual-formatting approach as
 * lib/datetimeLocal.ts::toDatetimeLocal, so the calendar date shown matches
 * the browser's, not a UTC-shifted one. */
function todayDateValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * "Prêter" — used both as the "Mon matériel" tab's header toggle (no
 * `defaultEquipmentId`, picks from every available equipment) and as a
 * single row's own action (`defaultEquipmentId` pre-selects that row's
 * equipment in the same, still-editable, `<select>` — not locked to it).
 * Renders nothing when there is no available equipment to lend at all.
 */
export default function LendEquipmentForm({
  equipmentOptions,
  borrowerOptions,
  defaultEquipmentId,
  triggerLabel,
}: {
  equipmentOptions: LendableEquipment[];
  borrowerOptions: BorrowerOption[];
  defaultEquipmentId?: number;
  triggerLabel: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<EquipmentLoanActionState, FormData>(
    lendEquipment,
    initialState
  );
  // Controlled fields: React 19 resets NON-controlled fields of a <form
  // action> as soon as the action's state changes, zodError included — a
  // zodError used to wipe every field (including the two <select>s) back to
  // their defaultValue.
  const [lentAt, setLentAt] = useState(todayDateValue);
  const initialEquipmentId = defaultEquipmentId ?? equipmentOptions[0]?.id ?? "";
  const [equipmentId, setEquipmentId] = useState(String(initialEquipmentId));
  const [borrowerId, setBorrowerId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setLentAt(todayDateValue());
      setEquipmentId(String(initialEquipmentId));
      setBorrowerId("");
      setDueAt("");
      setNote("");
      setOpen(false);
    }
  }

  if (equipmentOptions.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
        {triggerLabel}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.loans.lendToggle}>
        <form action={formAction} className="flex flex-col gap-3">
          <div>
            <label htmlFor="loan-equipment" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.loans.equipmentLabel}
            </label>
            <select
              id="loan-equipment"
              name="equipmentId"
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            >
              {equipmentOptions.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.reference ? `${eq.name} (${eq.reference})` : eq.name}
                </option>
              ))}
            </select>
            {state.type === "zodError" && state.fieldsForm?.equipmentId && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.equipmentId}</p>
            )}
          </div>
          <div>
            <label htmlFor="loan-borrower" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.loans.borrowerLabel}
            </label>
            <select
              id="loan-borrower"
              name="borrowerId"
              value={borrowerId}
              onChange={(e) => setBorrowerId(e.target.value)}
              required
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="" disabled>
                {t.loans.borrowerLabel}
              </option>
              {borrowerOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? t.loans.unknownUser}
                </option>
              ))}
            </select>
            {state.type === "zodError" && state.fieldsForm?.borrowerId && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.borrowerId}</p>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="loan-lentAt" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t.loans.lentAtLabel}
              </label>
              <input
                id="loan-lentAt"
                type="date"
                name="lentAt"
                value={lentAt}
                onChange={(e) => setLentAt(e.target.value)}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
              />
              {state.type === "zodError" && state.fieldsForm?.lentAt && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.lentAt}</p>
              )}
            </div>
            <div className="flex-1">
              <label htmlFor="loan-dueAt" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t.loans.dueAtLabel}
              </label>
              <input
                id="loan-dueAt"
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
          </div>
          <div>
            <label htmlFor="loan-note" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.loans.noteLabel}
            </label>
            <textarea
              id="loan-note"
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
              {t.loans.lendToggle}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
