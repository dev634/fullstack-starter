'use client'
import { addEquipment } from "@/actions/equipment/equipment";
import { startTransition, useActionState, useState } from "react";
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
  // Controlled fields: React 19 resets NON-controlled fields of a <form
  // action> as soon as the action's state changes, zodError included — a
  // zodError used to wipe back to empty whatever the user had typed. Only
  // `photo` stays uncontrolled (file inputs can't be controlled); the
  // ModalShell unmount on close/success re-seeds it instead (see the
  // onSubmit workaround below).
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");

  // Close the modal during render on success (this repo's ESLint forbids
  // setState inside useEffect) — same pattern as AddInterventionForm.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") {
      setOpen(false);
      setName("");
      setReference("");
    }
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
        <form
          action={formAction}
          onSubmit={(e) => {
            // The photo <input type="file"> can't be controlled; submitting
            // through the form's own `action` would otherwise be fine, but
            // React 19 also auto-resets it (and every uncontrolled field) as
            // soon as the action's state changes. Dispatching manually from
            // the captured FormData skips that auto-reset and keeps the
            // selected file — the fields above stay correct because they're
            // controlled.
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            startTransition(() => formAction(formData));
          }}
          className="flex flex-col gap-3"
        >
          {/* Narrower than PhotoUpload's image/* default: uploadEquipmentPhoto
              (lib/cloudinary.ts) refuses HEIC/AVIF/BMP/TIFF (decision B) —
              this is only the OS file picker's filter, not the enforcement.
              maxBytes: keep in sync with MAX_EQUIPMENT_PHOTO_BYTES (10 MB,
              point 9 — reuses MAX_RESERVE_PHOTO_BYTES). */}
          <PhotoUpload accept="image/jpeg,image/png,image/webp,image/gif" maxBytes={10 * 1024 * 1024} />
          <div>
            <label htmlFor="equipment-name" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.equipment.nameLabel}
            </label>
            <input
              id="equipment-name"
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              value={reference}
              onChange={(e) => setReference(e.target.value)}
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
