'use client'
import { editEquipment } from "@/actions/equipment/equipment";
import { useActionState, useState } from "react";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { PhotoUpload } from "@/components/PhotoUpload";
import ModalShell from "@/components/ModalShell";
import type { EquipmentActionState } from "@/types/equipment";

const initialState: EquipmentActionState = {
  type: null,
  message: "",
};

export type EditableEquipment = {
  id: number;
  name: string;
  reference: string | null;
  photoUrl: string | null;
};

export default function EditEquipmentForm({ equipment }: { equipment: EditableEquipment }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<EquipmentActionState, FormData>(
    editEquipment,
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
        onClick={() => setOpen(true)}
        aria-label={format(t.equipment.editEquipment, { name: equipment.name })}
        className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
      >
        <PencilIcon className="h-4 w-4" />
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.equipment.editTitle}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={equipment.id} />
          {/* ModalShell demounts its children on close (components/ModalShell.tsx),
              so PhotoUpload is freshly mounted — and re-seeded from
              equipment.photoUrl — every time this modal opens. */}
          <PhotoUpload defaultUrl={equipment.photoUrl} />
          <div>
            <label
              htmlFor={`equipment-name-${equipment.id}`}
              className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {t.equipment.nameLabel}
            </label>
            <input
              id={`equipment-name-${equipment.id}`}
              type="text"
              name="name"
              defaultValue={equipment.name}
              placeholder={t.equipment.namePlaceholder}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.name && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
            )}
          </div>
          <div>
            <label
              htmlFor={`equipment-reference-${equipment.id}`}
              className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
            >
              {t.equipment.referenceLabel}
            </label>
            <input
              id={`equipment-reference-${equipment.id}`}
              type="text"
              name="reference"
              defaultValue={equipment.reference ?? ""}
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
              {t.common.save}
            </button>
          </div>
        </form>
      </ModalShell>
    </>
  );
}
