'use client'
import { useActionState, useEffect, useRef, useState } from "react";
import { TrashIcon, PencilIcon, FolderIcon, ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import ModalShell from "@/components/ModalShell";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import { editMaterialCategory, deleteMaterialCategory } from "@/actions/materialCategories/materialCategories";
import ProjectMaterialRow, { type MaterialWithTask } from "@/components/ProjectMaterialRow";
import type { MaterialLinkOption, MaterialCategoryOption } from "@/forms/AddMaterialForm";
import { NESTED_LIST_INDENT } from "@/lib/nesting";
import type { MaterialCategoryActionState } from "@/types/materialCategory";

const initialRenameState: MaterialCategoryActionState = {
  type: null,
  message: "",
};

type CategoryProgress = { done: number; total: number; percent: number; untracked: number };

// Discriminated on `isUncategorized` so the "Non classé" bucket (which owns
// no ProjectMaterialCategory row at all — lib/projectDashboard.ts's
// MaterialCategoryGroup "uncategorized" branch carries no id) and a real
// category (a positive integer id) can't be confused — renaming/deleting
// only ever needs a real id, and TS narrows `id` to `number` wherever
// `isUncategorized` is checked `false`, no cast required. The uncategorized
// branch carries no `id` field at all: it was a dead string (the sentinel's
// own value, never read here — rename/delete only ever run in the other
// branch) before this type stopped manufacturing one.
type CategoryIdentity = { isUncategorized: true } | { isUncategorized: false; id: number };

type ProjectMaterialCategorySectionProps = CategoryIdentity & {
  name: string;
  materials: MaterialWithTask[];
  progress: CategoryProgress;
  categories: MaterialCategoryOption[];
  linkOptions: MaterialLinkOption[];
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

/**
 * Mirror of components/ProjectTaskCategorySection.tsx for material filing
 * (WHAT a material is) instead of task grouping — a repliable section with
 * a count badge, the category's stock progress (computeMaterialCategoryGroups,
 * lib/projectDashboard.ts — the exact same definition MaterialStockDonut's
 * center uses, just scoped to this category), rename and delete.
 *
 * The "Non classé" bucket (isUncategorized) is rendered by this same
 * component for a single visual language between real categories and the
 * fallback, but carries neither rename nor delete: it isn't a row in
 * ProjectMaterialCategory, there is nothing to rename or delete.
 *
 * Defaults open (unlike ProjectTaskCategorySection, which defaults closed):
 * material categories are pure filing with no per-category "add" action of
 * their own (a material is always added via the single AddMaterialForm at
 * the bottom of the Matériel section, category included in that same
 * picker) — there is no create-then-reveal flow to seed initial state from,
 * and collapsing on load would hide materials the flat list used to show
 * unconditionally.
 */
export default function ProjectMaterialCategorySection(props: ProjectMaterialCategorySectionProps) {
  const { name, materials, progress, categories, linkOptions, clientId, projectId, canEdit } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const renameFormRef = useRef<HTMLFormElement>(null);

  const [renameState, renameAction, renamePending] = useActionState<MaterialCategoryActionState, FormData>(
    editMaterialCategory,
    initialRenameState
  );

  useEffect(() => {
    if (renameState.type === "success") renameFormRef.current?.reset();
  }, [renameState]);

  const [lastHandledRenameState, setLastHandledRenameState] = useState(renameState);
  if (renameState !== lastHandledRenameState) {
    setLastHandledRenameState(renameState);
    if (renameState.type === "success") setRenaming(false);
  }

  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(async () => {
    if (props.isUncategorized) {
      // Unreachable: the delete button below only ever renders when
      // !props.isUncategorized. Kept so useDeleteConfirm (a hook) is called
      // unconditionally, as hooks must be, without an `as`/cast on `id`.
      return { type: "error" as const, message: "" };
    }
    return deleteMaterialCategory(props.id, clientId, projectId);
  });

  const roundedPercent = Math.round(progress.percent);

  return (
    <div className="border-b border-gray-300 dark:border-gray-700">
      <div className="bg-gray-100 dark:bg-gray-800/60">
        <div className="flex items-center gap-2 px-4 py-2 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 hover:opacity-80"
          >
            {open ? (
              <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
            )}
            <FolderIcon className="h-4 w-4 shrink-0 text-purple-500" />
            <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
              {name}
            </span>
            <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">({materials.length})</span>
          </button>
          {canEdit && !props.isUncategorized && (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              aria-label={format(t.materials.category.editAriaLabel, { name })}
              className="shrink-0 cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
          )}
          {canEdit && !props.isUncategorized && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending}
              aria-label={format(t.materials.category.deleteAriaLabel, { name })}
              className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Always visible, whether or not the category is expanded — same
            "at a glance without opening it" reasoning as every collapsed
            section badge elsewhere. `done`/`total` only ever count TRACKED
            materials (requiredQuantity set): the untracked ones are named
            here, never folded into percent, matching MaterialStockDonut's
            own untracked note (they don't share a unit with a stock count). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 pb-2 text-xs text-gray-600 dark:text-gray-400 sm:px-6">
          <span>
            {progress.done}/{progress.total} · {roundedPercent} %
          </span>
          {progress.untracked > 0 && <span>{format(t.projectDashboard.materialsUntracked, { count: progress.untracked })}</span>}
        </div>
      </div>

      {open && (
        materials.length > 0 ? (
          <ul className={`${NESTED_LIST_INDENT} divide-y divide-gray-300 dark:divide-gray-700`}>
            {materials.map((material) => (
              <ProjectMaterialRow
                key={material.id}
                material={material}
                clientId={clientId}
                projectId={projectId}
                canEdit={canEdit}
                linkOptions={linkOptions}
                categories={categories}
              />
            ))}
          </ul>
        ) : (
          <p className={`${NESTED_LIST_INDENT} px-4 py-3 text-xs text-gray-500 dark:text-gray-400 sm:px-6`}>
            {t.materials.category.empty}
          </p>
        )
      )}

      {!props.isUncategorized && renaming && (
        <ModalShell open={renaming} onClose={() => setRenaming(false)} title={t.materials.category.editTitle}>
          <form ref={renameFormRef} action={renameAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={props.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="projectId" value={projectId} />
            <div>
              <input
                type="text"
                name="name"
                autoFocus
                defaultValue={name}
                placeholder={t.materials.category.namePlaceholder}
                aria-label={t.materials.category.nameLabel}
                className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
              />
              {renameState.type === "zodError" && renameState.fieldsForm?.name && (
                <p className="mt-1 text-xs text-red-500">{renameState.fieldsForm.name}</p>
              )}
            </div>
            {renameState.type === "error" && <p className="text-xs text-red-500">{renameState.message}</p>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={renamePending}
                className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                  renamePending ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {!props.isUncategorized && confirming && (
        <Modal
          title={t.materials.category.deleteCategoryTitle}
          text={
            materials.length > 0
              ? format(t.materials.category.deleteCategoryTextWithCount, { name, count: materials.length })
              : format(t.materials.category.deleteCategoryText, { name })
          }
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.materials.category.deleting : t.materials.category.deleteCategory}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
