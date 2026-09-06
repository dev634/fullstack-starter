import { getProject } from "@/actions/projects/projects";
import { computeProgressByProject as computeTaskProgressByProject } from "@/repository/tasks";
import { countByProject as countMaterialsByProject, computeStockStatsByProject } from "@/repository/projectMaterials";
import { countByProject as countInterventionsByProject } from "@/repository/interventions";
import { countCompaniesByProject } from "@/repository/subcontractors";
import { countByProject as countInterimsByProject } from "@/repository/interims";
import { countByProject as countFilesByProject } from "@/repository/projectFiles";
import { countByProject as countReservePlansByProject } from "@/repository/reservePlans";
import { tallyByProject as tallyReservesByProject } from "@/repository/reserves";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import Title from "@/components/Title";
import ProjectStatusBadge from "@/components/ProjectStatusBadge";
import ProjectTypeBadge from "@/components/ProjectTypeBadge";
import { resolveReserveStatusStyle } from "@/lib/reserveStatusStyle";
import ReserveStatusStyleVars from "@/components/ReserveStatusStyleVars";
import StatusPill from "@/components/StatusPill";
import ProjectHubCard from "@/components/ProjectHubCard";
import DeleteProjectButton from "@/app/clients/[id]/_components/DeleteProjectButton";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { format } from "@/lib/i18n/format";
import { getAppSettings } from "@/lib/appSettings";
import { normalizeSectionOrder, buildHubSlots, type ProjectSectionRouteSegment } from "@/lib/projectSections";
import { getHiddenSections } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { blockClientFromApp } from "@/lib/portal";
import type { ReactNode } from "react";
import {
  BoltIcon,
  HashtagIcon,
  CurrencyEuroIcon,
  MapPinIcon,
  CalendarIcon,
  PencilSquareIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ClipboardDocumentListIcon,
  FolderIcon,
  ChartBarIcon,
  WrenchScrewdriverIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
};

