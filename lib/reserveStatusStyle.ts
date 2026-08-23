// Resolves how a project presents its two réserve statuses (OPEN/RESOLVED):
// a label and a colour, each either the project's own configured value or
// the product default. The ReserveStatus enum itself never changes — only
// this presentation layer is configurable, per project (see
// prisma/schema.prisma's Project doc and migration
// 20260823090000_project_reserve_status_style).
//
// This is the ONLY place #e11d48 (open) and #16a34a (resolved) may appear —
// they used to be hand-duplicated in three places (the plan pin's Tailwind
// classes, the status pill's colour table, and lib/reservesReport.ts's PDF
// COLORS constant, the last one carrying a comment admitting it was a
// parallelism "matched" by hand). Every one of those now calls this
// function instead of hard-coding the pair again.
//
// Pure and side-effect-free on purpose: both the UI (badge/pin) and the PDF
// report call this with the SAME two inputs — the project row and the
// current locale's status labels — so the screen and a report printed for a
// sous-traitant can never drift from each other.

/** The default, product-wide colour for each réserve status. */
export const DEFAULT_RESERVE_STATUS_COLOR = {
  OPEN: "#e11d48",
  RESOLVED: "#16a34a",
} as const;

/**
 * The subset of a Project row this module needs — a narrow structural type
 * rather than the generated Prisma `Project`, so a repository `select` that
 * only picks these four columns already satisfies it.
 */
export type ReserveStatusStyleSource = {
  reserveOpenLabel: string | null;
  reserveOpenColor: string | null;
  reserveResolvedLabel: string | null;
  reserveResolvedColor: string | null;
};

/** The two OPEN/RESOLVED strings from the i18n dictionary — callers pass
 * `t.reserves.status`, never the whole `Dictionary`: this module has no
 * business knowing about the rest of it. */
export type ReserveStatusLabels = { OPEN: string; RESOLVED: string };

export type ReserveStatusStyle = { label: string; color: string };

export type ResolvedReserveStatusStyle = {
  open: ReserveStatusStyle;
  resolved: ReserveStatusStyle;
};

/**
 * `(project, dictionary) -> { open, resolved }`. A NULL column falls back to
 * the i18n dictionary (label — per-locale, so the fallback can't be a single
 * frozen database DEFAULT) or to the shared colour constant above (colour).
 * A non-null column is used verbatim: both are already validated (Zod at
 * write time, a database CHECK underneath it) before they ever reach here.
 */
export function resolveReserveStatusStyle(
  project: ReserveStatusStyleSource,
  statusLabels: ReserveStatusLabels
): ResolvedReserveStatusStyle {
  return {
    open: {
      label: project.reserveOpenLabel ?? statusLabels.OPEN,
      color: project.reserveOpenColor ?? DEFAULT_RESERVE_STATUS_COLOR.OPEN,
    },
    resolved: {
      label: project.reserveResolvedLabel ?? statusLabels.RESOLVED,
      color: project.reserveResolvedColor ?? DEFAULT_RESERVE_STATUS_COLOR.RESOLVED,
    },
  };
}
