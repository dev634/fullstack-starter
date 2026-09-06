// Pure shaping/derivation for the project dashboard's PDF reports (tasks,
// per-intérimaire, per-entreprise, matériel, and the combined report) — kept
// free of pdfkit/Prisma imports, same reasoning as lib/reservesReportData.ts.

import { slugify } from "@/lib/reservesReportData";

/**
 * e.g. "taches-toiture-nord-2026-07-31.pdf". Same construction as
 * lib/reservesReportData.ts::reportFileName (dated, ASCII, safe for
 * Content-Disposition), generalized with a `section` prefix instead of a
 * hardcoded "reserves-" one — kept as a distinct function rather than adding
 * a parameter to that one: it's already covered by tests/reserves-report.
 * test.ts calling it with its original two-argument shape, and this is
 * exactly this project's own "two occurrences, leave it" DRY threshold
 * (docs/CONVENTIONS.md), not the "extract" one.
 */
export function dashboardReportFileName(
  section: string,
  projectName: string,
  date: Date = new Date()
): string {
  const slug = slugify(projectName) || "projet";
  const day = date.toISOString().slice(0, 10);
  return `${section}-${slug}-${day}.pdf`;
}
