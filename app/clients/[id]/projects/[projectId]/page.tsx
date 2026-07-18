import { getProject } from "@/actions/projects/projects";
import { findByProject } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findTaskCategoriesByProject } from "@/repository/taskCategories";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { findByProject as findInterventionsByProject } from "@/repository/interventions";
import { findChildren as findChildFolders, getBreadcrumb } from "@/repository/projectFolders";
import { findByFolder as findFilesByFolder } from "@/repository/projectFiles";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import Title from "@/components/Title";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import ProjectTaskGroupRow from "@/components/ProjectTaskGroupRow";
import ProjectTaskCategorySection from "@/components/ProjectTaskCategorySection";
import CollapsibleSection from "@/components/CollapsibleSection";
import ProjectMaterialRow from "@/components/ProjectMaterialRow";
import ProjectInterventionRow from "@/components/ProjectInterventionRow";
import ProjectFolderRow from "@/components/ProjectFolderRow";
import ProjectFileRow from "@/components/ProjectFileRow";
import AddTaskForm from "@/forms/AddTaskForm";
import GenerateTaskSeriesForm from "@/forms/GenerateTaskSeriesForm";
import AddTaskCategoryForm from "@/forms/AddTaskCategoryForm";
import AddMaterialForm, { type MaterialLinkOption } from "@/forms/AddMaterialForm";
import AddInterventionForm from "@/forms/AddInterventionForm";
import CreateFolderForm from "@/forms/CreateFolderForm";
import UploadFileForm from "@/forms/UploadFileForm";
import DeleteProjectButton from "@/app/clients/[id]/_components/DeleteProjectButton";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { format } from "@/lib/i18n/format";
import { computeTaskProgress, computeMaterialStockStats } from "@/lib/projectDashboard";
import {
  BoltIcon,
  CurrencyEuroIcon,
  MapPinIcon,
  CalendarIcon,
  PencilSquareIcon,
  ArrowLeftIcon,
  ClipboardDocumentListIcon,
  CubeIcon,
  FolderIcon,
  HomeIcon,
  ChevronRightIcon,
  ChartBarIcon,
  ArrowRightIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
  searchParams: Promise<{
    folder?: string;
  }>;
};

