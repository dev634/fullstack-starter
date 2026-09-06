'use client'
import { useState, type ReactNode } from "react";
import AddTaskForm from "@/forms/AddTaskForm";
import GenerateTaskSeriesForm, { type TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import AddTaskCategoryForm from "@/forms/AddTaskCategoryForm";
import { CategoryRevealProvider, type CategoryRevealSignal } from "@/components/TaskCategoryReveal";

/**
 * The Tasks section's own header (icon/title/count + add-task/add-série/
 * add-category buttons) plus the CategoryRevealProvider its children need —
 * now the dedicated `.../tasks` page's top card, not a collapsible dropdown
 * on the project hub (that card is now a plain link to this page, same as
 * Réserves/Fichiers before it). Content is always visible here, so unlike
 * the hub version this used to be, there is no `open`/`onOpenChange`
 * anymore: the header renders exactly once, in the same "static card
 * header" shape as ProjectReservesPage / ProjectFilesPage.
 *
 * CategoryRevealProvider survives the move: creating a task/série into a
 * category still needs to open THAT category's own (still-collapsible)
 * ProjectTaskCategorySection and scroll it into view. docs/CONVENTIONS.md's
 * "sections repliables" note — a child can mount AFTER the signal it derives
 * from, so it must read it at mount, not just react to it changing — no
 * longer describes an actual race on THIS page: nothing here hides
 * `children` the way `{open && children}` used to on the hub, so every
 * ProjectTaskCategorySection is already mounted before any creation can
 * happen. The lazy `useState` read-at-mount in ProjectTaskCategorySection
 * itself is untouched (this component doesn't own it) — it stays correct as
 * a no-op safeguard, and costs nothing to keep in case this content is ever
 * wrapped in a collapse again.
 */
type PassThrough = { icon: ReactNode; title: string; badge?: string; children: ReactNode };

export default function TasksSection({
  clientId,
  projectId,
  categories,
  canEdit,
  icon,
  title,
  badge,
  children,
}: PassThrough & {
  clientId: number;
  projectId: number;
  categories: TaskCategoryOption[];
  canEdit: boolean;
}) {
  const [reveal, setReveal] = useState<CategoryRevealSignal>(null);

  function handleCreated(revealCategoryId: number | null) {
    if (revealCategoryId != null) setReveal({ categoryId: revealCategoryId });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
        <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold">
          {icon}
          <span className="truncate">{title}</span>
          {badge && <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">{badge}</span>}
        </h2>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <AddTaskForm
              clientId={clientId}
              projectId={projectId}
              categories={categories}
              onCreated={handleCreated}
            />
            <GenerateTaskSeriesForm
              clientId={clientId}
              projectId={projectId}
              categories={categories}
              onCreated={handleCreated}
            />
            <AddTaskCategoryForm clientId={clientId} projectId={projectId} />
          </div>
        )}
      </div>

      <CategoryRevealProvider value={reveal}>{children}</CategoryRevealProvider>
    </>
  );
}
