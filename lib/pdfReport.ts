import PDFDocument from "pdfkit";

/**
 * Shared PDF rendering mechanics, extracted from lib/reservesReport.ts (the
 * first PDF report this app ever shipped) so a second, third… report never
 * has to re-derive A4 geometry, font registration, page-buffering plumbing,
 * the brand header, summary tiles, section headings, progress rows or
 * page-numbered footers from scratch.
 *
 * Kept free of any i18n/Prisma import on purpose, same reasoning as
 * lib/reservesReportData.ts: every string a caller wants drawn is passed in
 * already resolved, so this module stays pure layout and is trivial to unit
 * test without a locale or a database.
 *
 * lib/reservesReport.ts is this module's first (and pixel-for-pixel
 * unchanged) consumer — see that file's own doc for the mapping from its
 * pre-extraction local helpers to the exports below.
 */

// A4 geometry (pt) + a single margin used for the text column and the
// header/footer stamps.
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const BOTTOM = PAGE_H - MARGIN;

export const REPORT_COLORS = {
  text: "#111827",
  muted: "#6b7280",
  line: "#d1d5db",
  accent: "#2563eb",
  white: "#ffffff",
} as const;

export type ReportDocument = PDFKit.PDFDocument;

/**
 * A fresh, un-paged pdfkit document with the two fonts every report uses
 * already registered, plus the buffering plumbing that turns its `data`/`end`
 * events into a single awaited `Buffer`. `autoFirstPage: false` because every
 * caller adds its own first page explicitly (a cover, in every report so
 * far) — letting pdfkit add one implicitly would produce a stray blank page
 * whenever the caller also calls `doc.addPage()` right after.
 */
export function createReportDocument(args: { title: string; author: string }): {
  doc: ReportDocument;
  done: Promise<Buffer>;
} {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: args.title, Author: args.author },
  });
  doc.registerFont("body", "Helvetica");
  doc.registerFont("bold", "Helvetica-Bold");

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  return { doc, done };
}

/** Starts a new page when `needed` points won't fit under the current cursor. */
export function ensureSpace(doc: ReportDocument, needed: number): void {
  if (doc.y + needed > BOTTOM) doc.addPage();
}

export type MetaRow = readonly [label: string, value: string];

/**
 * The brand header block every report opens with: an uppercase accent
 * "kicker" line, a big heading below it, an optional muted subheading, then
 * a two-column table of meta rows (label left, value right of it).
 *
 * `kickerY`/`headingY` default to the top margin so the header sits at the
 * very top of whichever page it's drawn on. lib/reservesReport.ts's cover is
 * the one caller that overrides them (132/168) — the exact fixed positions
 * its pre-extraction `renderCover` used, kept so that report's layout is
 * unchanged. `headingY` itself defaults to `kickerY + 36` for the same
 * reason: 168 - 132 = 36, so passing only `kickerY: 132` already reproduces
 * the original spacing without a second override.
 *
 * Returns the y position right after the last meta row, so a caller can
 * carry on drawing (e.g. a row of summary tiles) below it.
 */
export function renderBrandHeader(
  doc: ReportDocument,
  args: {
    kicker: string;
    heading: string;
    subheading?: string;
    metaRows?: readonly MetaRow[];
    kickerY?: number;
    headingY?: number;
  }
): number {
  const { kicker, heading, subheading, metaRows = [] } = args;
  const kickerY = args.kickerY ?? MARGIN;
  const headingY = args.headingY ?? kickerY + 36;

  doc.fillColor(REPORT_COLORS.accent).font("bold").fontSize(11);
  doc.text(kicker.toUpperCase(), MARGIN, kickerY, { characterSpacing: 2, width: CONTENT_W });

  doc.fillColor(REPORT_COLORS.text).font("bold").fontSize(30);
  doc.text(heading, MARGIN, headingY, { width: CONTENT_W });

  if (subheading) {
    doc.fillColor(REPORT_COLORS.muted).font("body").fontSize(13);
    doc.text(subheading, MARGIN, doc.y + 6, { width: CONTENT_W });
  }

  let y = doc.y + 28;
  for (const [label, value] of metaRows) {
    doc.font("bold").fontSize(9).fillColor(REPORT_COLORS.muted);
    doc.text(label.toUpperCase(), MARGIN, y, { width: 140, characterSpacing: 0.5, lineBreak: false });
    doc.font("body").fontSize(11).fillColor(REPORT_COLORS.text);
    doc.text(value, MARGIN + 150, y - 2, { width: CONTENT_W - 150 });
    y = Math.max(doc.y, y + 16) + 6;
  }

  return y;
}

export type TileSpec = { label: string; value: string; color: string };

/**
 * A row of rounded-rect summary tiles (a big number over a muted label),
 * evenly split across the content width — lib/reservesReport.ts's cover
 * total/open/resolved tiles, generalized to any count and any colour per
 * tile. Returns the y position right below the tiles.
 */
