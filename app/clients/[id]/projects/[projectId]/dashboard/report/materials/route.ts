import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { computeTrackedMaterials } from "@/lib/projectDashboard";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { buildMaterialsReport } from "@/lib/dashboardReport";
import { dashboardReportFileName } from "@/lib/dashboardReportData";

export const runtime = "nodejs";

/**
 * Download the "Stock matériel" dashboard section as a standalone PDF.
 *
 * Loads the project's real material rows (repository/projectMaterials.ts::
 * findByProject) — the same rows the dashboard's donut + list are built
 * from — and keeps only the ones with a linked task requirement
 * (computeTrackedMaterials), exactly like the dashboard does: this report
 * lists, it doesn't summarize, so an aggregate count alone wouldn't carry
 * enough to reproduce the on-screen list.
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

  if (!(await canAccessSection("materials"))) {
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

    const materials = await findMaterialsByProject(pid);
    const tracked = computeTrackedMaterials(materials);
    const generatedAt = new Date();

    const pdf = await buildMaterialsReport({
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
      materials: tracked,
      labels: {
        title: t.projectDashboard.materialsTitle,
        listTitle: t.projectDashboard.materialsListTitle,
        none: t.projectDashboard.materialsNone,
        stockStatus: t.materials.stockStatus,
      },
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dashboardReportFileName("materiel", project.name, generatedAt)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Materials report generation failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
