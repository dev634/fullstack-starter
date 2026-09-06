import { findCompaniesByProject } from "@/repository/subcontractors";
import { findByProject as findInterimsByProject } from "@/repository/interims";
import { findAllOptions as findJobFunctions } from "@/repository/jobFunctions";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { resolveProjectSectionAccess } from "@/lib/projectSectionGuard";
import { blockClientFromApp } from "@/lib/portal";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import Title from "@/components/Title";
import ProjectSubcontractorCompanyRow from "@/components/ProjectSubcontractorCompanyRow";
import ProjectInterimRow from "@/components/ProjectInterimRow";
import AddSubcontractorCompanyForm from "@/forms/AddSubcontractorCompanyForm";
import AddInterimForm from "@/forms/AddInterimForm";
import Link from "next/link";
import { ArrowLeftIcon, BuildingOfficeIcon, UsersIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
};

/**
 * "Personnel" / "Workforce" — the fusion of the former Sous-traitants and
 * Intérimaires collapsible sections on the project hub into one dedicated
 * page (same migration `.../tasks`, `.../files`, `.../reserves` already
 * went through). The two access keys ("subcontractors", "interims") are
 * deliberately NOT fused: lib/accessContext.ts filters stored hiddenSections
 * against PROJECT_SECTION_KEYS, so retiring a key would silently drop any
 * restriction a job function already has on it. This page therefore asks
 * resolveProjectSectionAccess for BOTH keys at once and renders whichever
 * half(s) `access.visibleSections` actually contains — a caller missing only
 * one of the two still gets the other, the same granularity the two
 * standalone sections had before they shared a page.
 */
export default async function ProjectWorkforcePage({ params }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const locale = await getLocale();
  const t = getDictionary(locale);

  const access = await resolveProjectSectionAccess({ id, projectId }, ["subcontractors", "interims"]);

  if (!access.ok) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.projects.detail.workforceHeading} />
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

  const { clientId, projectId: pid } = access;
  // Which half(s) of this fused page this caller's function actually leaves
  // visible — read from the guard's own decision, never re-derived here (see
  // this file's own doc above and ProjectSectionAccess.visibleSections's).
  const showSubcontractors = access.visibleSections.has("subcontractors");
  const showInterims = access.visibleSections.has("interims");

  const session = await auth();
  const canEdit = await can(session?.user?.role, "content.edit");

  const [subcontractorCompanies, interims, jobFunctions] = await Promise.all([
    showSubcontractors ? findCompaniesByProject(pid) : Promise.resolve([]),
    showInterims ? findInterimsByProject(pid) : Promise.resolve([]),
    // Managed job functions offered in the intérimaire add form's dropdown,
    // and the subcontractor personnel add form's dropdown nested in each
    // company row — only fetched when at least one of those forms can
    // actually render.
    canEdit && (showSubcontractors || showInterims) ? findJobFunctions() : Promise.resolve([]),
  ]);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.projects.detail.workforceHeading} · {access.project.name}
          </h1>
          <Link
            href={`/clients/${id}/projects/${pid}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projectDashboard.backToProject}
          </Link>
        </div>

        {showSubcontractors && (
          <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
            <div className="overflow-hidden rounded-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
                <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold">
                  <BuildingOfficeIcon className="h-5 w-5 shrink-0 text-amber-500" />
                  <span className="truncate">{t.projects.detail.subcontractorsHeading}</span>
                  {subcontractorCompanies.length > 0 && (
                    <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">
                      ({subcontractorCompanies.length})
                    </span>
                  )}
                </h2>
                {canEdit && <AddSubcontractorCompanyForm clientId={clientId} projectId={pid} />}
              </div>

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
            </div>
          </div>
        )}

        {showInterims && (
          <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
            <div className="overflow-hidden rounded-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
                <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold">
                  <UsersIcon className="h-5 w-5 shrink-0 text-teal-500" />
                  <span className="truncate">{t.projects.detail.interimsHeading}</span>
                  {interims.length > 0 && (
                    <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">
                      ({interims.length})
                    </span>
                  )}
                </h2>
                {canEdit && <AddInterimForm clientId={clientId} projectId={pid} functions={jobFunctions} />}
              </div>

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
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
