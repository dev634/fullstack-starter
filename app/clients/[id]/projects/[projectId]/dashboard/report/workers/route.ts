import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { computeProgressByWorker } from "@/repository/tasks";
import { workerDisplayName } from "@/lib/workerDisplayName";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { buildWorkersReport } from "@/lib/dashboardReport";
import { dashboardReportFileName } from "@/lib/dashboardReportData";

export const runtime = "nodejs";

/**
 * Download the "Avancement par travailleur" dashboard section as a
 * standalone PDF — exact mirror of ../interims/route.ts. Same guard order as
 * the tasks report route, plus a second section check: this is a derived
 * VIEW of task data (gated by "tasks") that ALSO carries the workforce
 * identity guard on top (a travailleur's own name is personnel data, gated
 * by "interims" on the workforce page — there is no dedicated "workers"
 * section key, see actions/projectWorkers/projectWorkers.ts's own doc).
 * Hiding either section must hide this report, not just the dashboard's own
 * view of it.
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

  if (!(await canAccessSection("tasks")) || !(await canAccessSection("interims"))) {
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

    // Already a GROUP BY aggregate, one row per assignee — the list this
    // report prints IS that aggregate, never a raw task/série/catégorie row.
    // computeProgressByWorker can't resolve a null User.name itself (no `t`
    // there — see that function's own doc), so this route does it once here.
    const rawRows = await computeProgressByWorker(pid);
    const rows = rawRows.map((row) => ({ ...row, name: workerDisplayName(row, t) }));
    const generatedAt = new Date();

    const pdf = await buildWorkersReport({
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
        title: t.projectDashboard.workersTitle,
        none: t.projectDashboard.workersNone,
        rowStats: t.projectDashboard.tasksBadge,
      },
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dashboardReportFileName("travailleurs", project.name, generatedAt)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Workers report generation failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
