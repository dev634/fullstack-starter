import { findByProject as findTasksByProject } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findTaskCategoriesByProject } from "@/repository/taskCategories";
import { findCompanyOptionsByProject } from "@/repository/subcontractors";
import { findOptionsByProject as findInterimOptionsByProject } from "@/repository/interims";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { resolveProjectSectionAccess } from "@/lib/projectSectionGuard";
import { blockClientFromApp } from "@/lib/portal";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import Title from "@/components/Title";
import TasksSection from "@/components/TasksSection";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import ProjectTaskGroupRow from "@/components/ProjectTaskGroupRow";
import ProjectTaskCategorySection from "@/components/ProjectTaskCategorySection";
import ProjectMaterialRow from "@/components/ProjectMaterialRow";
import ScanDeliveryNoteModal from "@/components/ScanDeliveryNoteModal";
import AddMaterialForm, { type MaterialLinkOption } from "@/forms/AddMaterialForm";
import Link from "next/link";
import { ArrowLeftIcon, ClipboardDocumentListIcon, CubeIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
};

/**
 * "Tâches" — also the home of Matériel since it joined this page (see
 * lib/projectSections.ts's own doc on PROJECT_SECTION_ROUTES): the same
 * "fuse into one page, keep both keys separate" move `workforce` made first
 * for Sous-traitants + Intérimaires. A caller whose function hides only one
 * of `tasks`/`materials` still gets the other half of the page — this page
 * asks resolveProjectSectionAccess for BOTH keys at once and renders
 * whichever half(s) `access.visibleSections` actually contains.
 */
