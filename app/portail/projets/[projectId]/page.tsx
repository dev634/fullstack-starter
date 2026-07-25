import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeftIcon,
  BoltIcon,
  HashtagIcon,
  MapPinIcon,
  CalendarIcon,
  ChartBarIcon,
  MapIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import { requirePortalContext } from "@/lib/portal";
import { findById } from "@/repository/projects";
import { findByProject as findTasksByProject } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findReservePlansByProject } from "@/repository/reservePlans";
import { computeTaskProgress } from "@/lib/projectDashboard";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import { localeTag } from "@/lib/i18n/formatDate";

// Read-only view of a single project for a client-portal login. Guarded twice:
// the id must be in the contact's linked set AND belong to the contact's own
// company — a client can never reach a project outside its scope.
export default async function PortalProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requirePortalContext();
  const pid = Number((await params).projectId);
  if (!Number.isInteger(pid) || !ctx.projectIds.has(pid)) {
    redirect("/portail");
  }

  const project = await findById(pid);
  if (!project || project.deletedAt || project.clientId !== ctx.clientId) {
    notFound();
  }

  const locale = await getLocale();
  const t = getDictionary(locale);

  const [tasks, taskGroups, reservePlans] = await Promise.all([
    findTasksByProject(pid),
    findTaskGroupsByProject(pid),
    findReservePlansByProject(pid),
  ]);
  const progress = computeTaskProgress(tasks, taskGroups);
  const reserveCount = reservePlans.reduce((sum, plan) => sum + plan.reserves.length, 0);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <Link
          href="/portail"
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t.portal.backToProjects}
        </Link>

        {/* Identity + info */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="border-b border-gray-300 dark:border-gray-700 px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <ProjectTypeBadge type={project.type} />
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{ctx.companyName}</p>
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
            {/* Budget and notes are intentionally NOT exposed in the client
                portal — they can hold internal cost/margin and private remarks. */}
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
          </dl>
        </div>

        {/* Progress */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <ChartBarIcon className="h-5 w-5 text-blue-500" />
            <h2 className="text-lg font-semibold">{t.projects.detail.dashboardHeading}</h2>
          </div>
          <div className="px-4 py-4 text-sm sm:px-6">
            {progress.total > 0 ? (
              <p>{format(t.projects.detail.tasksProgress, { done: progress.done, total: progress.total, percent: progress.percent.toFixed(2) })}</p>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">{t.projects.detail.noTasksProgress}</p>
            )}
          </div>
        </div>

        {/* Réserves (read-only) */}
        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <MapIcon className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold">{t.reserves.heading}</h2>
            {reserveCount > 0 && <span className="text-sm text-gray-500 dark:text-gray-400">({reserveCount})</span>}
          </div>
          <div className="px-4 py-4 text-sm sm:px-6">
            {reserveCount === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">{format(t.reserves.reserveCount, { count: 0 })}</p>
            ) : (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {reservePlans.flatMap((plan) =>
                  plan.reserves.map((reserve) => (
                    <li key={reserve.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate">{reserve.description}</span>
                      {reserve.photos.length > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <PhotoIcon className="h-3.5 w-3.5" />
                          {reserve.photos.length}
                        </span>
                      )}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
