// Pure shaping/derivation for the réserves PDF report. Kept free of pdfkit and
// Prisma imports so the layout rules are unit-testable on plain objects, and so
// the renderer (lib/reservesReport.ts) only worries about drawing.
//
// The structural types below are satisfied by the Prisma rows the repository
// returns — depending on the shape rather than the generated classes keeps this
// module independent of the ORM. The `asset` field is the one exception: it's
// `import type`-only (erased at compile time, so it adds no runtime coupling —
// see lib/cloudinaryDelivery.ts), because a plain `url` string can no longer
// carry what the renderer needs: on a signed asset, a transformation has to be
// composed BEFORE signing, not spliced into a stored URL after the fact (see
// lib/reservesReport.ts's module doc).
import type { DeliveryAsset } from "@/lib/cloudinaryDelivery";

export type ReportPhoto = { id: number; asset: DeliveryAsset };

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
  photos: ReportPhoto[];
};

export type ReportPlan = {
  id: number;
  name: string;
  asset: DeliveryAsset;
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

/**
 * The only two fields tallying needs — deliberately narrower than
 * `ReportReserve`/`ReportPlan` so `summarizeReserves` stays usable on a plain
 * repository row (e.g. `repository/reservePlans.ts::findByProject`'s return
 * value, which has no `asset`/photo-delivery shaping applied) and not just on
 * the PDF report's already-shaped `ReportPlan[]`. Both satisfy this shape
 * structurally, so no adapter is needed at either call site.
 */
export type ReserveTallyInput = { status: "OPEN" | "RESOLVED" };
export type PlanTallyInput = { id: number; reserves: readonly ReserveTallyInput[] };

export type ReserveTally = { total: number; open: number; resolved: number };

/** Open/resolved tallies across every given plan — used by the PDF cover page,
 * the project page and client-portal section-wide counters, and (called with
 * a single-plan array, `summarizeReserves([plan])`) the per-plan "N open"
 * badge on each plan row. */
export function summarizeReserves(plans: readonly PlanTallyInput[]): ReserveTally {
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
