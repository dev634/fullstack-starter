'use client'
import { addReservePlan } from "@/actions/reserves/reserves";
import { useActionState, useEffect, useRef, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import ModalShell from "@/components/ModalShell";
import type { ReservePlanActionState } from "@/types/reserve";

const initialState: ReservePlanActionState = {
  type: null,
  message: "",
};

export default function AddReservePlanForm({
  clientId,
  projectId,
  folders,
}: {
  clientId: number;
  projectId: number;
  folders: { id: number; name: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ReservePlanActionState, FormData>(addReservePlan, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  const inputClass =
    "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        {t.reserves.addPlanToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.reserves.addPlanToggle}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="projectId" value={projectId} />
          <input
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            aria-label={t.reserves.choosePlanFile}
            className="text-sm text-gray-500 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:text-gray-900 dark:file:text-gray-100 file:cursor-pointer"
          />
          <input
            type="text"
            name="name"
            placeholder={t.reserves.planNamePlaceholder}
            aria-label={t.reserves.planNamePlaceholder}
            className={inputClass}
          />
          {folders.length > 0 && (
            <select name="folderId" defaultValue="" aria-label={t.reserves.folderLabel} className={inputClass}>
              <option value="">{t.reserves.noFolder}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
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
              className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isPending ? t.reserves.uploadingPlan : t.reserves.addPlanSubmit}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
