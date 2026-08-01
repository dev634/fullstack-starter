// Pure shaping/derivation for the réserves PDF report. Kept free of pdfkit and
// Prisma imports so the layout rules are unit-testable on plain objects, and so
// the renderer (lib/reservesReport.ts) only worries about drawing.
//
// The structural types below are satisfied by the Prisma rows the repository
// returns — depending on the shape rather than the generated classes keeps this
// module independent of the ORM.

export type ReportReserve = {
  id: number;
  /** Stable project-wide reference, assigned at creation (never a render index). */
  number: number;
  x: number;
  y: number;
  description: string;
  status: "OPEN" | "RESOLVED";
  latitude: number | null;
  longitude: number | null;
  photos: { id: number; url: string }[];
};

export type ReportPlan = {
  id: number;
  name: string;
  url: string;
  folderId: number | null;
  reserves: ReportReserve[];
};

export type ReportFolder = { id: number; name: string };

export type ReportGroup = { folder: ReportFolder | null; plans: ReportPlan[] };

/**
 * Order the plans for the report: the project root first, then each folder in
 * its own order, skipping groups that hold no plan.
 *
 * A plan pointing at an unknown folder (stale/foreign id) falls back to the
 * root rather than being dropped — a réserve silently missing from a snagging
 * report is worse than one filed under the wrong heading.
 */
export function groupPlansForReport(
  folders: readonly ReportFolder[],
  plans: readonly ReportPlan[]
): ReportGroup[] {
  const known = new Set(folders.map((f) => f.id));
  const groups: ReportGroup[] = [];

  const rootPlans = plans.filter((p) => p.folderId == null || !known.has(p.folderId));
  if (rootPlans.length > 0) groups.push({ folder: null, plans: rootPlans });

  for (const folder of folders) {
    const folderPlans = plans.filter((p) => p.folderId === folder.id);
    if (folderPlans.length > 0) groups.push({ folder, plans: folderPlans });
  }

  return groups;
}

/** Open/resolved tallies shown on the cover page. */
export function summarizeReserves(plans: readonly ReportPlan[]): {
  total: number;
  open: number;
  resolved: number;
} {
  let total = 0;
  let resolved = 0;
  for (const plan of plans) {
    for (const reserve of plan.reserves) {
      total += 1;
      if (reserve.status === "RESOLVED") resolved += 1;
    }
  }
  return { total, open: total - resolved, resolved };
}

/** "Lat, Lng" with a fixed precision, or null when the réserve has no GPS fix. */
export function formatCoordinates(
  latitude: number | null,
  longitude: number | null
): string | null {
  if (latitude == null || longitude == null) return null;
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

// Combining diacritical marks (U+0300–U+036F) that NFD normalization
// splits accents into. Built from a string so the source stays pure ASCII;
// p{M} would be clearer but needs an ES2018 regex target.
const COMBINING_MARKS = new RegExp("[\u0300-\u036f]", "g");

/**
 * ASCII, filesystem-safe slug — accents folded, runs of punctuation collapsed.
 * Used for the download filename, which must survive Content-Disposition.
 */
export function slugify(value: string, maxLength = 60): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** e.g. "reserves-toiture-nord-2026-07-31.pdf" */
export function reportFileName(projectName: string, date: Date = new Date()): string {
  const slug = slugify(projectName) || "projet";
  const day = date.toISOString().slice(0, 10);
  return `reserves-${slug}-${day}.pdf`;
}
