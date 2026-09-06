import { findByProject as findInterventionsByProject } from "@/repository/interventions";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { resolveProjectSectionAccess } from "@/lib/projectSectionGuard";
import { blockClientFromApp } from "@/lib/portal";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import Title from "@/components/Title";
import ProjectInterventionRow from "@/components/ProjectInterventionRow";
import AddInterventionForm from "@/forms/AddInterventionForm";
import Link from "next/link";
import { ArrowLeftIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
};

/**
 * "Interventions" — the one remaining hub dropdown that used to be an inline
 * `CollapsibleSection`, moved to its own route the same day Matériel joined
 * `.../tasks` (see lib/projectSections.ts's own doc on PROJECT_SECTION_ROUTES):
 * once Matériel left, this was the only section left forcing the hub to load
 * a section's full rows just to render a dropdown nobody had asked to open
 * yet. Single key, same shape as `.../reserves`/`.../files` before it.
 */
export default async function ProjectInterventionsPage({ params }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const locale = await getLocale();
  const t = getDictionary(locale);

  const access = await resolveProjectSectionAccess({ id, projectId }, "interventions");

  if (!access.ok) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.projects.detail.interventionsHeading} />
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
  const session = await auth();
  const canEdit = await can(session?.user?.role, "content.edit");

  const interventions = await findInterventionsByProject(pid);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.projects.detail.interventionsHeading} · {project.name}
          </h1>
          <Link
            href={`/clients/${id}/projects/${pid}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projectDashboard.backToProject}
          </Link>
        </div>

        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
              <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold">
                <WrenchScrewdriverIcon className="h-5 w-5 shrink-0 text-amber-500" />
                <span className="truncate">{t.projects.detail.interventionsHeading}</span>
                {interventions.length > 0 && (
                  <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">
                    ({interventions.length})
                  </span>
                )}
              </h2>
              {canEdit && <AddInterventionForm clientId={clientId} projectId={pid} />}
            </div>

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
          </div>
        </div>
      </div>
    </main>
  );
}
