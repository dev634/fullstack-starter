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
import { Bars3Icon, TrashIcon, PlusIcon, EyeIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import ModalShell from "@/components/ModalShell";
import {
  addJobFunction,
  deleteJobFunction,
  reorderJobFunctions,
  setFunctionSections,
  setFunctionScope,
  setFunctionAreas,
} from "@/actions/jobFunctions/jobFunctions";
import { PROJECT_SECTION_KEYS, type ProjectSectionKey } from "@/lib/projectSections";
import { projectSectionLabels } from "@/lib/projectSectionLabels";
import { APP_AREA_KEYS, normalizeHiddenAreas, type AppAreaKey } from "@/lib/appAreas";
import AreaAccessTree from "./AreaAccessTree";
import type { JobFunctionActionState } from "@/types/jobFunction";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { JobFunction } from "@/app/generated/prisma/client";

const initialState: JobFunctionActionState = { type: null, message: "" };

/**
 * Localized labels for the app-area tree, keyed by area key — mirrors
 * projectSectionLabels.ts's pattern so the wording stays sourced from a
 * single place per key instead of being duplicated into the dictionary.
 */
function appAreaLabels(t: Dictionary): Record<AppAreaKey, string> {
  return {
    dashboard: t.dashboard.title,
    "dashboard.stats": t.jobFunctions.areas.statsLabel,
    "dashboard.recent": t.dashboard.recentlyAdded,
    clients: t.nav.clients,
    "clients.info": t.jobFunctions.areas.infoLabel,
    "clients.contacts": t.contacts.heading,
    "clients.projects": t.clients.detail.projectsHeading,
    projects: t.nav.projects,
    admin: t.nav.admin,
    "admin.users": t.nav.users,
    "admin.functions": t.nav.functions,
    "admin.settings": t.jobFunctions.areas.settingsLabel,
  };
}

function SortableRow({
  fn,
  reorderLabel,
  deleteLabel,
  configureLabel,
  hiddenCount,
  onConfigure,
  onDelete,
}: {
  fn: JobFunction;
  reorderLabel: string;
  deleteLabel: string;
  configureLabel: string;
  hiddenCount: number;
  onConfigure: () => void;
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
        onClick={onConfigure}
        aria-label={configureLabel}
        title={configureLabel}
        className="relative shrink-0 cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
      >
        <EyeIcon className="h-4 w-4" />
        {hiddenCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[9px] font-bold leading-none text-white">
            {hiddenCount}
          </span>
        )}
      </button>
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

  // Per-function section visibility: which project sections a function's users
  // may see. The modal edits the VISIBLE set; we persist the complement.
  const sectionLabels = projectSectionLabels(t);
  const areaLabels = appAreaLabels(t);
  const [configuring, setConfiguring] = useState<JobFunction | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<ProjectSectionKey>>(new Set());
  const [visibleAreas, setVisibleAreas] = useState<Set<AppAreaKey>>(new Set());
  const [scope, setScope] = useState<"ALL" | "ASSIGNED">("ALL");
  const [configStatus, setConfigStatus] = useState<"idle" | "saving" | "error">("idle");
  const [configError, setConfigError] = useState("");

  function openConfig(fn: JobFunction) {
    const hidden = new Set(fn.hiddenSections as ProjectSectionKey[]);
    setVisibleKeys(new Set(PROJECT_SECTION_KEYS.filter((k) => !hidden.has(k))));
    const hiddenAreas = new Set(normalizeHiddenAreas(fn.hiddenAreas));
    setVisibleAreas(new Set(APP_AREA_KEYS.filter((k) => !hiddenAreas.has(k))));
    setScope(fn.projectScope === "ASSIGNED" ? "ASSIGNED" : "ALL");
    setConfigStatus("idle");
    setConfigError("");
    setConfiguring(fn);
  }

  function toggleKey(key: ProjectSectionKey) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleArea(key: AppAreaKey) {
    setVisibleAreas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function saveConfig() {
    if (!configuring) return;
    setConfigStatus("saving");
    const hidden = PROJECT_SECTION_KEYS.filter((k) => !visibleKeys.has(k));
    // Stored as each key's OWN checkbox state, not the ancestor-aware
    // effective visibility (that predicate — isAreaEffectivelyVisible in
    // lib/appAreas.ts — is for greying out descendants in the UI only, see
    // AreaAccessTree). Storing the effective set would bake "hidden" into
    // every descendant of an unchecked parent, so re-checking the parent
    // could never tell which descendants were meant to stay unchecked.
    const hiddenAreas = APP_AREA_KEYS.filter((k) => !visibleAreas.has(k));
    // Sections, scope, and areas are one decision for the admin, so a failure
    // in any of them must leave the modal open rather than half-applying
    // silently.
    const [sectionsRes, scopeRes, areasRes] = await Promise.all([
      setFunctionSections(configuring.id, hidden),
      setFunctionScope(configuring.id, scope),
      setFunctionAreas(configuring.id, hiddenAreas),
    ]);
    const res = [sectionsRes, scopeRes, areasRes].find((r) => r.type !== "success") ?? scopeRes;
    if (res.type === "success") {
      setConfiguring(null);
      router.refresh();
    } else {
      setConfigStatus("error");
      setConfigError(res.message);
    }
  }

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
                    configureLabel={format(t.jobFunctions.configureLabel, { name: fn.name })}
                    hiddenCount={fn.hiddenSections.length + fn.hiddenAreas.length}
                    onConfigure={() => openConfig(fn)}
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

      <ModalShell
        open={configuring !== null}
        onClose={() => setConfiguring(null)}
        title={t.jobFunctions.configTitle}
      >
        {configuring && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {format(t.jobFunctions.configSubtitle, { name: configuring.name })}
            </p>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t.jobFunctions.areas.title}</legend>
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{t.jobFunctions.areas.subtitle}</p>
              <AreaAccessTree
                areaLabels={areaLabels}
                visibleAreas={visibleAreas}
                onToggleArea={toggleArea}
                sectionLabels={sectionLabels}
                sectionsCaption={t.jobFunctions.sections.title}
                visibleSections={visibleKeys}
                onToggleSection={toggleKey}
              />
            </fieldset>
            <fieldset className="mt-2 flex flex-col gap-1 border-t border-gray-300 pt-3 dark:border-gray-700">
              <legend className="mb-1 text-sm font-medium">{t.jobFunctions.scope.title}</legend>
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">{t.jobFunctions.scope.hint}</p>
              {(["ALL", "ASSIGNED"] as const).map((value) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-500/10">
                  <input
                    type="radio"
                    name="projectScope"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span>{value === "ALL" ? t.jobFunctions.scope.all : t.jobFunctions.scope.assigned}</span>
                </label>
              ))}
            </fieldset>
            {configStatus === "error" && <p className="text-xs text-red-500">{configError || t.jobFunctions.configSaveError}</p>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfiguring(null)}
                className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={saveConfig}
                disabled={configStatus === "saving"}
                className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                  configStatus === "saving" ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {configStatus === "saving" ? t.jobFunctions.sections.saving : t.common.save}
              </button>
            </div>
          </div>
        )}
      </ModalShell>
    </div>
  );
}
