'use client'
import { addEquipment } from "@/actions/equipment/equipment";
import { useActionState, useEffect, useRef, useState } from "react";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { PhotoUpload } from "@/components/PhotoUpload";
import ModalShell from "@/components/ModalShell";
import type { EquipmentActionState } from "@/types/equipment";

const initialState: EquipmentActionState = {
  type: null,
  message: "",
};

/**
 * "Ajouter un équipement" — header CTA on the "Mon matériel" tab. Mirrors
 * AddInterventionForm's shape (ModalShell + useActionState + reset-on-success);
 * the owner isn't a field here — addEquipment resolves it server-side from the
 * session (lib/currentUser.ts::getCurrentUserId), never trusted from the form.
 */
export default function AddEquipmentForm() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<EquipmentActionState, FormData>(
    addEquipment,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  // Close the modal during render on success (this repo's ESLint forbids
  // setState inside useEffect) — same pattern as AddInterventionForm.
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
        className="inline-flex min-h-11 items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer"
      >
        <PlusIcon className="h-4 w-4" />
        {t.equipment.addToggle}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.equipment.addToggle}>
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <PhotoUpload />
          <div>
            <label htmlFor="equipment-name" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.equipment.nameLabel}
            </label>
            <input
              id="equipment-name"
              type="text"
              name="name"
              placeholder={t.equipment.namePlaceholder}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.name && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
            )}
          </div>
          <div>
            <label htmlFor="equipment-reference" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.equipment.referenceLabel}
            </label>
            <input
              id="equipment-reference"
              type="text"
              name="reference"
              placeholder={t.equipment.referencePlaceholder}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.reference && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.reference}</p>
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
              {t.common.add}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
