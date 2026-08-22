import { getProject } from "@/actions/projects/projects";
import { findByProject } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findTaskCategoriesByProject } from "@/repository/taskCategories";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { findByProject as findInterventionsByProject } from "@/repository/interventions";
import { findCompaniesByProject } from "@/repository/subcontractors";
import { findByProject as findInterimsByProject } from "@/repository/interims";
import { findAllOptions as findJobFunctions } from "@/repository/jobFunctions";
import { findChildren as findChildFolders, getBreadcrumb } from "@/repository/projectFolders";
import { findByFolder as findFilesByFolder } from "@/repository/projectFiles";
import { findByProject as findReservePlansByProject } from "@/repository/reservePlans";
import { tallyByProject as tallyReservesByProject } from "@/repository/reserves";
import {
  findByProject as findReserveFoldersByProject,
  findChildren as findReserveChildFolders,
  getBreadcrumb as getReserveBreadcrumb,
} from "@/repository/reservePlanFolders";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import Title from "@/components/Title";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import ProjectTaskRow from "@/components/ProjectTaskRow";
import ProjectTaskGroupRow from "@/components/ProjectTaskGroupRow";
import ProjectTaskCategorySection from "@/components/ProjectTaskCategorySection";
import CollapsibleSection from "@/components/CollapsibleSection";
import TasksSection from "@/components/TasksSection";
import ProjectMaterialRow from "@/components/ProjectMaterialRow";
import ScanDeliveryNoteModal from "@/components/ScanDeliveryNoteModal";
import ProjectInterventionRow from "@/components/ProjectInterventionRow";
import ProjectSubcontractorCompanyRow from "@/components/ProjectSubcontractorCompanyRow";
import ProjectInterimRow from "@/components/ProjectInterimRow";
import ProjectFolderRow from "@/components/ProjectFolderRow";
import ProjectFileRow from "@/components/ProjectFileRow";
import AddMaterialForm, { type MaterialLinkOption } from "@/forms/AddMaterialForm";
import AddInterventionForm from "@/forms/AddInterventionForm";
import AddSubcontractorCompanyForm from "@/forms/AddSubcontractorCompanyForm";
import AddInterimForm from "@/forms/AddInterimForm";
import CreateFolderForm from "@/forms/CreateFolderForm";
import UploadFileForm from "@/forms/UploadFileForm";
import ReservesSection from "@/components/ReservesSection";
import AddReservePlanForm from "@/forms/AddReservePlanForm";
import AddReserveFolderForm from "@/forms/AddReserveFolderForm";
import { parseReserveFolderId } from "@/lib/reserveFolderParam";
import DeleteProjectButton from "@/app/clients/[id]/_components/DeleteProjectButton";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { format } from "@/lib/i18n/format";
import { getAppSettings } from "@/lib/appSettings";
import { normalizeSectionOrder, type ProjectSectionKey } from "@/lib/projectSections";
import { getHiddenSections } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { blockClientFromApp } from "@/lib/portal";
import type { ReactNode } from "react";
import { computeTaskProgress, computeMaterialStockStats } from "@/lib/projectDashboard";
import {
  BoltIcon,
  HashtagIcon,
  CurrencyEuroIcon,
  MapPinIcon,
  CalendarIcon,
  PencilSquareIcon,
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentListIcon,
  CubeIcon,
  FolderIcon,
  HomeIcon,
  ChevronRightIcon,
  ChartBarIcon,
  ArrowRightIcon,
  WrenchScrewdriverIcon,
  BuildingOfficeIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
  searchParams: Promise<{
    /** Files module browser. */
    folder?: string;
    /** Réserves browser — a separate param so both can be open at once. */
    rfolder?: string;
  }>;
};

