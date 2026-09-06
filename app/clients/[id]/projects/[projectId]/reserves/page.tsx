import { findByProject as findReservePlansByProject } from "@/repository/reservePlans";
import {
  findByProject as findReserveFoldersByProject,
  findChildren as findReserveChildFolders,
  getBreadcrumb as getReserveBreadcrumb,
} from "@/repository/reservePlanFolders";
import { tallyByProject as tallyReservesByProject } from "@/repository/reserves";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { resolveProjectSectionAccess } from "@/lib/projectSectionGuard";
import { parseFolderIdParam } from "@/lib/folderIdParam";
import { blockClientFromApp } from "@/lib/portal";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import { resolveReserveStatusStyle } from "@/lib/reserveStatusStyle";
import Title from "@/components/Title";
import ReserveStatusStyleVars from "@/components/ReserveStatusStyleVars";
import ReservesSection from "@/components/ReservesSection";
import AddReservePlanForm from "@/forms/AddReservePlanForm";
import AddReserveFolderForm from "@/forms/AddReserveFolderForm";
import ReserveStatusStyleForm from "@/forms/ReserveStatusStyleForm";
import Link from "next/link";
import { ArrowLeftIcon, ArrowDownTrayIcon, MapPinIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
  searchParams: Promise<{
    /** This page's own folder browser — see lib/projectSectionGuard.ts's doc
     * removed alongside `?rfolder=`: the réserves browser no longer shares a
     * page with the Files module, so it owns the plain `folder` param
     * outright. Next can hand back an array on a repeated `?folder=1&folder=2`
     * — parseFolderIdParam (lib/folderIdParam.ts) is what actually narrows
     * this down to a single, bounded id. */
    folder?: string | string[];
  }>;
};

export default async function ProjectReservesPage({ params, searchParams }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const locale = await getLocale();
  const t = getDictionary(locale);

  const access = await resolveProjectSectionAccess({ id, projectId }, "reserves");

  if (!access.ok) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.reserves.heading} />
        <p className={access.reason === "error" ? "text-red-500" : undefined}>
          {access.reason === "forbidden"
            ? t.errors.forbidden
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

  const { folder: folderParam } = await searchParams;
  const currentFolderId = parseFolderIdParam(folderParam);

  const [reservePlans, reserveFolders, reserveSubfolders, reserveBreadcrumb, reserveTally] = await Promise.all([
    // boundReserves: true — see repository/reservePlans.ts::findByProject's
    // own doc for why this display surface opts in and the PDF report route
    // does not.
    findReservePlansByProject(pid, { boundReserves: true }),
    // Full flat list — for the plan "move to folder" target list + counts.
    findReserveFoldersByProject(pid),
    // Current level's children + its path, for the nested browser.
    findReserveChildFolders(pid, currentFolderId),
    getReserveBreadcrumb(pid, currentFolderId),
    // A project-wide, always-accurate tally — see
    // repository/reserves.ts::tallyByProject's own doc.
    tallyReservesByProject(pid),
  ]);

  // This project's OPEN/RESOLVED label + colour, resolved once here and
  // passed down so the plan pin, the list marker, the pill and the editor's
  // status `<select>` (all inside ReservesSection) can never drift from each
  // other.
  const reserveStatusStyle = resolveReserveStatusStyle(project, t.reserves.status);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      {/* This project's OPEN/RESOLVED réserve colours, as CSS custom
          properties — see ReserveStatusStyleVars's own doc. Rendered
          unconditionally, in the exact same pass as anything that reads
          --reserve-open/--reserve-resolved (the pins and badges inside
          ReservesSection below). */}
      <ReserveStatusStyleVars style={reserveStatusStyle} />
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.reserves.heading} · {project.name}
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
                <MapPinIcon className="h-5 w-5 shrink-0 text-rose-500" />
                <span className="truncate">{t.reserves.heading}</span>
                {reservePlans.length > 0 && (
                  <span className="shrink-0 text-sm font-normal text-gray-500 dark:text-gray-400">
                    {reserveTally.total > 0
                      ? `(${reservePlans.length}) · ${format(t.reserves.countWithLabel, { count: reserveTally.open, label: reserveStatusStyle.open.label })}`
                      : `(${reservePlans.length})`}
                  </span>
                )}
              </h2>
              {/* Siblings, not a wrapper div: the header is a flex-wrap row,
                  so each button must be its own item or they'd stay glued
                  together and squeeze the title off-screen on mobile. */}
              <>
                {/* Export is read-only: anyone who can open this page may
                    download what it already shows them. */}
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
                  <AddReserveFolderForm clientId={clientId} projectId={pid} parentId={currentFolderId} />
                )}
                {canEdit && (
                  <AddReservePlanForm clientId={clientId} projectId={pid} folders={reserveFolders} />
                )}
                {/* Configures the section it sits in — see the project
                    detail page's own comment on why `project` is built
                    literally (four columns) here rather than passed whole. */}
                {canEdit && (
                  <ReserveStatusStyleForm
                    clientId={clientId}
                    projectId={pid}
                    project={{
                      reserveOpenLabel: project.reserveOpenLabel,
                      reserveOpenColor: project.reserveOpenColor,
                      reserveResolvedLabel: project.reserveResolvedLabel,
                      reserveResolvedColor: project.reserveResolvedColor,
                    }}
                  />
                )}
              </>
            </div>

            <ReservesSection
              clientId={clientId}
              projectId={pid}
              plans={reservePlans}
              subfolders={reserveSubfolders}
              breadcrumb={reserveBreadcrumb}
              allFolders={reserveFolders}
              currentFolderId={currentFolderId}
              canEdit={canEdit}
              statusStyle={reserveStatusStyle}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
