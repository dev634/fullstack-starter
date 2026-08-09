import { search, type ProjectSortField } from "@/repository/projects";
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import { canAccessArea } from "@/lib/areaAccess";
import { PROJECT_CSV_COLUMNS, csvCell } from "@/lib/csv";
import { requireAppUser } from "@/lib/requireAppUser";

const SORT_FIELDS: ProjectSortField[] = ["name", "status", "createdAt"];

/**
 * Export the (filtered/sorted) projects as a CSV download. Honours the same
 * ?q/?sort/?dir query used by the list.
 *
 * The /projects proxy rule gates this too; the in-handler check is the second
 * layer, because this response streams every project across every client.
 * requireAppUser only checks role/session — a caller whose job function
 * hides the `projects` rubrique must be refused here too, or the CSV becomes
 * a way around that restriction by direct URL.
 */
export async function GET(request: Request) {
  const gate = await requireAppUser();
  if (!gate.ok) return gate.response;
  if (!(await canAccessArea("projects"))) return new Response("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const sortRaw = params.get("sort");
  const sortField: ProjectSortField = SORT_FIELDS.includes(sortRaw as ProjectSortField)
    ? (sortRaw as ProjectSortField)
    : "createdAt";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";

  const { projects } = await search({ q, sortField, dir, page: 1, pageSize: 100000, projectIds: projectIdFilter(await getAccessContext()) });

  // A row poisoned before the schema validated dates (or restored from a
  // backup taken then) can still hold an unparseable Date in the DB — render
  // that cell blank instead of letting `.toISOString()` throw and take down
  // the whole export for every other row.
  const toCsvDate = (value: Date | null): string => {
    if (!value) return "";
    const d = new Date(value);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  };

  const rows = projects.map((project) => {
    const flat: Record<string, unknown> = {
      ...project,
      clientEmail: project.client.email,
      startDate: toCsvDate(project.startDate),
      endDate: toCsvDate(project.endDate),
    };
    return PROJECT_CSV_COLUMNS.map((c) => csvCell(flat[c.key])).join(",");
  });

  const header = PROJECT_CSV_COLUMNS.map((c) => csvCell(c.header)).join(",");
  // Prepend a BOM so Excel opens UTF-8 accents correctly.
  const csv = "﻿" + [header, ...rows].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="projects.csv"`,
    },
  });
}
