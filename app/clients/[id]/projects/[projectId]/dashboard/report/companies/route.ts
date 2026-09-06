import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { computeProgressByCompany } from "@/repository/tasks";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { buildCompaniesReport } from "@/lib/dashboardReport";
import { dashboardReportFileName } from "@/lib/dashboardReportData";

export const runtime = "nodejs";

/**
 * Download the "Avancement par entreprise sous-traitante" dashboard section
 * as a standalone PDF — the mirror image of the interims report route (see
 * that file's own doc for the "tasks" + "subcontractors" double section
 * guard).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; projectId: string }> }
) {
  const gate = await requireAppUser();
  if (!gate.ok) return gate.response;

  if (!(await canAccessArea("projects"))) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!(await canAccessSection("tasks")) || !(await canAccessSection("subcontractors"))) {
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
    const access = await getAccessContext();
    if (
      !project ||
      project.deletedAt ||
      project.clientId !== clientId ||
      !canReachProject(access, project.id)
    ) {
      return new Response("Not Found", { status: 404 });
    }

    const rows = await computeProgressByCompany(pid);
    const generatedAt = new Date();

    const pdf = await buildCompaniesReport({
      project: { name: project.name, businessNumber: project.businessNumber, address: project.address },
      companyName: project.client.companyName,
      locale: localeTag(locale),
      generatedAt,
      chrome: {
        generatedOn: t.projectDashboard.report.generatedOn,
        total: t.projectDashboard.report.total,
        done: t.projectDashboard.report.done,
        percent: t.projectDashboard.report.percent,
        percentValue: t.projectDashboard.report.percentValue,
        page: t.projectDashboard.report.page,
        businessNumber: t.projects.detail.businessNumber,
        address: t.projects.detail.address,
      },
      rows,
      labels: {
        title: t.projectDashboard.companiesTitle,
        none: t.projectDashboard.companiesNone,
        rowStats: t.projectDashboard.tasksBadge,
      },
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dashboardReportFileName("entreprises", project.name, generatedAt)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Companies report generation failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