export default async function ProjectDetailPage({ params, searchParams }: PageProps) {
  const { id, projectId } = await params;
  const { folder: folderParam } = await searchParams;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);
  const parsedFolderId = folderParam ? parseInt(folderParam, 10) : NaN;
  const currentFolderId = Number.isNaN(parsedFolderId) ? null : parsedFolderId;

  const result = await getProject(pid);
  const isError = result.type === "error";
  const isEmpty = result.type === "success" && !result.data;
  const locale = await getLocale();
  const t = getDictionary(locale);

  if (isError) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projects.detail.title} />
        <p className="text-red-500">{result.message}</p>
      </main>
    );
  }

  if (isEmpty || result.data?.clientId !== clientId) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projects.detail.title} />
        <p>{t.projects.detail.notFound}</p>
      </main>
    );
  }

  const project = result.data!;
  const session = await auth();
  const canEdit = hasMinRole(session?.user?.role, "ADMIN");
  const [tasks, taskGroups, taskCategories, materials, interventions] = await Promise.all([
    findByProject(pid),
    findTaskGroupsByProject(pid),
    findTaskCategoriesByProject(pid),
    findMaterialsByProject(pid),
    findInterventionsByProject(pid),
  ]);
  // The material picker links to a standalone (ungrouped) task, a whole
  // series, or a whole category at once — series and categories are single
  // collapsed options, never expanded into their individual member tasks/series.
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
  const taskProgress = computeTaskProgress(tasks, taskGroups);
  const doneCount = taskProgress.done;
  const totalCount = taskProgress.total;
  const materialStats = computeMaterialStockStats(materials);

  const [subfolders, files, breadcrumb] = await Promise.all([
    findChildFolders(pid, currentFolderId),
    findFilesByFolder(pid, currentFolderId),
    getBreadcrumb(currentFolderId),
  ]);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
        <div className="overflow-hidden rounded-xl">
          <div className="border-b border-gray-300 dark:border-gray-700 px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <ProjectTypeBadge type={project.type} />
              <ProjectStatusBadge status={project.status} />
            </div>
          </div>

          <dl className="px-4 py-2 sm:px-6">
            {project.power != null && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <BoltIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.power}</dt>
                <dd className="min-w-0 text-sm">{project.power} kWc</dd>
              </div>
            )}
            {project.budget != null && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <CurrencyEuroIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.budget}</dt>
                <dd className="min-w-0 text-sm">{project.budget.toLocaleString(localeTag(locale))} €</dd>
              </div>
            )}
            {project.address && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <MapPinIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.address}</dt>
                <dd className="min-w-0 break-words text-sm">{project.address}</dd>
              </div>
            )}
            {(project.startDate || project.endDate) && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <CalendarIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.dates}</dt>
                <dd className="min-w-0 text-sm">
                  {project.startDate ? new Date(project.startDate).toLocaleDateString(localeTag(locale)) : "—"}
                  {" → "}
                  {project.endDate ? new Date(project.endDate).toLocaleDateString(localeTag(locale)) : "—"}
                </dd>
              </div>
            )}
            {project.notes && (
              <div className="flex items-start gap-3 py-3">
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.notes}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{project.notes}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-2.5 border-t border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-900 px-4 py-4 sm:px-6">
            {canEdit && (
              <Link
                href={`/clients/${id}/projects/${pid}/edit`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 sm:flex-none"
              >
                <PencilSquareIcon className="h-4 w-4" />
                {t.common.edit}
              </Link>
            )}
            {canEdit && <DeleteProjectButton projectId={pid} clientId={clientId} projectName={project.name} />}
            <Link
              href={`/clients/${id}`}
              className="inline-flex w-full items-center justify-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 sm:ml-auto sm:w-auto"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {t.common.back}
            </Link>
          </div>
        </div>
        </div>

        {/* Dashboard summary */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
        <div className="overflow-hidden rounded-xl">
          <div className="flex items-center justify-between gap-4 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ChartBarIcon className="h-5 w-5 text-blue-500" />
              {t.projects.detail.dashboardHeading}
            </h2>
          </div>
          <div className="flex flex-col gap-1.5 px-4 py-4 text-sm sm:px-6">
            <p>
              {totalCount > 0
                ? format(t.projects.detail.tasksProgress, { done: doneCount, total: totalCount, percent: taskProgress.percent })
                : t.projects.detail.noTasksProgress}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              {materialStats.tracked === 0
                ? t.projects.detail.noMaterialsTracked
                : materialStats.red + materialStats.orange === 0
                  ? t.projects.detail.materialsOk
                  : format(t.projects.detail.materialsAtRisk, { count: materialStats.red + materialStats.orange })}
            </p>
          </div>
          <div className="border-t border-gray-300 dark:border-gray-700 px-4 py-3 sm:px-6">
            <Link
              href={`/clients/${id}/projects/${pid}/dashboard`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
            >
              {t.projects.detail.viewDashboard}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        </div>

        {/* Tasks */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
        <div className="overflow-hidden rounded-xl">
          <CollapsibleSection
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
                  />
                ) : (
                  <ProjectTaskGroupRow
                    key={`group-${row.data.id}`}
                    group={row.data}
                    clientId={clientId}
                    projectId={pid}
                    canEdit={canEdit}
                    categories={taskCategories}
                  />
                )
              )}
            </ul>
          ) : categorySections.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.noTasks}
            </div>
          ) : null}

          {canEdit && (
            <div className="border-t border-gray-300 dark:border-gray-700">
              <AddTaskForm clientId={clientId} projectId={pid} categories={taskCategories} />
            </div>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2 border-t border-gray-300 dark:border-gray-700 px-4 py-3 sm:px-6">
              <GenerateTaskSeriesForm clientId={clientId} projectId={pid} categories={taskCategories} />
              <AddTaskCategoryForm clientId={clientId} projectId={pid} />
            </div>
          )}
          </CollapsibleSection>
        </div>
        </div>

        {/* Materials */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
        <div className="overflow-hidden rounded-xl">
          <CollapsibleSection
            icon={<CubeIcon className="h-5 w-5 text-purple-500" />}
            title={t.projects.detail.materialsHeading}
            badge={materials.length > 0 ? `(${materials.length})` : undefined}
          >
          {materials.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {materials.map((material) => (
                <ProjectMaterialRow key={material.id} material={material} clientId={clientId} projectId={pid} canEdit={canEdit} />
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
          </CollapsibleSection>
        </div>
        </div>

        {/* Interventions */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
        <div className="overflow-hidden rounded-xl">
          <CollapsibleSection
            icon={<WrenchScrewdriverIcon className="h-5 w-5 text-amber-500" />}
            title={t.projects.detail.interventionsHeading}
            badge={interventions.length > 0 ? `(${interventions.length})` : undefined}
          >
          {interventions.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {interventions.map((intervention) => (
                <ProjectInterventionRow
                  key={intervention.id}
                  intervention={intervention}
                  clientId={clientId}
                  projectId={pid}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.noInterventions}
            </div>
          )}

          {canEdit && (
            <div className="border-t border-gray-300 dark:border-gray-700">
              <AddInterventionForm clientId={clientId} projectId={pid} />
            </div>
          )}
          </CollapsibleSection>
        </div>
        </div>

        {/* Files */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
        <div className="overflow-hidden rounded-xl">
          <CollapsibleSection
            icon={<FolderIcon className="h-5 w-5 text-amber-500" />}
            title={t.projects.detail.filesHeading}
            headerExtra={canEdit && <CreateFolderForm clientId={clientId} projectId={pid} parentId={currentFolderId} />}
          >
          {/* Breadcrumb */}
          <div className="flex flex-wrap items-center gap-1 border-b border-gray-300 dark:border-gray-700 px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 sm:px-6">
            <Link
              href={`/clients/${id}/projects/${pid}`}
              className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label={t.files.home}
            >
              <HomeIcon className="h-4 w-4" />
            </Link>
            {breadcrumb.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRightIcon className="h-3.5 w-3.5" />
                <Link
                  href={`/clients/${id}/projects/${pid}?folder=${crumb.id}`}
                  className="truncate hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {crumb.name}
                </Link>
              </span>
            ))}
          </div>

          {subfolders.length || files.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {subfolders.map((folder) => (
                <ProjectFolderRow key={`folder-${folder.id}`} folder={folder} clientId={clientId} projectId={pid} canEdit={canEdit} />
              ))}
              {files.map((file) => (
                <ProjectFileRow key={`file-${file.id}`} file={file} clientId={clientId} projectId={pid} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.emptyFolder}
            </div>
          )}

          {canEdit && (
            <div className="border-t border-gray-300 dark:border-gray-700">
              <UploadFileForm clientId={clientId} projectId={pid} folderId={currentFolderId} />
            </div>
          )}
          </CollapsibleSection>
        </div>
        </div>

      </div>
    </main>
  );
}
