import {
  createReportDocument,
  ensureSpace,
  renderBrandHeader,
  renderSummaryTiles,
  renderSectionHeading,
  renderListHeading,
  renderEmptyState,
  renderProgressRow,
  stampFooters,
  REPORT_COLORS,
  MARGIN,
  CONTENT_W,
  PAGE_W,
  type ReportDocument,
  type MetaRow,
  type TileSpec,
} from "@/lib/pdfReport";
import { format } from "@/lib/i18n/format";
import { mixTowardBlack } from "@/lib/color";
import { STOCK_HEX, countByStockStatus, type MaterialStockStatus } from "@/lib/materialStock";
import type { TaskProgressStats, TrackedMaterial } from "@/lib/projectDashboard";
import type { AssigneeProgress } from "@/repository/tasks";
import type { ReserveTally } from "@/repository/reserves";

/**
 * PDF reports for the project dashboard's five sections (Tâches, Par
 * intérimaire, Par entreprise sous-traitante, Réserves, Matériel), plus a
 * combined report. Réserves has NO builder of its own here on purpose: its
 * dedicated route (app/clients/[id]/projects/[projectId]/reserves/report)
 * already renders the richer plans/pins/photos report, and the section's own
 * download button links straight to it — see `renderReservesTallySection`'s
 * own doc for the one place réserves data DOES appear in this file (a plain
 * open/resolved tally, only inside the combined report, mirroring exactly
 * what the dashboard's own Réserves section shows: two counts, not a list).
 *
 * Built on top of lib/pdfReport.ts's shared mechanics — see that module and
 * lib/reservesReport.ts (its first consumer) for the fonts/geometry/brand
 * header/tiles/footer plumbing this file never re-derives.
 */

export type DashboardReportProject = {
  name: string;
  businessNumber: string | null;
  address: string | null;
};

/** Chrome shared by every report in this file — the PDF equivalent of a
 * report's own masthead, never section-specific wording. */
export type DashboardReportChrome = {
  generatedOn: string;
  total: string;
  done: string;
  percent: string;
  /** "{value} %" (fr) / "{value}%" (en) — a percent TILE's own value, kept
   * separate from `rowStats` templates (whose "%" spacing is baked into each
   * report's own dictionary string) so the locale's typographic convention
   * (French puts a space before %, English doesn't) is never hard-coded here. */
  percentValue: string;
  /** "{current} / {total}" page-number template, same shape as
   * lib/reservesReport.ts's ReportLabels.page. */
  page: string;
  businessNumber: string;
  address: string;
};

type ReportContext = {
  project: DashboardReportProject;
  companyName: string;
  locale: string;
  chrome: DashboardReportChrome;
  generatedAt?: Date;
};

function metaRowsFor(project: DashboardReportProject, chrome: DashboardReportChrome, dateText: string): MetaRow[] {
  const rows: MetaRow[] = [];
  if (project.businessNumber) rows.push([chrome.businessNumber, project.businessNumber]);
  if (project.address) rows.push([chrome.address, project.address]);
  rows.push([chrome.generatedOn, dateText]);
  return rows;
}

/** Cover page every standalone report opens with: `kicker` is this report's
 * own section title, `heading` the project's name — see
 * lib/pdfReport.ts::renderBrandHeader's own doc for why no position override
 * is needed outside lib/reservesReport.ts. */
function renderCover(doc: ReportDocument, ctx: ReportContext & { kicker: string; dateText: string }): void {
  doc.addPage();
  renderBrandHeader(doc, {
    kicker: ctx.kicker,
    heading: ctx.project.name,
    subheading: ctx.companyName,
    metaRows: metaRowsFor(ctx.project, ctx.chrome, ctx.dateText),
  });
}

function stampReportFooters(doc: ReportDocument, project: DashboardReportProject, chrome: DashboardReportChrome): void {
  stampFooters(doc, {
    leftText: project.name,
    pageLabel: (current, total) => format(chrome.page, { current, total }),
  });
}

function dateTextFor(locale: string, generatedAt: Date | undefined): { generatedAt: Date; dateText: string } {
  const at = generatedAt ?? new Date();
  return { generatedAt: at, dateText: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(at) };
}

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

export type TaskProgressRow = { id: string | number; name: string; done: number; total: number; percent: number };

