'use client'
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { Bars3Icon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { addJobFunction, deleteJobFunction, reorderJobFunctions } from "@/actions/jobFunctions/jobFunctions";
import type { JobFunctionActionState } from "@/types/jobFunction";
import type { JobFunction } from "@/app/generated/prisma/client";

const initialState: JobFunctionActionState = { type: null, message: "" };

function SortableRow({
  fn,
  reorderLabel,
  deleteLabel,
  onDelete,
}: {
  fn: JobFunction;
  reorderLabel: string;
  deleteLabel: string;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: fn.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 bg-[#f3f4f6] px-4 py-2.5 dark:bg-[#1f2937] ${
        isDragging ? "z-10 shadow-lg ring-2 ring-blue-300 dark:ring-blue-600" : ""
      }`}
    >
      {/* Drag handle only — touch-none keeps the page scrollable everywhere else. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={reorderLabel}
        className="shrink-0 cursor-grab touch-none rounded p-1 text-gray-400 hover:text-gray-700 active:cursor-grabbing dark:hover:text-gray-200"
      >
        <Bars3Icon className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">{fn.name}</span>
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </li>
  );
}

export default function JobFunctionsManager({ functions }: { functions: JobFunction[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<JobFunctionActionState, FormData>(addJobFunction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Explicit save: a drag marks the list dirty, the Enregistrer button
  // persists it — matching the section-order tab.
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState("");

  // Local order for drag-and-drop; re-synced whenever the server list changes
  // (after add / delete / reorder revalidation).
  const [items, setItems] = useState(functions);
  const [lastFns, setLastFns] = useState(functions);
  if (functions !== lastFns) {
    setLastFns(functions);
    setItems(functions);
    setDirty(false);
    setStatus("idle");
  }

  const [toDelete, setToDelete] = useState<JobFunction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (state.type === "success") formRef.current?.reset();
  }, [state]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setItems(arrayMove(items, oldIndex, newIndex));
    setDirty(true);
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    const res = await reorderJobFunctions(items.map((i) => i.id));
    if (res.type === "success") {
      setStatus("saved");
      setDirty(false);
      router.refresh();
    } else {
      setStatus("error");
      setSaveErrorMsg(res.message);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteJobFunction(toDelete.id);
    setDeleting(false);
    if (res.type === "error") {
      setDeleteError(res.message);
      return;
    }
    setToDelete(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          name="name"
          placeholder={t.jobFunctions.addPlaceholder}
          aria-label={t.jobFunctions.addPlaceholder}
          className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
        />
        <button
          type="submit"
          disabled={isPending}
          className={`inline-flex items-center justify-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
            isPending ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <PlusIcon className="h-4 w-4" />
          {t.jobFunctions.add}
        </button>
      </form>

      {state.type === "error" && <p className="text-xs text-red-500">{state.message}</p>}
      {state.type === "zodError" && state.fieldsForm?.name && (
        <p className="text-xs text-red-500">{state.fieldsForm.name}</p>
      )}

      {items.length ? (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.jobFunctions.reorderHint}</p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700">
                {items.map((fn) => (
                  <SortableRow
                    key={fn.id}
                    fn={fn}
                    reorderLabel={format(t.jobFunctions.reorderLabel, { name: fn.name })}
                    deleteLabel={format(t.jobFunctions.deleteLabel, { name: fn.name })}
                    onDelete={() => setToDelete(fn)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="flex flex-col gap-2">
            <span className="min-h-4 text-right text-xs" aria-live="polite">
              {status === "saving" && <span className="text-gray-500 dark:text-gray-400">{t.jobFunctions.saving}</span>}
              {status === "saved" && <span className="text-green-600 dark:text-green-400">{t.jobFunctions.saved}</span>}
              {status === "error" && <span className="text-red-500">{saveErrorMsg || t.jobFunctions.saveError}</span>}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || status === "saving"}
              className={`w-full rounded bg-primary px-4 py-2 text-center text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
                !dirty || status === "saving" ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {t.common.save}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.empty}</p>
      )}

      {toDelete && (
        <Modal
          title={t.jobFunctions.deleteTitle}
          text={format(t.jobFunctions.deleteText, { name: toDelete.name })}
          error={deleteError ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={t.common.delete}
          onClose={() => !deleting && setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