export function renderSummaryTiles(doc: ReportDocument, tiles: readonly TileSpec[], y: number): number {
  if (tiles.length === 0) return y;
  const gap = 12;
  const tileH = 74;
  const tileW = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;

  tiles.forEach((tile, i) => {
    const x = MARGIN + i * (tileW + gap);
    doc.roundedRect(x, y, tileW, tileH, 8).lineWidth(1).strokeColor(REPORT_COLORS.line).stroke();
    doc.font("bold").fontSize(26).fillColor(tile.color);
    doc.text(tile.value, x, y + 16, { width: tileW, align: "center", lineBreak: false });
    doc.font("body").fontSize(9.5).fillColor(REPORT_COLORS.muted);
    doc.text(tile.label, x, y + 50, { width: tileW, align: "center", lineBreak: false });
  });

  return y + tileH;
}

/**
 * A page-top section heading: a small uppercase accent kicker, a bold title
 * below it, then a full-width rule — lib/reservesReport.ts's per-plan
 * heading, generalized (there the kicker was the folder name and the title
 * the plan name; every other report passes the project name as the kicker
 * and its own section title as the heading, so a reader who jumps straight
 * to page 2 still sees which chantier this is).
 */
export function renderSectionHeading(doc: ReportDocument, args: { kicker: string; heading: string }): void {
  const { kicker, heading } = args;
  doc.font("bold").fontSize(9).fillColor(REPORT_COLORS.accent);
  doc.text(kicker.toUpperCase(), MARGIN, MARGIN, { characterSpacing: 1, width: CONTENT_W, lineBreak: false });
  doc.font("bold").fontSize(19).fillColor(REPORT_COLORS.text);
  doc.text(heading, MARGIN, doc.y + 4, { width: CONTENT_W });
  doc
    .moveTo(MARGIN, doc.y + 8)
    .lineTo(PAGE_W - MARGIN, doc.y + 8)
    .lineWidth(1)
    .strokeColor(REPORT_COLORS.line)
    .stroke();
  doc.y += 20;
}

/** A small bold caption introducing a list further down the page (e.g.
 * "Avancement par catégorie / groupe" above a run of progress rows). */
export function renderListHeading(doc: ReportDocument, text: string): void {
  ensureSpace(doc, 34);
  doc.font("bold").fontSize(11).fillColor(REPORT_COLORS.text);
  doc.text(text, MARGIN, doc.y + 16, { width: CONTENT_W });
  doc.y += 6;
}

/** Centered muted note for a section with nothing to list yet — the PDF
 * equivalent of every dashboard section's own "…None" empty state. */
export function renderEmptyState(doc: ReportDocument, text: string): void {
  ensureSpace(doc, 26);
  doc.font("body").fontSize(10).fillColor(REPORT_COLORS.muted);
  doc.text(text, MARGIN, doc.y + 12, { width: CONTENT_W, align: "center" });
  doc.y += 12;
}

export type ProgressRow = { name: string; statsLabel: string };

/**
 * One "{name} … {statsLabel}" line (e.g. "Alice Dupont" / "42 % (12/28)"),
 * with a thin rule underneath, flowing across page breaks via `ensureSpace`
 * exactly like lib/reservesReport.ts's réserve cards do under one plan
 * heading — the heading is drawn once, rows below it paginate on their own.
 */
export function renderProgressRow(doc: ReportDocument, row: ProgressRow): void {
  ensureSpace(doc, 26);
  const y = doc.y;
  const statsWidth = 150;

  doc.font("body").fontSize(10.5).fillColor(REPORT_COLORS.text);
  doc.text(row.name, MARGIN, y, { width: CONTENT_W - statsWidth - 10, lineBreak: false });

  doc.font("bold").fontSize(10).fillColor(REPORT_COLORS.accent);
  doc.text(row.statsLabel, MARGIN + CONTENT_W - statsWidth, y, { width: statsWidth, align: "right", lineBreak: false });

  doc
    .moveTo(MARGIN, y + 18)
    .lineTo(PAGE_W - MARGIN, y + 18)
    .lineWidth(0.5)
    .strokeColor(REPORT_COLORS.line)
    .stroke();
  doc.y = y + 24;
}

/**
 * Stamp "leftText — pageLabel(n, total)" on every page from `firstPage`
 * onward (default 1, i.e. skip page 0 — every report so far treats its first
 * page as a cover with no footer of its own).
 *
 * The vertical margins are zeroed first: pdfkit auto-paginates when text is
 * written below the bottom margin, so stamping a footer on an already
 * laid-out page would otherwise append a blank page per stamp.
 */
export function stampFooters(
  doc: ReportDocument,
  args: { leftText: string; pageLabel: (current: number, total: number) => string; firstPage?: number }
): void {
  const { leftText, pageLabel, firstPage = 1 } = args;
  const range = doc.bufferedPageRange();
  for (let i = firstPage; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;

    doc.font("body").fontSize(8).fillColor(REPORT_COLORS.muted);
    doc.text(leftText, MARGIN, PAGE_H - 32, { width: CONTENT_W / 2, lineBreak: false });
    doc.text(pageLabel(i + 1, range.count), PAGE_W / 2, PAGE_H - 32, {
      width: CONTENT_W / 2,
      align: "right",
      lineBreak: false,
    });
  }
}
