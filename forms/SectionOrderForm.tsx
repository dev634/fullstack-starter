'use client'
import { useState } from "react";
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
import { Bars3Icon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { updateProjectSectionOrder } from "@/actions/appSettings/appSettings";
import type { ProjectSectionKey } from "@/lib/projectSections";

type Props = {
  order: ProjectSectionKey[];
  labels: Record<ProjectSectionKey, string>;
};

function SortableRow({
  id,
  label,
  reorderLabel,
}: {
  id: ProjectSectionKey;
  label: string;
  reorderLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 ${
        isDragging ? "z-10 shadow-lg ring-2 ring-blue-300 dark:ring-blue-600" : ""
      }`}
    >
      {/* Drag handle only — touch-none keeps touch-scrolling the page working
          everywhere except on the handle itself. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={reorderLabel}
        className="shrink-0 cursor-grab touch-none rounded p-1 text-gray-400 hover:text-gray-700 active:cursor-grabbing dark:hover:text-gray-200"
      >
        <Bars3Icon className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
    </li>
  );
}

export default function SectionOrderForm({ order, labels }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ProjectSectionKey[]>(order);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function persist(next: ProjectSectionKey[]) {
    setStatus("saving");
    const result = await updateProjectSectionOrder(next);
    if (result.ok) {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMsg(result.message);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.indexOf(active.id as ProjectSectionKey);
    const newIndex = items.indexOf(over.id as ProjectSectionKey);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    void persist(next);
  }

  return (
    <section className="rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t.appSettings.sectionOrder.title}</h2>
      <p className="mt-1 mb-4 text-sm text-gray-500 dark:text-gray-400">{t.appSettings.sectionOrder.subtitle}</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {items.map((key) => (
              <SortableRow
                key={key}
                id={key}
                label={labels[key]}
                reorderLabel={format(t.appSettings.sectionOrder.reorder, { name: labels[key] })}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="mt-3 h-5 text-xs" aria-live="polite">
        {status === "saving" && (
          <span className="text-gray-500 dark:text-gray-400">{t.appSettings.sectionOrder.saving}</span>
        )}
        {status === "saved" && (
          <span className="text-green-600 dark:text-green-400">{t.appSettings.sectionOrder.saved}</span>
        )}
        {status === "error" && <span className="text-red-500">{errorMsg || t.appSettings.sectionOrder.saveError}</span>}
      </div>
    </section>
  );
}