export default async function ProjectDetailPage({ params, searchParams }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const { folder: folderParam, rfolder: reserveFolderParam } = await searchParams;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);
  const parsedFolderId = folderParam ? parseInt(folderParam, 10) : NaN;
  const currentFolderId = Number.isNaN(parsedFolderId) ? null : parsedFolderId;
  const currentReserveFolderId = parseReserveFolderId(reserveFolderParam);

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

  // A project outside the caller's scope is "not found", not "forbidden": a
  // distinct error would confirm the project exists, letting someone map the
  // company's chantiers by walking ids.
  const access = await getAccessContext();
  const outOfScope = result.data ? !canReachProject(access, result.data.id) : false;
  // The `projects` rubrique — the same one gating the standalone /projects
  // list, its CSV export, and the guarded asset delivery route (see
  // docs/CONVENTIONS.md's access-axes table) — governs whether a project
  // exists for this caller AT ALL. hiddenSections (used further down) only
  // decides which of ITS sections render, a narrower question that assumes
  // the project itself is already reachable. Folded into the same not-found
  // branch as outOfScope above: this is a blanket, function-level rule (not
  // tied to this one project), so it doesn't need the anti-enumeration
  // reasoning that branch exists for — it just reuses the same rendering.
  const hiddenByArea = !(await canAccessArea("projects"));

  if (isEmpty || result.data?.clientId !== clientId || outOfScope || hiddenByArea) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projects.detail.title} />
        <p>{t.projects.detail.notFound}</p>
      </main>
    );
  }

  const project = result.data!;
  const session = await auth();
  const canEdit = (await can(session?.user?.role, "content.edit"));
  const [tasks, taskGroups, taskCategories, materials, interventions, subcontractorCompanies, interims, jobFunctions] =
    await Promise.all([
      findByProject(pid),
      findTaskGroupsByProject(pid),
      findTaskCategoriesByProject(pid),
      findMaterialsByProject(pid),
      findInterventionsByProject(pid),
      findCompaniesByProject(pid),
      findInterimsByProject(pid),
      // Managed job functions offered in the intérimaire add form's dropdown.
      canEdit ? findJobFunctions() : Promise.resolve([]),
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
  // Options for the task/series/category assignee picker: either a
  // subcontractor company or an intérimaire (mutually exclusive).
  const assigneeOptions = {
    companies: subcontractorCompanies.map((c) => ({ id: c.id, name: c.name })),
    interims: interims.map((i) => ({ id: i.id, name: i.name })),
  };

  const [
    subfolders,
    files,
    breadcrumb,
    reservePlans,
    reserveFolders,
    reserveSubfolders,
    reserveBreadcrumb,
    reserveTally,
  ] = await Promise.all([
    findChildFolders(pid, currentFolderId),
    findFilesByFolder(pid, currentFolderId),
    getBreadcrumb(pid, currentFolderId),
    // boundReserves: true — passe 3b (C2), point 4. See findByProject's own
    // doc (repository/reservePlans.ts) for why this page opts in and the PDF
    // report route does not.
    findReservePlansByProject(pid, { boundReserves: true }),
    // Full flat list — for the plan "move to folder" target list + counts.
    findReserveFoldersByProject(pid),
    // Current level's children + its path, for the nested browser.
    findReserveChildFolders(pid, currentReserveFolderId),
    getReserveBreadcrumb(pid, currentReserveFolderId),
    // Passe 3b (C2), point 4: a project-wide, always-accurate tally — see
    // repository/reserves.ts::tallyByProject's own doc for why this can no
    // longer be derived from reservePlans now that its réserves are bounded.
    tallyReservesByProject(pid),
  ]);
  // What a foreman is actually looking for is what's left to treat — the
  // section badge below keeps showing the plan count (existing info, kept
  // as-is) and appends how many réserves are still open (reserveTally, now
  // fetched above via tallyReservesByProject rather than derived here).

  // SUPERADMIN-configured display order of the collapsible sections below,
  // normalized so a partial/stale stored value is always safe.
  const appSettings = await getAppSettings();
  // SUPERADMIN order, then drop any section the current user's job function
  // hides (ADMIN+ are exempt and see them all).
  const hiddenSections = await getHiddenSections();
  const sectionOrder = normalizeSectionOrder(appSettings.projectSectionOrder).filter(
    (key) => !hiddenSections.has(key)
  );

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
            {project.businessNumber && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <HashtagIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-24 shrink-0 text-sm text-gray-500 dark:text-gray-400">{t.projects.detail.businessNumber}</dt>
                <dd className="min-w-0 break-words text-sm">{project.businessNumber}</dd>
              </div>
            )}
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
                ? format(t.projects.detail.tasksProgress, { done: doneCount, total: totalCount, percent: taskProgress.percent.toFixed(2) })
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

        {/* Reorderable "dropdown" sections. Built as a key -> node map so the
            display order is a pure data concern (the SUPERADMIN order from
            lib/projectSections.ts), then each is wrapped once in the shared
            card chrome and rendered in that order. */}
        {(() => {
        const sectionContent: Record<ProjectSectionKey, ReactNode> = {
        tasks: (
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
        ),
        materials: (
          <CollapsibleSection
            icon={<CubeIcon className="h-5 w-5 text-purple-500" />}
            title={t.projects.detail.materialsHeading}
            badge={materials.length > 0 ? `(${materials.length})` : undefined}
            headerExtra={
              canEdit && (
                <ScanDeliveryNoteModal
                  clientId={clientId}
                  projectId={pid}
                  materials={materials.map((m) => ({ id: m.id, name: m.name, supplierName: m.supplierName, reference: m.reference }))}
                />
              )
            }
          >
          {materials.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {materials.map((material) => (
                <ProjectMaterialRow key={material.id} material={material} clientId={clientId} projectId={pid} canEdit={canEdit} linkOptions={materialLinkOptions} />
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
        ),
        interventions: (
          <CollapsibleSection
            icon={<WrenchScrewdriverIcon className="h-5 w-5 text-amber-500" />}
            title={t.projects.detail.interventionsHeading}
            badge={interventions.length > 0 ? `(${interventions.length})` : undefined}
            headerExtra={canEdit && <AddInterventionForm clientId={clientId} projectId={pid} />}
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
          </CollapsibleSection>
        ),
        subcontractors: (
          <CollapsibleSection
            icon={<BuildingOfficeIcon className="h-5 w-5 text-amber-500" />}
            title={t.projects.detail.subcontractorsHeading}
            badge={subcontractorCompanies.length > 0 ? `(${subcontractorCompanies.length})` : undefined}
            headerExtra={canEdit && <AddSubcontractorCompanyForm clientId={clientId} projectId={pid} />}
          >
          {subcontractorCompanies.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {subcontractorCompanies.map((company) => (
                <ProjectSubcontractorCompanyRow
                  key={company.id}
                  company={company}
                  clientId={clientId}
                  projectId={pid}
                  canEdit={canEdit}
                  functions={jobFunctions}
                />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.noSubcontractors}
            </div>
          )}
          </CollapsibleSection>
        ),
        interims: (
          <CollapsibleSection
            icon={<UsersIcon className="h-5 w-5 text-teal-500" />}
            title={t.projects.detail.interimsHeading}
            badge={interims.length > 0 ? `(${interims.length})` : undefined}
            headerExtra={canEdit && <AddInterimForm clientId={clientId} projectId={pid} functions={jobFunctions} />}
          >
          {interims.length ? (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700">
              {interims.map((interim) => (
                <ProjectInterimRow key={interim.id} interim={interim} clientId={clientId} projectId={pid} canEdit={canEdit} />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              {t.projects.detail.noInterims}
            </div>
          )}
          </CollapsibleSection>
        ),
        files: (
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
        ),
        reserves: (
          <CollapsibleSection
            icon={<MapPinIcon className="h-5 w-5 text-rose-500" />}
            title={t.reserves.heading}
            badge={
              reservePlans.length > 0
                ? reserveTally.total > 0
                  ? `(${reservePlans.length}) · ${format(t.reserves.openCount, { count: reserveTally.open })}`
                  : `(${reservePlans.length})`
                : undefined
            }
            headerExtra={
              // Siblings, not a wrapper div: the header is a flex-wrap row, so
              // each button must be its own item or they'd stay glued together
              // and squeeze the section title off-screen on mobile.
              <>
                {/* Export is read-only: anyone who can open the project may
                    download what the section already shows them. */}
                {reservePlans.length > 0 && (
                  <a
                    href={`/clients/${clientId}/projects/${pid}/reserves/report`}
                    className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600"
                  >
                    <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                    {t.reserves.exportPdf}
                  </a>
                )}
                {canEdit && (
                  <AddReserveFolderForm clientId={clientId} projectId={pid} parentId={currentReserveFolderId} />
                )}
                {canEdit && (
                  <AddReservePlanForm clientId={clientId} projectId={pid} folders={reserveFolders} />
                )}
              </>
            }
          >
            <ReservesSection
              clientId={clientId}
              projectId={pid}
              plans={reservePlans}
              subfolders={reserveSubfolders}
              breadcrumb={reserveBreadcrumb}
              allFolders={reserveFolders}
              currentFolderId={currentReserveFolderId}
              canEdit={canEdit}
            />
          </CollapsibleSection>
        ),
        };
        return sectionOrder.map((key) => (
          <div
            key={key}
            className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600"
          >
            <div className="overflow-hidden rounded-xl">{sectionContent[key]}</div>
          </div>
        ));
        })()}

      </div>
    </main>
  );
}
