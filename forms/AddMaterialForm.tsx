'use client'
import { addMaterial } from "@/actions/projectMaterials/projectMaterials";
import { useActionState, useEffect, useRef } from "react";
import { useTranslation } from "@/components/LocaleProvider";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";

// A linkable target for a material: a standalone (ungrouped) task, an
// entire task series, or an entire task category — series and categories
// are offered as single collapsed options (e.g. "Strings onduleur" or
// "Toiture"), never expanded into their member tasks/series.
export type MaterialLinkOption =
  | { kind: "task"; id: number; title: string }
  | { kind: "group"; id: number; name: string }
  | { kind: "category"; id: number; name: string };

const initialState: ProjectMaterialActionState = {
  type: null,
  message: "",
}

export default function AddMaterialForm({
  clientId,
  projectId,
  linkOptions,
}: {
  clientId: number;
  projectId: number;
  linkOptions: MaterialLinkOption[];
}) {
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
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:px-6"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="sm:min-w-[160px] sm:flex-1">
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
      {/* Quantity/unit grouped so they never split apart when wrapping. */}
      <div className="flex gap-2">
        <div className="w-1/2 sm:w-24">
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
        <div className="w-1/2 sm:w-20">
          <input
            type="text"
            name="unit"
            placeholder={t.materials.unitPlaceholder}
            aria-label={t.materials.unitLabel}
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
          />
        </div>
      </div>
      <input
        type="text"
        name="supplierName"
        placeholder={t.materials.supplierPlaceholder}
        aria-label={t.materials.supplierLabel}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-auto sm:min-w-[140px] sm:flex-1"
      />
      <input
        type="text"
        name="reference"
        placeholder={t.materials.referencePlaceholder}
        aria-label={t.materials.referenceLabel}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-auto sm:min-w-[120px] sm:flex-1"
      />
      {/* Optional link to a task or a whole task series: when set, the stock
          indicator compares quantity in stock against requiredQuantity.
          Hidden entirely when the project has nothing yet to link to. */}
      {linkOptions.length > 0 && (
        <div className="flex gap-2">
          <div className="w-1/2 sm:w-40">
            <select
              name="link"
              defaultValue=""
              aria-label={t.materials.linkedTaskLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">{t.materials.linkedTaskNone}</option>
              {linkOptions.map((option) =>
                option.kind === "task" ? (
                  <option key={`task-${option.id}`} value={`task:${option.id}`}>
                    {option.title}
                  </option>
                ) : option.kind === "group" ? (
                  <option key={`group-${option.id}`} value={`group:${option.id}`}>
                    {option.name}
                  </option>
                ) : (
                  <option key={`category-${option.id}`} value={`category:${option.id}`}>
                    {option.name}
                  </option>
                )
              )}
            </select>
          </div>
          <div className="w-1/2 sm:w-28">
            <input
              type="number"
              name="requiredQuantity"
              min="0"
              step="any"
              placeholder={t.materials.requiredQuantityPlaceholder}
              aria-label={t.materials.requiredQuantityLabel}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
            />
            {state.type === "zodError" && state.fieldsForm?.requiredQuantity && (
              <p className="mt-1 text-xs text-red-500">{state.fieldsForm.requiredQuantity}</p>
            )}
          </div>
        </div>
      )}
      <button
        type="submit"
        disabled={isPending}
        className={`rounded bg-primary px-3 py-2 text-sm text-white hover:bg-primary/90 cursor-pointer ${
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
