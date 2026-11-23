'use client'
import { editMaterial } from "@/actions/projectMaterials/projectMaterials";
import { useActionState, useState } from "react";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import MaterialLinkOptions from "@/components/MaterialLinkOptions";
import FormInput, { formInputClass } from "@/components/FormInput";
import { format } from "@/lib/i18n/format";
import type { ProjectMaterialActionState } from "@/types/projectMaterial";
import type { MaterialLinkOption, MaterialCategoryOption } from "@/forms/AddMaterialForm";

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
  // Current link encoded as the picker value ("task:5" / "group:3" /
  // "category:2"), or "" when the material isn't linked to anything.
  link: string;
  // Filing (WHAT the material is) — independent of `link` above (WHY it's
  // here). Null means "non classé".
  materialCategoryId: number | null;
};

export default function EditMaterialForm({
  material,
  clientId,
  projectId,
  linkOptions,
  categories,
}: {
  material: EditableMaterial;
  clientId: number;
  projectId: number;
  linkOptions: MaterialLinkOption[];
  categories: MaterialCategoryOption[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Controlled so the required-quantity field appears/disappears as the link
  // is picked or cleared, and so the current link is pre-selected.
  const [link, setLink] = useState(material.link);
  const isLinked = link !== "";
  // Every other field is controlled too: under `<form action>` React 19 resets
  // uncontrolled fields when the action returns, a validation error included.
  const [name, setName] = useState(material.name);
  const [quantity, setQuantity] = useState(String(material.quantity));
  const [unit, setUnit] = useState(material.unit ?? "");
  const [supplierName, setSupplierName] = useState(material.supplierName ?? "");
  const [reference, setReference] = useState(material.reference ?? "");
  const [requiredQuantity, setRequiredQuantity] = useState(String(material.requiredQuantity ?? ""));
  const [categoryId, setCategoryId] = useState(String(material.materialCategoryId ?? ""));

  // The state lives in this parent, which outlives the modal's content: a
  // cancelled edit would otherwise reappear on the next open. Re-seed from the
  // (revalidated) row each time the modal opens.
  function openModal() {
    setName(material.name);
    setQuantity(String(material.quantity));
    setUnit(material.unit ?? "");
    setSupplierName(material.supplierName ?? "");
    setReference(material.reference ?? "");
    setRequiredQuantity(String(material.requiredQuantity ?? ""));
    setCategoryId(String(material.materialCategoryId ?? ""));
    setLink(material.link);
    setOpen(true);
  }
  const [state, formAction, isPending] = useActionState<ProjectMaterialActionState, FormData>(
    editMaterial,
    initialState
  );

  const fieldErrors = state.type === "zodError" ? state.fieldsForm : undefined;

  // Close the modal once a successful edit is reflected in state — done
  // during render (not an effect), same pattern as AddTaskCategoryForm.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
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
              <FormInput
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                label={t.materials.nameLabel}
                placeholder={t.materials.newPlaceholder}
                error={fieldErrors?.name}
              />
            </div>

            <div className="mb-3 flex gap-2">
              <div className="w-1/2">
                <FormInput
                  type="number"
                  name="quantity"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  label={t.materials.quantityLabel}
                  error={fieldErrors?.quantity}
                />
              </div>
              <div className="w-1/2">
                <FormInput
                  type="text"
                  name="unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  label={t.materials.unitLabel}
                  placeholder={t.materials.unitPlaceholder}
                  error={fieldErrors?.unit}
                />
              </div>
            </div>

            <div className="mb-3">
              <FormInput
                type="text"
                name="supplierName"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                label={t.materials.supplierLabel}
                placeholder={t.materials.supplierPlaceholder}
                error={fieldErrors?.supplierName}
              />
            </div>

            <div className="mb-3">
              <FormInput
                type="text"
                name="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                label={t.materials.referenceLabel}
                placeholder={t.materials.referencePlaceholder}
                error={fieldErrors?.reference}
              />
            </div>

            {/* Filing (WHAT the material is) — independent of the "Tâche
                liée" picker below (WHY it's here). Controlled like every
                other field: `<form action>` would reset it on a refusal. */}
            {categories.length > 0 && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t.materials.categoryPickerLabel}
                  <select
                    name="materialCategoryId"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className={`mt-1 ${formInputClass}`}
                  >
                    <option value="">{t.materials.category.uncategorized}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {linkOptions.length > 0 ? (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t.materials.linkedTaskLabel}
                  <select
                    name="link"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    className={`mt-1 ${formInputClass}`}
                  >
                    <option value="">{t.materials.linkedTaskNone}</option>
                    <MaterialLinkOptions options={linkOptions} t={t} />
                  </select>
                </label>
              </div>
            ) : (
              // No picker to render (the project has no task/series/category
              // left). An unlinked material still sends an explicit EMPTY link:
              // an absent `link` means "leave the link and requiredQuantity
              // alone", which would keep an orphaned requiredQuantity (the FK
              // is SetNull, the quantity isn't) that no input can clear.
              // A material still linked to something outside the options keeps
              // its link untouched (field absent).
              !isLinked && <input type="hidden" name="link" value="" />
            )}

            {isLinked && (
              <div className="mb-4">
                <FormInput
                  type="number"
                  name="requiredQuantity"
                  min="0"
                  step="any"
                  value={requiredQuantity}
                  onChange={(e) => setRequiredQuantity(e.target.value)}
                  label={t.materials.requiredQuantityLabel}
                  placeholder={t.materials.requiredQuantityPlaceholder}
                  error={fieldErrors?.requiredQuantity}
                />
              </div>
            )}

            {(state.type === "error" || state.type === "zodError") && state.message && (
              <p className="mb-4 text-xs text-red-500">{state.message}</p>
            )}

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
