import { requireAppUser } from "@/lib/routeGuard";
import { canAccessSection } from "@/lib/sectionAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { findByProject as findReservePlansByProject } from "@/repository/reservePlans";
import { findByProject as findReserveFoldersByProject } from "@/repository/reservePlanFolders";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { buildReservesReport } from "@/lib/reservesReport";
import { reportFileName } from "@/lib/reservesReportData";

// pdfkit needs Node built-ins (Buffer, fs for its font metrics), so this route
// must not run on the edge runtime.
export const runtime = "nodejs";

/**
 * Download the project's réserves as a PDF report.
 *
 * Access mirrors the project detail page: any authenticated app user may
 * export what they can already read there. CLIENT (portal) sessions are
 * refused outright — the portal has no export yet, and this route is outside
 * the project-scoped boundary that confines them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; projectId: string }> }
) {
  const gate = await requireAppUser();
  if (!gate.ok) return gate.response;

  // The report IS the réserves section, in another format — a job function
  // barred from that section must not be able to download it either.
  if (!(await canAccessSection("reserves"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id, projectId } = await params;
  const clientId = Number(id);
  const pid = Number(projectId);
  if (!Number.isInteger(clientId) || !Number.isInteger(pid) || clientId <= 0 || pid <= 0) {
    return new Response("Bad Request", { status: 400 });
  }

  const locale = await getLocale();
  const t = getDictionary(locale);

  try {
    const project = await findProjectById(pid);
    // Same visibility rule as the detail page: a trashed project, or one
    // reached through the wrong client in the URL, is "not found".
    // Out of scope reads as "not found" for the same reason the page does:
    // a distinct status would confirm the project exists.
    const access = await getAccessContext();
    if (
      !project ||
      project.deletedAt ||
      project.clientId !== clientId ||
      !canReachProject(access, project.id)
    ) {
      return new Response("Not Found", { status: 404 });
    }

    const [plans, folders] = await Promise.all([
      findReservePlansByProject(pid),
      findReserveFoldersByProject(pid),
    ]);

    // One timestamp for both the cover date and the filename, so a request
    // straddling midnight can't label them differently.
    const generatedAt = new Date();

    const pdf = await buildReservesReport({
      generatedAt,
      project: {
        name: project.name,
        businessNumber: project.businessNumber,
        address: project.address,
      },
      companyName: project.client.companyName,
      folders,
      plans,
      locale: localeTag(locale),
      labels: {
        title: t.reserves.report.title,
        // Reuse the labels the project page already shows for these fields.
        businessNumber: t.projects.detail.businessNumber,
        address: t.projects.detail.address,
        generatedOn: t.reserves.report.generatedOn,
        total: t.reserves.report.total,
        summaryOpen: t.reserves.report.summaryOpen,
        summaryResolved: t.reserves.report.summaryResolved,
        statusOpen: t.reserves.status.OPEN,
        statusResolved: t.reserves.status.RESOLVED,
        rootGroup: t.reserves.noFolder,
        noReserves: t.reserves.report.noReserves,
        gps: t.reserves.gpsHeading,
        planUnavailable: t.reserves.report.planUnavailable,
        page: t.reserves.report.page,
      },
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // The filename is slugified to ASCII, so the plain form is safe.
        "Content-Disposition": `attachment; filename="${reportFileName(project.name, generatedAt)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Reserves report generation failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
