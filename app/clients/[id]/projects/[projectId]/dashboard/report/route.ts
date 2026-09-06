import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { findByProject as findTasksByProject, computeProgressByInterim, computeProgressByCompany } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findTaskCategoriesByProject } from "@/repository/taskCategories";
import { findByProject as findMaterialsByProject } from "@/repository/projectMaterials";
import { tallyByProject as tallyReservesByProject } from "@/repository/reserves";
import { computeTaskProgress, computeTaskBarStats, computeTrackedMaterials, roundPercent } from "@/lib/projectDashboard";
import { resolveReserveStatusStyle } from "@/lib/reserveStatusStyle";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { buildGlobalDashboardReport, type TaskProgressRow, type GlobalReportSections } from "@/lib/dashboardReport";
import { dashboardReportFileName } from "@/lib/dashboardReportData";

export const runtime = "nodejs";

/**
 * Download the WHOLE project dashboard (every section the caller may see) as
 * a single PDF.
 *
 * Unlike the four single-section routes next to this one, there is no single
 * `canAccessSection` to gate this route behind — it must always answer (as
 * long as the `projects` rubrique itself is reachable), just with fewer
 * sections inside. `showTasks`/`showInterims`/… below are the exact mirror of
 * app/.../dashboard/page.tsx's own booleans: a job function that hides a
 * section from the on-screen dashboard must not find it in this PDF either —
 * "the interface hides, the export gives it back" is exactly the réserves-
 * report-route class of leak docs/CONVENTIONS.md already documents for
 * exports in general.
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

    const showTasks = await canAccessSection("tasks");
    const showInterims = showTasks && (await canAccessSection("interims"));
    const showCompanies = showTasks && (await canAccessSection("subcontractors"));
    const showReserves = await canAccessSection("reserves");
    const showMaterials = await canAccessSection("materials");

    const [tasks, taskGroups, taskCategories, interimRows, companyRows, reserveTally, materials] = await Promise.all([
      showTasks ? findTasksByProject(pid) : Promise.resolve([]),
      showTasks ? findTaskGroupsByProject(pid) : Promise.resolve([]),
      showTasks ? findTaskCategoriesByProject(pid) : Promise.resolve([]),
      showInterims ? computeProgressByInterim(pid) : Promise.resolve([]),
      showCompanies ? computeProgressByCompany(pid) : Promise.resolve([]),
      showReserves ? tallyReservesByProject(pid) : Promise.resolve({ total: 0, open: 0, resolved: 0 }),
      showMaterials ? findMaterialsByProject(pid) : Promise.resolve([]),
    ]);

    const chrome = {
      generatedOn: t.projectDashboard.report.generatedOn,
      total: t.projectDashboard.report.total,
      done: t.projectDashboard.report.done,
      percent: t.projectDashboard.report.percent,
      percentValue: t.projectDashboard.report.percentValue,
      page: t.projectDashboard.report.page,
      businessNumber: t.projects.detail.businessNumber,
      address: t.projects.detail.address,
    };

    // Built in the SAME order the dashboard page renders its sections:
    // Tâches, Par intérimaire, Par entreprise sous-traitante, Réserves,
    // Matériel — buildGlobalDashboardReport draws whichever of these keys are
    // present, in that fixed order, never the order they're assigned here.
    const sections: GlobalReportSections = {};

    if (showTasks) {
      const progress = computeTaskProgress(tasks, taskGroups, taskCategories);
      const details: TaskProgressRow[] = [
        ...tasks.map((task) => ({ id: `task-${task.id}`, name: task.title, ...computeTaskBarStats(task) })),
        ...taskGroups.map((group) => ({
          id: `group-${group.id}`,
          name: group.name,
          done: group.doneCount,
          total: group.totalCount,
          percent: roundPercent(group.doneCount, group.totalCount),
        })),
      ];
      sections.tasks = {
        progress,
        details,
        labels: {
          title: t.projectDashboard.tasksTitle,
          overall: t.projectDashboard.tasksOverall,
          categoriesTitle: t.projectDashboard.categoriesTitle,
          detailedTitle: t.projectDashboard.detailedTitle,
          none: t.projectDashboard.tasksNone,
          rowStats: t.projectDashboard.tasksBadge,
        },
      };
    }

    if (showInterims) {
      sections.interims = {
        rows: interimRows,
        labels: {
          title: t.projectDashboard.interimsTitle,
          none: t.projectDashboard.interimsNone,
          rowStats: t.projectDashboard.tasksBadge,
        },
      };
    }

    if (showCompanies) {
      sections.companies = {
        rows: companyRows,
        labels: {
          title: t.projectDashboard.companiesTitle,
          none: t.projectDashboard.companiesNone,
          rowStats: t.projectDashboard.tasksBadge,
        },
      };
    }

    if (showReserves) {
      // Same source the dashboard page and the réserves report route both
      // use — the tally-only view here never fetches a single réserve row
      // (see lib/dashboardReport.ts's own module doc for why there is no
      // full réserves builder in this file).
      const statusStyle = resolveReserveStatusStyle(project, t.reserves.status);
      sections.reserves = {
        tally: reserveTally,
        statusColors: { open: statusStyle.open.color, resolved: statusStyle.resolved.color },
        labels: {
          title: t.projectDashboard.reservesTitle,
          none: t.projectDashboard.reservesNone,
          total: t.projectDashboard.report.total,
          open: statusStyle.open.label,
          resolved: statusStyle.resolved.label,
        },
      };
    }

    if (showMaterials) {
      sections.materials = {
        materials: computeTrackedMaterials(materials),
        labels: {
          title: t.projectDashboard.materialsTitle,
          listTitle: t.projectDashboard.materialsListTitle,
          none: t.projectDashboard.materialsNone,
          stockStatus: t.materials.stockStatus,
        },
      };
    }

    const generatedAt = new Date();

    const pdf = await buildGlobalDashboardReport({
      project: { name: project.name, businessNumber: project.businessNumber, address: project.address },
      companyName: project.client.companyName,
      locale: localeTag(locale),
      generatedAt,
      chrome,
      title: t.projectDashboard.report.globalTitle,
      sections,
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dashboardReportFileName("tableau-de-bord", project.name, generatedAt)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Dashboard report generation failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