export default async function ProjectTasksPage({ params }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const locale = await getLocale();
  const t = getDictionary(locale);

  const access = await resolveProjectSectionAccess({ id, projectId }, ["tasks", "materials"]);

  if (!access.ok) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.projects.detail.tasksHeading} />
        <p className={access.reason === "error" ? "text-red-500" : undefined}>
          {access.reason === "forbidden"
            ? t.errors.forbiddenSection
            : access.reason === "error"
              ? access.message
              : t.projects.detail.notFound}
        </p>
        {/* This page is now its own destination — a refusal must still offer
            a one-gesture way back, the same link the success path below
            uses, rather than leaving only the browser's own back button. */}
        <Link
          href={`/clients/${id}/projects/${projectId}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t.projectDashboard.backToProject}
        </Link>
      </main>
    );
  }

  const { clientId, projectId: pid, project } = access;
  // Which half(s) of this fused page this caller's function actually leaves
  // visible — read from the guard's own decision, never re-derived here (see
  // this file's own doc above and ProjectSectionAccess.visibleSections's).
  const showTasks = access.visibleSections.has("tasks");
  const showMaterials = access.visibleSections.has("materials");
  const session = await auth();
  const canEdit = await can(session?.user?.role, "content.edit");

  const [tasks, taskGroups, taskCategories, companyOptions, interimOptions, materials] = await Promise.all([
    // Loaded unconditionally, whether or not `tasks` itself is visible: the
    // materials picker below (materialLinkOptions) links a material to a
    // task/série/catégorie and needs their titles regardless of whether the
    // Tâches half of this page renders for this caller — same tradeoff the
    // project hub made for materialLinkOptions before this page absorbed
    // Matériel (docs/CONVENTIONS.md's access-axes table: FUNCTION → sections
    // decides which SECTIONS exist, not which task titles a materials picker
    // may mention).
    findTasksByProject(pid),
    findTaskGroupsByProject(pid),
    findTaskCategoriesByProject(pid),
    // Narrow {id, name} projections — this page's assignee picker never
    // reads a company's personnel or an intérimaire's job function/agency
    // (see each function's own doc). Only fetched when the Tâches half
    // actually renders — nothing on the Matériel half uses them.
    canEdit && showTasks ? findCompanyOptionsByProject(pid) : Promise.resolve([]),
    canEdit && showTasks ? findInterimOptionsByProject(pid) : Promise.resolve([]),
    showMaterials ? findMaterialsByProject(pid) : Promise.resolve([]),
  ]);

  // The material picker links to a standalone (ungrouped) task, a whole
  // series, or a whole category at once — series and categories are single
  // collapsed options, never expanded into their individual member tasks/
  // series. Built from the tasks/séries/catégories already loaded above —
  // this page adds no query of its own for it, unlike the three the project
  // hub used to run solely to build this same picker (findTaskLinkOptions /
  // findTaskGroupLinkOptions / findTaskCategoryLinkOptions, all removed —
  // see lib/projectSections.ts's own doc).
  const materialLinkOptions: MaterialLinkOption[] = [
    ...tasks.map((task): MaterialLinkOption => ({ kind: "task", id: task.id, title: task.title })),
    ...taskGroups.map((group): MaterialLinkOption => ({ kind: "group", id: group.id, name: group.name })),
    ...taskCategories.map((category): MaterialLinkOption => ({ kind: "category", id: category.id, name: category.name })),
  ];

  // Series can optionally belong to a category (a higher-level grouping of
  // several series, e.g. "Toiture" containing "Strings onduleur" +
  // "Fixations") — a standalone task can now join the same category
  // directly too (no need to wrap a lone task in its own series). Both are
  // rendered inside the category's own section, so only uncategorized
  // standalone tasks and ungrouped series go into the flat list below.
  const ungroupedTasks = tasks.filter((task) => task.categoryId == null);
  const ungroupedTaskGroups = taskGroups.filter((group) => group.categoryId == null);
  const categorySections = taskCategories.map((category) => ({
    category,
    groups: taskGroups.filter((group) => group.categoryId === category.id),
    tasks: tasks.filter((task) => task.categoryId === category.id),
  }));

  // Combine plain tasks and ungrouped task-series into one chronological
  // list (unfinished first, oldest first) — a group counts as "done" once
  // every task in it is done, matching the per-task ordering rule.
  type TaskRow = { kind: "task"; createdAt: Date; done: boolean; data: (typeof tasks)[number] };
  type GroupRow = { kind: "group"; createdAt: Date; done: boolean; data: (typeof taskGroups)[number] };
  const rows: (TaskRow | GroupRow)[] = [
    ...ungroupedTasks.map((task): TaskRow => ({ kind: "task", createdAt: task.createdAt, done: task.done, data: task })),
    ...ungroupedTaskGroups.map((group): GroupRow => ({
      kind: "group",
      createdAt: group.createdAt,
      done: group.totalCount > 0 && group.doneCount === group.totalCount,
      data: group,
    })),
  ].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const doneCount = tasks.filter((task) => task.done).length + taskGroups.reduce((sum, g) => sum + g.doneCount, 0);
  const totalCount = tasks.length + taskGroups.reduce((sum, g) => sum + g.totalCount, 0);

  // Options for the task/series/category assignee picker: either a
  // subcontractor company or an intérimaire (mutually exclusive).
  const assigneeOptions = { companies: companyOptions, interims: interimOptions };

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.projects.detail.tasksHeading} · {project.name}
          </h1>
          <Link
            href={`/clients/${id}/projects/${pid}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projectDashboard.backToProject}
          </Link>
        </div>

        {showTasks && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            <TasksSection
              clientId={clientId}
              projectId={pid}
              categories={taskCategories}
              canEdit={canEdit}
              icon={<ClipboardDocumentListIcon className="h-5 w-5 text-blue-500" />}
              title={t.projects.detail.tasksHeading}
              badge={totalCount > 0 ? `(${doneCount}/${totalCount})` : undefined}
            >
              {categorySections.map(({ category, groups, tasks: categoryTasks }) => (
                <ProjectTaskCategorySection
                  key={`category-${category.id}`}
                  category={category}
                  groups={groups}
                  tasks={categoryTasks}
                  categories={taskCategories}
                  clientId={clientId}
                  projectId={pid}
                  canEdit={canEdit}
                  assignees={assigneeOptions}
                />
              ))}

              {rows.length ? (
                <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                  {rows.map((row) =>
                    row.kind === "task" ? (
                      <ProjectTaskRow
                        key={`task-${row.data.id}`}
                        task={row.data}
                        clientId={clientId}
                        projectId={pid}
                        canEdit={canEdit}
                        categories={taskCategories}
                        assignees={assigneeOptions}
                      />
                    ) : (
                      <ProjectTaskGroupRow
                        key={`group-${row.data.id}`}
                        group={row.data}
                        clientId={clientId}
                        projectId={pid}
                        canEdit={canEdit}
                        categories={taskCategories}
                        assignees={assigneeOptions}
                      />
                    )
                  )}
                </ul>
              ) : categorySections.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
                  {t.projects.detail.noTasks}
                </div>
              ) : null}
            </TasksSection>
          </div>
        </div>
        )}

        {showMaterials && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
              <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold">
                <CubeIcon className="h-5 w-5 shrink-0 text-purple-500" />
                <span className="truncate">{t.projects.detail.materialsHeading}</span>
                {materials.length > 0 && (
                  <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">
                    ({materials.length})
                  </span>
                )}
              </h2>
              {canEdit && (
                <ScanDeliveryNoteModal
                  clientId={clientId}
                  projectId={pid}
                  materials={materials.map((m) => ({ id: m.id, name: m.name, supplierName: m.supplierName, reference: m.reference }))}
                />
              )}
            </div>

            {materials.length ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {materials.map((material) => (
                  <ProjectMaterialRow
                    key={material.id}
                    material={material}
                    clientId={clientId}
                    projectId={pid}
                    canEdit={canEdit}
                    linkOptions={materialLinkOptions}
                  />
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
                {t.projects.detail.noMaterials}
              </div>
            )}

            {canEdit && (
              <div className="border-t border-gray-300 dark:border-gray-700">
                <AddMaterialForm clientId={clientId} projectId={pid} linkOptions={materialLinkOptions} />
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </main>
  );
}