export default async function ProjectDetailPage({ params }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const clientId = parseInt(id, 10);
  const pid = parseInt(projectId, 10);

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
  // Sections this user's job function hides — computed before the barrier
  // below (not after, as it used to be) so the Réserves/Files counters can
  // skip their own COUNT entirely when hidden, the same conditional-fetch
  // pattern the project dashboard already uses for its own two sections.
  const hiddenSections = await getHiddenSections();
  // Une seule barrière, pas deux. Ces requêtes étaient réparties en deux
  // `Promise.all` successifs, donc le second attendait la fin du premier alors
  // qu'il n'en dépend pas : il ne prend que `pid`, lu dans l'URL bien plus
  // haut. Ce qui sépare les deux groupes ci-dessous n'est que de la
  // dérivation synchrone, plus bas, des résultats du premier.
  //
  // Réserves, Fichiers, Tâches (désormais avec Matériel) et Personnel (fusion
  // de Sous-traitants + Intérimaires) ont quitté cette page pour leurs propres
  // routes, où leur garde de section précède leur lecture — Interventions les
  // a rejointes le même jour que Matériel a rejoint Tâches (voir
  // lib/projectSections.ts), ce qui ferme le dernier repli de section
  // dépliante encore présent ici. Cette page ne lit plus que des COMPTEURS et
  // des agrégats, jamais une liste complète, et seulement pour la ou les
  // sections correspondantes quand elles ne sont pas masquées. Personnel
  // affiche deux compteurs indépendants (l'un peut être visible sans l'autre
  // — les deux clés restent séparées, voir lib/accessContext.ts), donc chacun
  // saute sa propre requête quand SA clé est masquée, pas seulement quand les
  // deux le sont.
  const [
    taskProgress,
    materialStats,
    materialsCount,
    interventionsCount,
    subcontractorCount,
    interimCount,
    reservePlanCount,
    reserveTally,
    fileCount,
  ] = await Promise.all([
    // Unconditional, like materialStats just below it: neither respects
    // hiddenSections today (this "Avancement" summary predates the section
    // split), and this refactor doesn't change that — only where the
    // underlying data comes from (see each function's own doc).
    computeTaskProgressByProject(pid),
    computeStockStatsByProject(pid),
    hiddenSections.has("materials") ? Promise.resolve(0) : countMaterialsByProject(pid),
    hiddenSections.has("interventions") ? Promise.resolve(0) : countInterventionsByProject(pid),
    hiddenSections.has("subcontractors") ? Promise.resolve(0) : countCompaniesByProject(pid),
    hiddenSections.has("interims") ? Promise.resolve(0) : countInterimsByProject(pid),
    hiddenSections.has("reserves") ? Promise.resolve(0) : countReservePlansByProject(pid),
    hiddenSections.has("reserves")
      ? Promise.resolve({ total: 0, open: 0, resolved: 0 })
      : tallyReservesByProject(pid),
    hiddenSections.has("files") ? Promise.resolve(0) : countFilesByProject(pid),
  ]);

  const doneCount = taskProgress.done;
  const totalCount = taskProgress.total;

  // This project's resolved OPEN/RESOLVED label + colour, for the Réserves
  // link card below: the open count is the single most useful figure on this
  // whole page for a conducteur de travaux, so it's rendered as the same
  // coloured pill as the dedicated réserves page rather than buried in grey
  // text — which is why, unlike before this card existed, this page now also
  // needs ReserveStatusStyleVars (rendered once, further down) so that pill
  // never drifts from the project's own configured colour.
  const reserveStatusStyle = resolveReserveStatusStyle(project, t.reserves.status);

  // SUPERADMIN-configured display order of the collapsible sections below,
  // normalized so a partial/stale stored value is always safe.
  const appSettings = await getAppSettings();
  // SUPERADMIN order, then drop any section the current user's job function
  // hides (ADMIN+ are exempt and see them all).
  const sectionOrder = normalizeSectionOrder(appSettings.projectSectionOrder).filter(
    (key) => !hiddenSections.has(key)
  );

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      {/* This project's OPEN/RESOLVED réserve colours, as CSS custom
          properties — see ReserveStatusStyleVars's own doc. Rendered
          unconditionally (same as the dedicated réserves page): the Réserves
          link card below reads --reserve-open/--reserve-resolved through the
          exact same .reserve-pill-* classes, whether or not this function's
          hidden sections end up showing that card at all. */}
      <ReserveStatusStyleVars style={reserveStatusStyle} />
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

        {/* Reorderable "dropdown" sections. Every routed page (Tâches,
            Personnel, Fichiers, Réserves, Interventions) is a link card
            carrying only COUNT(s), to its own guarded route — built from
            lib/projectSections.ts's PROJECT_SECTION_ROUTES via buildHubSlots
            below, which is also what collapses a multi-key route's member
            keys (Personnel's subcontractors+interims, Tâches' tasks+
            materials) into the single slot its merged page occupies. There
            is no `sectionContent` anymore: every ProjectSectionKey now has a
            routed page (see PROJECT_SECTION_ROUTES's own doc on why
            `HubSlot`'s `{ kind: "section" }` branch stays in the type even
            though it's currently never produced). Each slot is wrapped once
            in the shared card chrome and rendered in the admin's configured
            order. */}
        {(() => {
        const routeContent: Record<ProjectSectionRouteSegment, ReactNode> = {
        tasks: (
          <ProjectHubCard
            href={`/clients/${id}/projects/${pid}/tasks`}
            icon={<ClipboardDocumentListIcon className="h-5 w-5 shrink-0 text-blue-500" />}
            title={t.projects.detail.tasksHeading}
            description={t.projects.detail.tasksDescription}
            counter={
              totalCount > 0 || materialsCount > 0
                ? [
                    totalCount > 0 ? `(${doneCount}/${totalCount})` : null,
                    materialsCount > 0
                      ? format(t.projects.detail.tasksMaterialsCount, { count: materialsCount })
                      : null,
                  ]
                    .filter((segment): segment is string => segment !== null)
                    .join(" · ")
                : undefined
            }
          />
        ),
        interventions: (
          <ProjectHubCard
            href={`/clients/${id}/projects/${pid}/interventions`}
            icon={<WrenchScrewdriverIcon className="h-5 w-5 shrink-0 text-amber-500" />}
            title={t.projects.detail.interventionsHeading}
            description={t.projects.detail.interventionsDescription}
            counter={interventionsCount > 0 ? `(${interventionsCount})` : undefined}
          />
        ),
        workforce: (
          <ProjectHubCard
            href={`/clients/${id}/projects/${pid}/workforce`}
            icon={<UserGroupIcon className="h-5 w-5 shrink-0 text-teal-500" />}
            title={t.projects.detail.workforceHeading}
            description={t.projects.detail.workforceDescription}
            counter={
              subcontractorCount > 0 || interimCount > 0
                ? [
                    subcontractorCount > 0
                      ? format(t.projects.detail.workforceSubcontractorsCount, { count: subcontractorCount })
                      : null,
                    interimCount > 0
                      ? format(t.projects.detail.workforceInterimsCount, { count: interimCount })
                      : null,
                  ]
                    .filter((segment): segment is string => segment !== null)
                    .join(" · ")
                : undefined
            }
          />
        ),
        files: (
          <ProjectHubCard
            href={`/clients/${id}/projects/${pid}/files`}
            icon={<FolderIcon className="h-5 w-5 shrink-0 text-amber-500" />}
            title={t.projects.detail.filesHeading}
            description={t.projects.detail.filesDescription}
            counter={fileCount > 0 ? `(${fileCount})` : undefined}
          />
        ),
        reserves: (
          <ProjectHubCard
            href={`/clients/${id}/projects/${pid}/reserves`}
            icon={<MapPinIcon className="h-5 w-5 shrink-0 text-rose-500" />}
            title={t.reserves.heading}
            description={t.projects.detail.reservesDescription}
            counter={reservePlanCount > 0 ? `(${reservePlanCount})` : undefined}
          >
            {/* The open-réserve count is the single most useful figure on
                this page for a conducteur de travaux: he no longer has to
                open this card to know whether there's something to treat.
                A coloured pill (the exact classes the dedicated réserves
                page's own status badges use) instead of the same small grey
                text as the plan count above, so it reads as a status at a
                glance rather than blending into it. */}
            {reserveTally.total > 0 ? (
              <StatusPill className={reserveTally.open > 0 ? "reserve-pill-open" : "reserve-pill-resolved"}>
                {format(t.reserves.countWithLabel, { count: reserveTally.open, label: reserveStatusStyle.open.label })}
              </StatusPill>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {reservePlanCount > 0 ? t.reserves.noReserves : t.reserves.noPlans}
              </span>
            )}
          </ProjectHubCard>
        ),
        };
        const hubSlots = buildHubSlots(sectionOrder);
        return hubSlots.map((slot) => (
          <div
            key={slot.kind === "route" ? slot.segment : slot.key}
            className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600"
          >
            <div className="overflow-hidden rounded-xl">
              {/* `sectionContent[slot.key]` is dead in practice today (see
                  this block's own doc above) — kept as `null` rather than a
                  non-null assertion on `routeContent[slot.segment]`, so a
                  future `{ kind: "section" }` slot renders an empty card
                  instead of a runtime crash. */}
              {slot.kind === "route" ? routeContent[slot.segment] : null}
            </div>
          </div>
        ));
        })()}

      </div>
    </main>
  );
}