export type TasksReportLabels = {
  /** "Avancement des tâches" — both the cover kicker and the content page's
   * section heading. */
  title: string;
  /** "Ensemble du projet" — the content page's own big heading, above the
   * overall done/total/percent tiles. */
  overall: string;
  categoriesTitle: string;
  detailedTitle: string;
  none: string;
  /** "{percent} % ({done}/{total})" — same template as the dashboard's own
   * collapsed-section badge (t.projectDashboard.tasksBadge), reused verbatim
   * for every progress row this file draws (tasks, catégories, intérimaires,
   * entreprises): identical shape, identical meaning. */
  rowStats: string;
};

export type TasksReportInput = ReportContext & {
  progress: TaskProgressStats;
  details: readonly TaskProgressRow[];
  labels: TasksReportLabels;
};

function renderProgressRows(
  doc: ReportDocument,
  rows: readonly { name: string; done: number; total: number; percent: number }[],
  rowStatsTemplate: string
): void {
  for (const row of rows) {
    renderProgressRow(doc, {
      name: row.name,
      statsLabel: format(rowStatsTemplate, { percent: Math.round(row.percent), done: row.done, total: row.total }),
    });
  }
}

/** The section body content (everything after the cover): a fresh page, the
 * section heading, then whatever the section has to show. Shared between a
 * report's own standalone route and the combined report — see this file's
 * module doc. */
function renderTasksSection(doc: ReportDocument, input: TasksReportInput): void {
  const { project, chrome, progress, details, labels } = input;

  doc.addPage();
  renderSectionHeading(doc, { kicker: project.name, heading: labels.overall });

  if (progress.total > 0) {
    const tiles: TileSpec[] = [
      { label: chrome.total, value: String(progress.total), color: REPORT_COLORS.text },
      { label: chrome.done, value: String(progress.done), color: REPORT_COLORS.text },
      {
        label: chrome.percent,
        value: format(chrome.percentValue, { value: Math.round(progress.percent) }),
        color: REPORT_COLORS.accent,
      },
    ];
    doc.y = renderSummaryTiles(doc, tiles, doc.y + 12) + 20;
  } else {
    renderEmptyState(doc, labels.none);
  }

  if (progress.groups.length > 0) {
    renderListHeading(doc, labels.categoriesTitle);
    renderProgressRows(doc, progress.groups, labels.rowStats);
  }

  if (details.length > 0) {
    renderListHeading(doc, labels.detailedTitle);
    renderProgressRows(doc, details, labels.rowStats);
  }
}

