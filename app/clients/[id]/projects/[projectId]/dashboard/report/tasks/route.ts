import { requireAppUser } from "@/lib/requireAppUser";
import { canAccessSection } from "@/lib/sectionAccess";
import { canAccessArea } from "@/lib/areaAccess";
import { getAccessContext, canReachProject } from "@/lib/accessContext";
import { findById as findProjectById } from "@/repository/projects";
import { findByProject as findTasksByProject } from "@/repository/tasks";
import { findByProject as findTaskGroupsByProject } from "@/repository/taskGroups";
import { findByProject as findTaskCategoriesByProject } from "@/repository/taskCategories";
import { computeTaskProgress, computeTaskBarStats, roundPercent } from "@/lib/projectDashboard";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { localeTag } from "@/lib/i18n/formatDate";
import { buildTasksReport, type TaskProgressRow } from "@/lib/dashboardReport";
import { dashboardReportFileName } from "@/lib/dashboardReportData";

// pdfkit needs Node built-ins (Buffer, fs for its font metrics), so this route
// must not run on the edge runtime — same constraint as the réserves report.
export const runtime = "nodejs";

/**
 * Download the "Avancement des tâches" dashboard section as a standalone PDF.
 *
 * Guard order mirrors the réserves report route exactly (the canonical order
 * documented in docs/CONVENTIONS.md): requireAppUser -> canAccessArea
 * ("projects") -> canAccessSection -> validate route params -> resolve the
 * project in DB -> canReachProject. Hors périmètre reads as "not found", never
 * "forbidden" — a distinct status would let an attacker enumerate ids.
 *
 * Loads the SAME rows the dashboard page loads for this section (tasks,
 * task groups, task categories) — a per-task/per-série percentage needs the
 * real rows, not the project-wide aggregate repository/tasks.ts::
 * computeProgressByProject already offers, since this report lists every
 * série/tâche individually, exactly like the dashboard's own "Avancement
 * détaillé, tâche par tâche" list.
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

  if (!(await canAccessSection("tasks"))) {
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

    const [tasks, taskGroups, taskCategories] = await Promise.all([
      findTasksByProject(pid),
      findTaskGroupsByProject(pid),
      findTaskCategoriesByProject(pid),
    ]);

    const progress = computeTaskProgress(tasks, taskGroups, taskCategories);
    // Same construction as app/.../dashboard/page.tsx's own taskDetailProgress:
    // every standalone task AND every série gets its own row, a categorized
    // task/série legitimately appearing both here and rolled into its
    // category's own bar in `progress.groups` above.
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

    const generatedAt = new Date();

    const pdf = await buildTasksReport({
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
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${dashboardReportFileName("taches", project.name, generatedAt)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Tasks report generation failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
