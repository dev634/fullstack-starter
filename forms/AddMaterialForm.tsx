'use client'
import { addMaterial } from "@/actions/projectMaterials/projectMaterials";
import { useActionState, useEffect, useRef } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";

const initialState: ProjectMaterialActionState = {
  type: null,
  message: "",
}

export default function AddMaterialForm({ clientId, projectId }: { clientId: number; projectId: number }) {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<ProjectMaterialActionState, FormData>(
    addMaterial,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-start gap-2 px-4 py-3 sm:px-6">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="min-w-[160px] flex-1">
        <input
          type="text"
          name="name"
          placeholder={t.materials.newPlaceholder}
          aria-label={t.materials.nameLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.name && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
        )}
      </div>
      <div className="w-24">
        <input
          type="number"
          name="quantity"
          min="0"
          step="any"
          defaultValue="1"
          placeholder={t.materials.quantityLabel}
          aria-label={t.materials.quantityLabel}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        {state.type === "zodError" && state.fieldsForm?.quantity && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.quantity}</p>
        )}
      </div>
      <input
        type="text"
        name="unit"
        placeholder={t.materials.unitPlaceholder}
        aria-label={t.materials.unitLabel}
        className="w-20 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
      />
      <input
        type="text"
        name="supplierName"
        placeholder={t.materials.supplierPlaceholder}
        aria-label={t.materials.supplierLabel}
        className="min-w-[140px] flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
      />
      <input
        type="text"
        name="reference"
        placeholder={t.materials.referencePlaceholder}
        aria-label={t.materials.referenceLabel}
        className="min-w-[120px] flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
      />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.common.add}
      </button>
      {state.type === "error" && (
        <p className="w-full text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}
