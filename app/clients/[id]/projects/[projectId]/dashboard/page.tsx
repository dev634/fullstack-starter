import { getProject } from "@/actions/projects/projects";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { getHiddenSections } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { blockClientFromApp } from "@/lib/portal";
import { findByProject, computeProgressByInterim, computeProgressByCompany } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findTaskCategoriesByProject } from "@/repository/taskCategories";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { tallyByProject as tallyReservesByProject } from "@/repository/reserves";
import { computeTaskProgress, computeTaskBarStats, computeTrackedMaterials, roundPercent } from "@/lib/projectDashboard";
import { STOCK_DOT_CLASSES } from "@/lib/materialStock";
import { resolveReserveStatusStyle } from "@/lib/reserveStatusStyle";
import Title from "@/components/Title";
import TaskProgressDonut from "@/components/charts/TaskProgressDonut";
import SeriesProgressBars from "@/components/charts/SeriesProgressBars";
import SeriesProgressRings from "@/components/charts/SeriesProgressRings";
import MaterialStockDonut from "@/components/charts/MaterialStockDonut";
import CollapsibleSection from "@/components/CollapsibleSection";
import PrintReportButton from "@/components/PrintReportButton";
import ReserveStatusStyleVars from "@/components/ReserveStatusStyleVars";
import StatusPill from "@/components/StatusPill";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import {
  ArrowLeftIcon,
  ClipboardDocumentListIcon,
  CubeIcon,
  UsersIcon,
  BuildingOfficeIcon,
  MapPinIcon,
} from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
};

