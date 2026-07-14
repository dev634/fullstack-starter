import { getProject } from "@/actions/projects/projects";
import { findByProject } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { computeTaskProgress, computeTrackedMaterials } from "@/lib/projectDashboard";
import { STOCK_DOT_CLASSES } from "@/lib/materialStock";
import Title from "@/components/Title";
import TaskProgressDonut from "@/components/charts/TaskProgressDonut";
import SeriesProgressBars from "@/components/charts/SeriesProgressBars";
import MaterialStockDonut from "@/components/charts/MaterialStockDonut";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { ArrowLeftIcon, ClipboardDocumentListIcon, CubeIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
};

export default async function ProjectDashboardPage({ params }: PageProps) {
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

  if (isEmpty || result.data?.clientId !== clientId) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
        <Title title={t.projectDashboard.title} />
        <p>{t.projectDashboard.notFound}</p>
      </main>
    );
  }

  const project = result.data!;
  const [tasks, taskGroups, materials] = await Promise.all([
    findByProject(pid),
    findTaskGroupsByProject(pid),
    findMaterialsByProject(pid),
  ]);

  const taskProgress = computeTaskProgress(tasks, taskGroups);

  // One percentage bar per series, plus one per standalone task (0% or 100%
  // since a single task has no partial state) — series first, since they
  // typically represent the bulk of the work.
  const detailedProgress = [
    ...taskProgress.groups,
    ...tasks.map((task) => ({
      id: `task-${task.id}`,
      name: task.title,
      done: task.done ? 1 : 0,
      total: 1,
      percent: task.done ? 100 : 0,
    })),
  ];

  const namedMaterials = computeTrackedMaterials(materials);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.projectDashboard.title} · {project.name}
          </h1>
          <Link
            href={`/clients/${id}/projects/${pid}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projectDashboard.backToProject}
          </Link>
        </div>

        {/* Task progress */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            <div className="flex items-center gap-2 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
              <ClipboardDocumentListIcon className="h-5 w-5 text-blue-500" />
              <h2 className="text-lg font-semibold">{t.projectDashboard.tasksTitle}</h2>
            </div>

            <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
              {taskProgress.total > 0 ? (
                <div className="flex flex-col items-center gap-1">
                  <TaskProgressDonut done={taskProgress.done} total={taskProgress.total} percent={taskProgress.percent} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t.projectDashboard.tasksOverall}</span>
                </div>
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.tasksNone}</p>
              )}

              {detailedProgress.length > 0 && (
                <div className="border-t border-gray-300 dark:border-gray-700 pt-4">
                  <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t.projectDashboard.detailedTitle}</h3>
                  <SeriesProgressBars items={detailedProgress} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Material stock */}
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            <div className="flex items-center gap-2 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
              <CubeIcon className="h-5 w-5 text-purple-500" />
              <h2 className="text-lg font-semibold">{t.projectDashboard.materialsTitle}</h2>
            </div>

            <div className="flex flex-col items-center gap-1 px-4 py-6 sm:px-6">
              {namedMaterials.length > 0 ? (
                <MaterialStockDonut materials={namedMaterials} />
              ) : (
                <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.projectDashboard.materialsNone}</p>
              )}
            </div>

            {namedMaterials.length > 0 && (
              <div className="border-t border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
                <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t.projectDashboard.materialsListTitle}
                </h3>
                <ul className="divide-y divide-gray-300 dark:divide-gray-700">
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
          </div>
        </div>
      </div>
    </main>
  );
}