export async function buildTasksReport(input: TasksReportInput): Promise<Buffer> {
  const { project, companyName, locale, chrome, labels } = input;
  const { dateText } = dateTextFor(locale, input.generatedAt);

  const { doc, done } = createReportDocument({ title: `${labels.title} — ${project.name}`, author: companyName });
  renderCover(doc, { ...input, kicker: labels.title, dateText });
  renderTasksSection(doc, input);
  stampReportFooters(doc, project, chrome);
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Par intérimaire / par entreprise sous-traitante
// ---------------------------------------------------------------------------

export type AssigneeReportLabels = {
  title: string;
  none: string;
  rowStats: string;
};

export type AssigneeReportInput = ReportContext & {
  rows: readonly AssigneeProgress[];
  labels: AssigneeReportLabels;
};

function renderAssigneeSection(doc: ReportDocument, input: AssigneeReportInput): void {
  const { project, rows, labels } = input;

  doc.addPage();
  renderSectionHeading(doc, { kicker: project.name, heading: labels.title });

  if (rows.length === 0) {
    renderEmptyState(doc, labels.none);
    return;
  }
  renderProgressRows(doc, rows, labels.rowStats);
}

async function buildAssigneeProgressReport(input: AssigneeReportInput): Promise<Buffer> {
  const { project, companyName, locale, chrome, labels } = input;
  const { dateText } = dateTextFor(locale, input.generatedAt);

  const { doc, done } = createReportDocument({ title: `${labels.title} — ${project.name}`, author: companyName });
  renderCover(doc, { ...input, kicker: labels.title, dateText });
  renderAssigneeSection(doc, input);
  stampReportFooters(doc, project, chrome);
  doc.end();
  return done;
}

/** "Avancement par intérimaire" — same body as buildCompaniesReport below,
 * shared via renderAssigneeSection/buildAssigneeProgressReport: unlike
 * repository/tasks.ts's computeProgressByInterim/computeProgressByCompany
 * (kept as a literal SQL duplicate because the column/table names can't be
 * parameterized), nothing here depends on which assignee kind `rows` came
 * from — sharing the renderer is not a premature abstraction, it's the same
 * layout drawing the same shape of data. */
export function buildInterimsReport(input: AssigneeReportInput): Promise<Buffer> {
  return buildAssigneeProgressReport(input);
}

/** "Avancement par entreprise sous-traitante" — see buildInterimsReport's doc. */
export function buildCompaniesReport(input: AssigneeReportInput): Promise<Buffer> {
  return buildAssigneeProgressReport(input);
}

// ---------------------------------------------------------------------------
// Matériel
// ---------------------------------------------------------------------------

export type MaterialsReportLabels = {
  title: string;
  listTitle: string;
  none: string;
  /** t.materials.stockStatus — same three words the on-screen dot/legend use. */
  stockStatus: Record<MaterialStockStatus, string>;
};

export type MaterialsReportInput = ReportContext & {
  /** Already computeTrackedMaterials(...)'d — worst-stock-first, one row per
   * material that has a required quantity, exactly what the dashboard's own
   * donut + list render (untracked materials are never shown there either). */
  materials: readonly TrackedMaterial[];
  labels: MaterialsReportLabels;
};

const MATERIAL_DOT_RADIUS = 4;
const MATERIAL_QUANTITY_W = 90;
const MATERIAL_STATUS_W = 130;

/** One "● name … status … quantity/required" line, with a thin rule
 * underneath — the PDF equivalent of the dashboard's own coloured-dot
 * material list (app/.../dashboard/page.tsx's `namedMaterials.map(...)`). */
function renderMaterialRow(doc: ReportDocument, material: TrackedMaterial, statusLabel: string): void {
  ensureSpace(doc, 26);
  const y = doc.y;
  const nameX = MARGIN + MATERIAL_DOT_RADIUS * 2 + 8;
  const nameW = CONTENT_W - (nameX - MARGIN) - MATERIAL_QUANTITY_W - MATERIAL_STATUS_W - 8;
  const statusX = PAGE_W - MARGIN - MATERIAL_QUANTITY_W - MATERIAL_STATUS_W;
  const quantityX = PAGE_W - MARGIN - MATERIAL_QUANTITY_W;

  doc.circle(MARGIN + MATERIAL_DOT_RADIUS, y + 9, MATERIAL_DOT_RADIUS).fillColor(STOCK_HEX[material.status]).fill();

  doc.font("body").fontSize(10.5).fillColor(REPORT_COLORS.text);
  doc.text(material.name, nameX, y, { width: nameW, lineBreak: false });

  doc.font("body").fontSize(9.5).fillColor(REPORT_COLORS.muted);
  doc.text(statusLabel, statusX, y, { width: MATERIAL_STATUS_W, lineBreak: false });

  doc.font("bold").fontSize(10).fillColor(REPORT_COLORS.text);
  doc.text(`${material.quantity} / ${material.requiredQuantity}`, quantityX, y, {
    width: MATERIAL_QUANTITY_W,
    align: "right",
    lineBreak: false,
  });

  doc
    .moveTo(MARGIN, y + 18)
    .lineTo(PAGE_W - MARGIN, y + 18)
    .lineWidth(0.5)
    .strokeColor(REPORT_COLORS.line)
    .stroke();
  doc.y = y + 24;
}

function renderMaterialsSection(doc: ReportDocument, input: MaterialsReportInput): void {
  const { project, materials, labels } = input;

  doc.addPage();
  renderSectionHeading(doc, { kicker: project.name, heading: labels.title });

  if (materials.length === 0) {
    renderEmptyState(doc, labels.none);
    return;
  }

  const counts = countByStockStatus(materials);
  const tiles: TileSpec[] = [
    { label: labels.stockStatus.red, value: String(counts.red), color: STOCK_HEX.red },
    { label: labels.stockStatus.orange, value: String(counts.orange), color: STOCK_HEX.orange },
    { label: labels.stockStatus.green, value: String(counts.green), color: STOCK_HEX.green },
  ];
  doc.y = renderSummaryTiles(doc, tiles, doc.y + 12) + 20;

  renderListHeading(doc, labels.listTitle);
  for (const material of materials) {
    renderMaterialRow(doc, material, labels.stockStatus[material.status]);
  }
}

export async function buildMaterialsReport(input: MaterialsReportInput): Promise<Buffer> {
  const { project, companyName, locale, chrome, labels } = input;
  const { dateText } = dateTextFor(locale, input.generatedAt);

  const { doc, done } = createReportDocument({ title: `${labels.title} — ${project.name}`, author: companyName });
  renderCover(doc, { ...input, kicker: labels.title, dateText });
  renderMaterialsSection(doc, input);
  stampReportFooters(doc, project, chrome);
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Réserves — tally only, combined report exclusively (see module doc)
// ---------------------------------------------------------------------------

export type ReservesTallyLabels = {
  title: string;
  none: string;
  total: string;
  open: string;
  resolved: string;
};

type ReservesTallySection = {
  tally: ReserveTally;
  statusColors: { open: string; resolved: string };
  labels: ReservesTallyLabels;
};

/**
 * Draws exactly what the dashboard's own Réserves section shows: two counts
 * (open/resolved) plus the total, nothing else — never plans, pins or
 * photos, which stay behind the dedicated réserves report route (this file's
 * own module doc explains why). Only called from buildGlobalDashboardReport:
 * there is no standalone "réserves tally" route, since the dashboard's own
 * Réserves button links straight to that dedicated report instead.
 */
function renderReservesTallySection(doc: ReportDocument, project: DashboardReportProject, section: ReservesTallySection): void {
  const { tally, statusColors, labels } = section;

  doc.addPage();
  renderSectionHeading(doc, { kicker: project.name, heading: labels.title });

  if (tally.total === 0) {
    renderEmptyState(doc, labels.none);
    return;
  }

  const tiles: TileSpec[] = [
    { label: labels.total, value: String(tally.total), color: REPORT_COLORS.text },
    { label: labels.open, value: String(tally.open), color: mixTowardBlack(statusColors.open) },
    { label: labels.resolved, value: String(tally.resolved), color: mixTowardBlack(statusColors.resolved) },
  ];
  doc.y = renderSummaryTiles(doc, tiles, doc.y + 12);
}

// ---------------------------------------------------------------------------
// Rapport complet
// ---------------------------------------------------------------------------

export type GlobalReportSections = {
  tasks?: Omit<TasksReportInput, keyof ReportContext>;
  interims?: Omit<AssigneeReportInput, keyof ReportContext>;
  companies?: Omit<AssigneeReportInput, keyof ReportContext>;
  reserves?: ReservesTallySection;
  materials?: Omit<MaterialsReportInput, keyof ReportContext>;
};

export type GlobalReportInput = ReportContext & {
  /** "Rapport complet du tableau de bord" — the cover's own kicker. */
  title: string;
  /**
   * Only the sections the caller may see are present here — the route
   * handler decides that (canAccessSection per section, mirroring
   * app/.../dashboard/page.tsx's own showTasks/showInterims/… booleans), this
   * function only ever draws what it's handed. Rendered in the SAME order as
   * the dashboard page: Tâches, Par intérimaire, Par entreprise
   * sous-traitante, Réserves, Matériel.
   */
  sections: GlobalReportSections;
};

export async function buildGlobalDashboardReport(input: GlobalReportInput): Promise<Buffer> {
  const { project, companyName, locale, chrome, title, sections } = input;
  const { generatedAt, dateText } = dateTextFor(locale, input.generatedAt);

  const { doc, done } = createReportDocument({ title: `${title} — ${project.name}`, author: companyName });
  renderCover(doc, { project, companyName, locale, chrome, generatedAt, kicker: title, dateText });

  if (sections.tasks) {
    renderTasksSection(doc, { project, companyName, locale, chrome, generatedAt, ...sections.tasks });
  }
  if (sections.interims) {
    renderAssigneeSection(doc, { project, companyName, locale, chrome, generatedAt, ...sections.interims });
  }
  if (sections.companies) {
    renderAssigneeSection(doc, { project, companyName, locale, chrome, generatedAt, ...sections.companies });
  }
  if (sections.reserves) {
    renderReservesTallySection(doc, project, sections.reserves);
  }
  if (sections.materials) {
    renderMaterialsSection(doc, { project, companyName, locale, chrome, generatedAt, ...sections.materials });
  }

  stampReportFooters(doc, project, chrome);
  doc.end();
  return done;
}
