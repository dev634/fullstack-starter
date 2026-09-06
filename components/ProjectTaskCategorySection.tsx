'use client'
import { useEffect, useRef, useState } from "react";
import { TrashIcon, FolderIcon, ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import { deleteTaskCategory } from "@/actions/taskCategories/taskCategories";
import ProjectTaskGroupRow from "@/components/ProjectTaskGroupRow";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import { NESTED_LIST_INDENT } from "@/lib/nesting";
import AssigneePicker, { type AssigneeOption } from "@/components/AssigneePicker";
import { useCategoryReveal } from "@/components/TaskCategoryReveal";
import type { TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import type { ProjectTask } from "@/app/generated/prisma/client";

type TaskGroupSummary = {
  id: number;
  name: string;
  createdAt: Date;
  doneCount: number;
  totalCount: number;
  categoryId?: number | null;
  assignedCompanyId?: number | null;
  assignedInterimId?: number | null;
  tasks: ProjectTask[];
};

type ProjectTaskCategorySectionProps = {
  category: { id: number; name: string; assignedCompanyId?: number | null; assignedInterimId?: number | null };
  groups: TaskGroupSummary[];
  // Standalone (non-series) tasks assigned directly to this category —
  // rendered alongside the series, same section, same "Groupe" concept.
  tasks: ProjectTask[];
  categories: TaskCategoryOption[];
  clientId: number;
  projectId: number;
  canEdit: boolean;
  assignees?: { companies: AssigneeOption[]; interims: AssigneeOption[] };
};

export default function ProjectTaskCategorySection({
  category,
  groups,
  tasks,
  categories,
  clientId,
  projectId,
  canEdit,
  assignees,
}: ProjectTaskCategorySectionProps) {
  const { t } = useTranslation();
  const reveal = useCategoryReveal();
  const rootRef = useRef<HTMLDivElement>(null);
  // Mount already revealed when the signal targets us. Categories are only
  // mounted while the Tasks section is open ({open && children}), so creating
  // a task from a collapsed section mounts this component *after* the signal
  // was published — the render-derivation below would then see it as already
  // handled and never open. Seeding the initial state covers that case.
  const [open, setOpen] = useState(() => reveal !== null && reveal.categoryId === category.id);
  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(() =>
    deleteTaskCategory(category.id, clientId, projectId)
  );

  // A task or a series just landed in this category — open it so the new
  // row is actually visible. Doesn't force the state: the user can still
  // collapse the category afterwards. Derived during render (same pattern
  // as AddTaskForm/GenerateTaskSeriesForm) rather than in an effect, so a
  // reveal signal for another category never re-opens this one.
  const [lastHandledReveal, setLastHandledReveal] = useState(reveal);
  if (reveal !== lastHandledReveal) {
    setLastHandledReveal(reveal);
    if (reveal && reveal.categoryId === category.id) setOpen(true);
  }

  // Scroll the revealed category into view — on mobile it can open below the
  // fold, so opening it alone isn't enough for the user to actually see the
  // new task. Runs as a real effect (not derived during render, unlike
  // `open` above) since scrollIntoView is an imperative DOM action, not
  // state — and effects run on mount too, which covers the case where the
  // category mounts already revealed.
  useEffect(() => {
    if (!reveal || reveal.categoryId !== category.id) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [reveal, category.id]);

  const doneCount = groups.reduce((sum, group) => sum + group.doneCount, 0) + tasks.filter((t) => t.done).length;
  const totalCount = groups.reduce((sum, group) => sum + group.totalCount, 0) + tasks.length;

  // Combine standalone tasks and series into one chronological list within
  // the category — unfinished first, oldest first — same rule as the
  // top-level (uncategorized) list on the project detail page.
  type TaskRow = { kind: "task"; createdAt: Date; done: boolean; data: ProjectTask };
  type GroupRow = { kind: "group"; createdAt: Date; done: boolean; data: TaskGroupSummary };
  const rows: (TaskRow | GroupRow)[] = [
    ...tasks.map((task): TaskRow => ({ kind: "task", createdAt: task.createdAt, done: task.done, data: task })),
    ...groups.map((group): GroupRow => ({
      kind: "group",
      createdAt: group.createdAt,
      done: group.totalCount > 0 && group.doneCount === group.totalCount,
      data: group,
    })),
  ].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return (
    <div ref={rootRef} className="border-b border-gray-300 dark:border-gray-700">
      <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800/60 px-4 py-2 sm:px-6">
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
          <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
            {category.name}
          </span>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            ({doneCount}/{totalCount})
          </span>
        </button>
        {canEdit && assignees && (
          <AssigneePicker
            targetKind="category"
            targetId={category.id}
            clientId={clientId}
            projectId={projectId}
            companies={assignees.companies}
            interims={assignees.interims}
            assignedCompanyId={category.assignedCompanyId ?? null}
            assignedInterimId={category.assignedInterimId ?? null}
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            aria-label={format(t.tasks.category.deleteAriaLabel, { name: category.name })}
            className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <ul className={`${NESTED_LIST_INDENT} divide-y divide-gray-300 dark:divide-gray-700`}>
          {rows.map((row) =>
            row.kind === "task" ? (
              <ProjectTaskRow
                key={`task-${row.data.id}`}
                task={row.data}
                clientId={clientId}
                projectId={projectId}
                canEdit={canEdit}
                categories={categories}
                assignees={assignees}
              />
            ) : (
              <ProjectTaskGroupRow
                key={`group-${row.data.id}`}
                group={row.data}
                clientId={clientId}
                projectId={projectId}
                canEdit={canEdit}
                categories={categories}
                assignees={assignees}
              />
            )
          )}
        </ul>
      )}

      {confirming && (
        <Modal
          title={t.tasks.category.deleteCategoryTitle}
          text={format(t.tasks.category.deleteCategoryText, { name: category.name })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={pending ? t.tasks.category.deleting : t.tasks.category.deleteCategory}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
