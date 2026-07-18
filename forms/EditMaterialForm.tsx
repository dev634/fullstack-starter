'use client'
import { editMaterial } from "@/actions/projectMaterials/projectMaterials";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";

const initialState: ProjectMaterialActionState = {
  type: null,
  message: "",
}

export type EditableMaterial = {
  id: number;
  name: string;
  quantity: number;
  unit: string | null;
  supplierName: string | null;
  reference: string | null;
  requiredQuantity: number | null;
  isLinked: boolean;
};

export default function EditMaterialForm({
  material,
  clientId,
  projectId,
}: {
  material: EditableMaterial;
  clientId: number;
  projectId: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ProjectMaterialActionState, FormData>(
    editMaterial,
    initialState
  );

  useEffect(() => {
    if (state.type === "success") {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={format(t.materials.editMaterial, { name: material.name })}
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
            <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">{t.materials.editTitle}</h2>
            <input type="hidden" name="id" value={material.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="projectId" value={projectId} />

            <div className="mb-3">
              <input
                type="text"
                name="name"
                defaultValue={material.name}
                placeholder={t.materials.newPlaceholder}
                aria-label={t.materials.nameLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {state.type === "zodError" && state.fieldsForm?.name && (
                <p className="mt-1 text-xs text-red-500">{state.fieldsForm.name}</p>
              )}
            </div>

            <div className="mb-3 flex gap-2">
              <div className="w-1/2">
                <input
                  type="number"
                  name="quantity"
                  min="0"
                  step="any"
                  defaultValue={material.quantity}
                  placeholder={t.materials.quantityLabel}
                  aria-label={t.materials.quantityLabel}
                  className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
                />
                {state.type === "zodError" && state.fieldsForm?.quantity && (
                  <p className="mt-1 text-xs text-red-500">{state.fieldsForm.quantity}</p>
                )}
              </div>
              <div className="w-1/2">
                <input
                  type="text"
                  name="unit"
                  defaultValue={material.unit ?? ""}
                  placeholder={t.materials.unitPlaceholder}
                  aria-label={t.materials.unitLabel}
                  className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
                />
              </div>
            </div>

            <div className="mb-3">
              <input
                type="text"
                name="supplierName"
                defaultValue={material.supplierName ?? ""}
                placeholder={t.materials.supplierPlaceholder}
                aria-label={t.materials.supplierLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
            </div>

            <div className="mb-3">
              <input
                type="text"
                name="reference"
                defaultValue={material.reference ?? ""}
                placeholder={t.materials.referencePlaceholder}
                aria-label={t.materials.referenceLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
            </div>

            {material.isLinked && (
              <div className="mb-4">
                <input
                  type="number"
                  name="requiredQuantity"
                  min="0"
                  step="any"
                  defaultValue={material.requiredQuantity ?? ""}
                  placeholder={t.materials.requiredQuantityPlaceholder}
                  aria-label={t.materials.requiredQuantityLabel}
                  className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
                />
                {state.type === "zodError" && state.fieldsForm?.requiredQuantity && (
                  <p className="mt-1 text-xs text-red-500">{state.fieldsForm.requiredQuantity}</p>
                )}
              </div>
            )}

            {state.type === "error" && <p className="mb-4 text-xs text-red-500">{state.message}</p>}

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