export default async function ProjectDashboardPage({ params }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);
  const locale = await getLocale();
  const t = getDictionary(locale);

  const result = await getProject(pid);
  const isError = result.type === "error";
  const isEmpty = result.type === "success" && !result.data;

  if (isError) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projectDashboard.title} />
        <p className="text-red-500">{result.message}</p>
      </main>
    );
  }

  // Same scope rule as the project page — a dashboard is just another view
  // of the same chantier.
  const access = await getAccessContext();
  const outOfScope = result.data ? !canReachProject(access, result.data.id) : false;
  // Same not-found fold as the project detail page: the `projects` rubrique
  // governs whether a project exists for this caller AT ALL (see that page's
  // comment for why this doesn't need the anti-enumeration branching that
  // outOfScope does).
  const hiddenByArea = !(await canAccessArea("projects"));

  if (isEmpty || result.data?.clientId !== clientId || outOfScope || hiddenByArea) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projectDashboard.title} />
        <p>{t.projectDashboard.notFound}</p>
      </main>
    );
  }

  const project = result.data!;
  // A function that hides the "tasks"/"materials" sections on the detail
  // page must hide the same data here — this dashboard is just another view
  // onto it, and task titles/material names below end up as props of a
  // Client Component (so in the HTML) if fetched.
  const hiddenSections = await getHiddenSections();
  const showTasks = !hiddenSections.has("tasks");
  const showMaterials = !hiddenSections.has("materials");
  // Progress-by-assignee is a derived VIEW of task/série/catégorie data (just
  // grouped by who it's assigned to instead of by category) — hidden the
  // moment "tasks" is, same as the categories/detail sections above, per
  // docs/CONVENTIONS.md's "a neighbouring view of a guarded screen carries
  // the same guards". It ALSO carries the workforce identity guard on top:
  // an intérimaire's/company's own NAME is personnel data, gated by
  // "interims"/"subcontractors" on the workforce page — hiding one of those
  // must hide their name from surfacing here too, even when "tasks" stays
  // visible.
  const showInterimProgress = showTasks && !hiddenSections.has("interims");
  const showCompanyProgress = showTasks && !hiddenSections.has("subcontractors");
  const showReserves = !hiddenSections.has("reserves");
  const [tasks, taskGroups, taskCategories, materials, interimProgress, companyProgress, reserveTally] =
    await Promise.all([
      showTasks ? findByProject(pid) : Promise.resolve([]),
      showTasks ? findTaskGroupsByProject(pid) : Promise.resolve([]),
      showTasks ? findTaskCategoriesByProject(pid) : Promise.resolve([]),
      showMaterials ? findMaterialsByProject(pid) : Promise.resolve([]),
      // Both computed entirely in SQL (GROUP BY), never by loading every
      // task/série/catégorie row into JS — see repository/tasks.ts's own doc
      // for the weighting rule and its equivalence proof against
      // lib/projectDashboard.ts::computeTaskBarStats/computeTaskProgress.
      showInterimProgress ? computeProgressByInterim(pid) : Promise.resolve([]),
      showCompanyProgress ? computeProgressByCompany(pid) : Promise.resolve([]),
      // repository/reserves.ts::tallyByProject already exists — a plain
      // groupBy(status), never a réserve row.
      showReserves ? tallyReservesByProject(pid) : Promise.resolve({ total: 0, open: 0, resolved: 0 }),
    ]);

  const taskProgress = computeTaskProgress(tasks, taskGroups, taskCategories);

  // One bar per category and per ungrouped series — a categorized series or
  // task is rolled into its category's own bar instead of appearing on its
  // own (see computeTaskProgress).
  const categoryProgress = taskProgress.groups;

  // The donut's slices must not double-count: only bars not already folded
  // into a category/series rollup above (i.e. uncategorized standalone
  // tasks) get their own slice, alongside the category/series bars.
  const donutItems = [
    ...categoryProgress,
    ...tasks
      .filter((task) => task.categoryId == null)
      .map((task) => ({ id: `task-${task.id}`, name: task.title, ...computeTaskBarStats(task) })),
  ];

  // Every standalone task gets its own bar here, regardless of category —
  // a more granular, separate view than "Avancement par catégorie / groupe"
  // above, so a categorized task legitimately appears in both sections. A
  // quantity-tracked task reports its actual count (e.g. 32/50) rather than
  // a flat 0/1. A generated series is one row here too — its name with the
  // done/total task count — not exploded into each of its member tasks.
  const taskDetailProgress = [
    ...tasks.map((task) => ({ id: `task-${task.id}`, name: task.title, ...computeTaskBarStats(task) })),
    ...taskGroups.map((group) => ({
      id: `group-${group.id}`,
      name: group.name,
      done: group.doneCount,
      total: group.totalCount,
      percent: roundPercent(group.doneCount, group.totalCount),
    })),
  ];

  const namedMaterials = computeTrackedMaterials(materials);

  // This project's resolved OPEN/RESOLVED réserve label + colour — same
  // source the hub page and the dedicated réserves page already use, so the
  // pills below can never show a different colour/label than either of them.
  const reserveStatusStyle = resolveReserveStatusStyle(project, t.reserves.status);

  // Badges for each section's collapsed header — the single figure a
  // conducteur de travaux wants without opening it. Undefined (no badge)
  // when there is nothing to summarize yet, matching every other section's
  // own "…None" empty state.
  const taskBadge =
    taskProgress.total > 0
      ? format(t.projectDashboard.tasksBadge, {
          percent: Math.round(taskProgress.percent),
          done: taskProgress.done,
          total: taskProgress.total,
        })
      : undefined;
  // How many assignees actually have something on this chantier — not a
  // progress figure (there is no single "percent done" across people), so a
  // plain count, same "(n)" shorthand the client page's own Contacts/Projects
  // sections already use for their badges.
  const interimBadge = interimProgress.length > 0 ? `(${interimProgress.length})` : undefined;
  const companyBadge = companyProgress.length > 0 ? `(${companyProgress.length})` : undefined;
  // Open count, in the same words as the pill just below it once expanded
  // (t.reserves.countWithLabel) — the vocabulary must not shift between the
  // closed and open state. Shown as soon as there's at least one réserve at
  // all (including "0 <label>"), because "nothing open" is itself the piece
  // of information a conducteur wants without opening the section.
  const reservesBadge =
    reserveTally.total > 0
      ? format(t.reserves.countWithLabel, { count: reserveTally.open, label: reserveStatusStyle.open.label })
      : undefined;
  // Materials actually tracked against a required quantity (computeTrackedMaterials'
  // own filter) — the same population the donut/list below render.
  const materialsBadge = namedMaterials.length > 0 ? `(${namedMaterials.length})` : undefined;

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      {/* Rendered unconditionally, like the hub page's own instance: harmless
          even when showReserves ends up false, and a page only ever renders
          one project's réserves at a time (this component's own doc). */}
      <ReserveStatusStyleVars style={reserveStatusStyle} />
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.projectDashboard.title} · {project.name}
          </h1>
          <Link
            href={`/clients/${id}/projects/${pid}`}
            className="print:hidden inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projectDashboard.backToProject}
          </Link>
        </div>

        {/* Task progress */}
        {showTasks && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm print:border-gray-300 print:bg-white print:text-gray-900 print:shadow-none dark:print:border-gray-300 dark:print:bg-white dark:print:text-gray-900">
          <div className="overflow-hidden rounded-xl">
            <CollapsibleSection
              icon={<ClipboardDocumentListIcon className="h-5 w-5 text-blue-500" />}
              title={t.projectDashboard.tasksTitle}
              badge={taskBadge}
              headerExtra={<PrintReportButton />}
            >
            <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
              {taskProgress.total > 0 ? (
                <div className="flex flex-col items-center gap-1">
                  <TaskProgressDonut
                    items={donutItems}
                    done={taskProgress.done}
                    total={taskProgress.total}
                    percent={taskProgress.percent}
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t.projectDashboard.tasksOverall}</span>
                </div>
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.tasksNone}</p>
              )}

              {categoryProgress.length > 0 && (
                <div className="border-t border-gray-300 dark:border-gray-700 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t.projectDashboard.categoriesTitle}</h3>
                  <SeriesProgressRings items={categoryProgress} t={t} />
                </div>
              )}

              {taskDetailProgress.length > 0 && (
                <div className="border-t border-gray-300 dark:border-gray-700 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t.projectDashboard.detailedTitle}</h3>
                  <SeriesProgressBars items={taskDetailProgress} />
                </div>
              )}
            </div>
            </CollapsibleSection>
          </div>
        </div>
        )}

        {/* Progress by intérimaire — one bar per person, each summing every
            task/série/catégorie assigned to them (repository/tasks.ts::
            computeProgressByInterim, a GROUP BY, never a task/série/catégorie
            row). SeriesProgressBars, not a grid of rings: this project's
            crew is a flat, comparable list of names exactly like the
            per-task detail section above (and there is no rings component in
            this codebase to reuse instead — only the donut and this bar
            chart exist). An assignee still gets a bar at 0/0 when everything
            assigned to them (e.g. an empty série) has no task in it yet —
            informative ("assigned, nothing to do yet"), not hidden. */}
        {showInterimProgress && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm print:border-gray-300 print:bg-white print:text-gray-900 print:shadow-none dark:print:border-gray-300 dark:print:bg-white dark:print:text-gray-900">
          <div className="overflow-hidden rounded-xl">
            <CollapsibleSection
              icon={<UsersIcon className="h-5 w-5 text-teal-500" />}
              title={t.projectDashboard.interimsTitle}
              badge={interimBadge}
            >
            <div className="px-4 py-6 sm:px-6">
              {interimProgress.length > 0 ? (
                <SeriesProgressBars items={interimProgress} />
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.interimsNone}</p>
              )}
            </div>
            </CollapsibleSection>
          </div>
        </div>
        )}

        {/* Progress by subcontractor company — mirror-imaged version of the
            section above (repository/tasks.ts::computeProgressByCompany). */}
        {showCompanyProgress && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm print:border-gray-300 print:bg-white print:text-gray-900 print:shadow-none dark:print:border-gray-300 dark:print:bg-white dark:print:text-gray-900">
          <div className="overflow-hidden rounded-xl">
            <CollapsibleSection
              icon={<BuildingOfficeIcon className="h-5 w-5 text-amber-500" />}
              title={t.projectDashboard.companiesTitle}
              badge={companyBadge}
            >
            <div className="px-4 py-6 sm:px-6">
              {companyProgress.length > 0 ? (
                <SeriesProgressBars items={companyProgress} />
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.companiesNone}</p>
              )}
            </div>
            </CollapsibleSection>
          </div>
        </div>
        )}

        {/* Réserves — open vs resolved is only two numbers, so a chart would
            add a grammar for no real gain; the coloured pills (this
            project's own configured OPEN/RESOLVED label + colour, same
            mechanism and same classes as the hub page's card) already read
            as a status at a glance. PROGRESS_REMAINING_COLOR's own 2.31:1
            contrast defect (lib/chartColors.ts) doesn't apply here — this
            section reuses the réserve status colours, not the progress
            chart palette, and every count is paired with its own text label
            regardless. */}
        {showReserves && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm print:border-gray-300 print:bg-white print:text-gray-900 print:shadow-none dark:print:border-gray-300 dark:print:bg-white dark:print:text-gray-900">
          <div className="overflow-hidden rounded-xl">
            <CollapsibleSection
              icon={<MapPinIcon className="h-5 w-5 text-rose-500" />}
              title={t.projectDashboard.reservesTitle}
              badge={reservesBadge}
            >
            <div className="flex flex-col items-center gap-3 px-4 py-6 sm:px-6">
              {reserveTally.total > 0 ? (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <StatusPill className="reserve-pill-open">
                    {format(t.reserves.countWithLabel, { count: reserveTally.open, label: reserveStatusStyle.open.label })}
                  </StatusPill>
                  <StatusPill className="reserve-pill-resolved">
                    {format(t.reserves.countWithLabel, {
                      count: reserveTally.resolved,
                      label: reserveStatusStyle.resolved.label,
                    })}
                  </StatusPill>
                </div>
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.reservesNone}</p>
              )}
            </div>
            </CollapsibleSection>
          </div>
        </div>
        )}

        {/* Material stock */}
        {showMaterials && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm print:border-gray-300 print:bg-white print:text-gray-900 print:shadow-none dark:print:border-gray-300 dark:print:bg-white dark:print:text-gray-900">
          <div className="overflow-hidden rounded-xl">
            <CollapsibleSection
              icon={<CubeIcon className="h-5 w-5 text-purple-500" />}
              title={t.projectDashboard.materialsTitle}
              badge={materialsBadge}
            >
            <div className="flex flex-col items-center gap-1 px-4 py-6 sm:px-6">
              {namedMaterials.length > 0 ? (
                <MaterialStockDonut materials={namedMaterials} untracked={materials.length - namedMaterials.length} />
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.materialsNone}</p>
              )}
            </div>

            {namedMaterials.length > 0 && (
              <div className="border-t border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6 print:border-gray-300 dark:print:border-gray-300">
                <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t.projectDashboard.materialsListTitle}
                </h3>
                <ul className="divide-y divide-gray-300 dark:divide-gray-700 print:divide-gray-300 dark:print:divide-gray-300">
                  {namedMaterials.map((material) => (
                    <li key={material.id} className="flex items-center gap-3 py-2 text-sm">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${STOCK_DOT_CLASSES[material.status]}`}
                        title={t.materials.stockStatus[material.status]}
                        aria-label={t.materials.stockStatus[material.status]}
                      />
                      <span className="min-w-0 flex-1 truncate">{material.name}</span>
                      <span className="shrink-0 text-gray-500 dark:text-gray-400">
                        {material.quantity} / {material.requiredQuantity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </CollapsibleSection>
          </div>
        </div>
        )}
      </div>
    </main>
  );
}
