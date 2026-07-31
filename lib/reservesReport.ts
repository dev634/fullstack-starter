import PDFDocument from "pdfkit";
import { planPageImageUrl, reportImageUrl } from "@/lib/cloudinary-url";
import {
  groupPlansForReport,
  summarizeReserves,
  formatCoordinates,
  type ReportFolder,
  type ReportPlan,
  type ReportReserve,
} from "@/lib/reservesReportData";

// A4 geometry (pt) + a single margin used for the text column and the
// header/footer stamps.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - MARGIN;

const COLORS = {
  text: "#111827",
  muted: "#6b7280",
  line: "#d1d5db",
  open: "#e11d48", // rose-600 — matches the open pin in the UI
  resolved: "#16a34a", // green-600 — matches the resolved pin
  accent: "#2563eb",
  white: "#ffffff",
} as const;

/** Only our own asset host may be fetched — these URLs end up in a server-side
 * request, so an attacker-controlled one would be an SSRF vector. */
const ALLOWED_IMAGE_HOST = "res.cloudinary.com";
const IMAGE_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * pdfkit decodes images through `openImage()` at runtime (it is what
 * `doc.image()` calls internally), but @types/pdfkit 0.17 doesn't declare it.
 * A narrow structural type keeps the call honest without casting to `any` —
 * we only need the intrinsic dimensions to place the pins.
 */
type ImageOpener = { openImage(src: Buffer): { width: number; height: number } };

/** Fetches a remote image as a Buffer, or null when it can't be embedded. */
export type ImageFetcher = (url: string) => Promise<Buffer | null>;

const PHOTO_WIDTH = 700;

// Keys into the prefetched-image map. Both the prefetch pass and the render
// pass go through these, so a transform tweak can't silently orphan an image.
const planKey = (plan: ReportPlan) => planPageImageUrl(plan.url);
const photoKey = (url: string) => reportImageUrl(url, PHOTO_WIDTH);

export const fetchRemoteImage: ImageFetcher = async (url) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_IMAGE_HOST) return null;

  try {
    const res = await fetch(parsed.toString(), { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= MAX_IMAGE_BYTES ? buf : null;
  } catch {
    // A missing plan/photo must not fail the whole report — it is rendered as
    // a "couldn't load" note instead.
    return null;
  }
};

/**
 * Fetch every image the report needs up front, deduplicated and with bounded
 * parallelism. Fetching lazily inside the render loop would serialise one
 * network round-trip per réserve, which a project with dozens of photographed
 * réserves cannot afford.
 */
async function prefetchImages(
  urls: readonly string[],
  fetchImage: ImageFetcher,
  concurrency = 6
): Promise<Map<string, Buffer>> {
  const unique = [...new Set(urls)];
  const loaded = new Map<string, Buffer>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < unique.length) {
      const url = unique[cursor++];
      const buffer = await fetchImage(url);
      if (buffer) loaded.set(url, buffer);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return loaded;
}

export type ReportLabels = {
  title: string;
  businessNumber: string;
  address: string;
  generatedOn: string;
  /** Cover tiles — counts, so these read as plurals ("Ouvertes"). */
  total: string;
  summaryOpen: string;
  summaryResolved: string;
  /** Per-réserve badge — singular ("Ouverte"), shared with the on-screen UI. */
  statusOpen: string;
  statusResolved: string;
  /** Heading for plans that sit at the project root rather than in a folder. */
  rootGroup: string;
  noReserves: string;
  gps: string;
  planUnavailable: string;
  page: string;
};

export type ReservesReportInput = {
  project: { name: string; businessNumber: string | null; address: string | null };
  companyName: string;
  folders: readonly ReportFolder[];
  plans: readonly ReportPlan[];
  labels: ReportLabels;
  locale: string;
  generatedAt?: Date;
  fetchImage?: ImageFetcher;
};

/**
 * Render the project's réserves as a printable report: a cover page, then one
 * section per plan (grouped by folder) showing the annotated plan followed by
 * a numbered card per réserve.
 *
 * Réserve numbering mirrors the on-screen pins exactly — the caller must pass
 * each plan's reserves in the same order the UI renders them (createdAt asc),
 * or the plan annotations and the cards will disagree.
 */
export async function buildReservesReport(input: ReservesReportInput): Promise<Buffer> {
  const { project, companyName, folders, plans, labels, locale } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const fetchImage = input.fetchImage ?? fetchRemoteImage;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: `${labels.title} — ${project.name}`, Author: companyName },
  });
  doc.registerFont("body", "Helvetica");
  doc.registerFont("bold", "Helvetica-Bold");

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const dateText = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(generatedAt);
  const summary = summarizeReserves(plans);
  const groups = groupPlansForReport(folders, plans);

  // Resolve every image before drawing anything, so rendering stays synchronous.
  const images = await prefetchImages(
    [
      ...plans.map(planKey),
      ...plans.flatMap((p) => p.reserves.flatMap((r) => (r.photos[0] ? [photoKey(r.photos[0].url)] : []))),
    ],
    fetchImage
  );

  // Start a new page when `needed` points won't fit under the current cursor.
  const ensureSpace = (needed: number) => {
    if (doc.y + needed > BOTTOM) doc.addPage();
  };

  renderCover(doc, { project, companyName, labels, dateText, summary });

  for (const group of groups) {
    for (const plan of group.plans) {
      doc.addPage();
      renderPlanHeading(doc, {
        folderName: group.folder?.name ?? null,
        planName: plan.name,
        labels,
      });
      renderPlanImage(doc, { plan, labels, images });

      if (plan.reserves.length === 0) {
        ensureSpace(24);
        doc.font("body").fontSize(10).fillColor(COLORS.muted);
        doc.text(labels.noReserves, MARGIN, doc.y + 12, { width: CONTENT_W });
        continue;
      }

      doc.y += 16;
      for (const [index, reserve] of plan.reserves.entries()) {
        renderReserveCard(doc, { reserve, number: index + 1, labels, images, ensureSpace });
      }
    }
  }

  stampFooters(doc, { project, labels });
  doc.end();
  return done;
}

type Summary = { total: number; open: number; resolved: number };

function renderCover(
  doc: PDFKit.PDFDocument,
  args: {
    project: ReservesReportInput["project"];
    companyName: string;
    labels: ReportLabels;
    dateText: string;
    summary: Summary;
  }
) {
  const { project, companyName, labels, dateText, summary } = args;
  doc.addPage();

  doc.fillColor(COLORS.accent).font("bold").fontSize(11);
  doc.text(labels.title.toUpperCase(), MARGIN, 132, { characterSpacing: 2, width: CONTENT_W });

  doc.fillColor(COLORS.text).font("bold").fontSize(30);
  doc.text(project.name, MARGIN, 168, { width: CONTENT_W });

  doc.fillColor(COLORS.muted).font("body").fontSize(13);
  doc.text(companyName, MARGIN, doc.y + 6, { width: CONTENT_W });

  // Meta rows — only those the project actually has.
  const rows: [string, string][] = [];
  if (project.businessNumber) rows.push([labels.businessNumber, project.businessNumber]);
  if (project.address) rows.push([labels.address, project.address]);
  rows.push([labels.generatedOn, dateText]);

  let y = doc.y + 28;
  for (const [label, value] of rows) {
    doc.font("bold").fontSize(9).fillColor(COLORS.muted);
    doc.text(label.toUpperCase(), MARGIN, y, { width: 140, characterSpacing: 0.5, lineBreak: false });
    doc.font("body").fontSize(11).fillColor(COLORS.text);
    doc.text(value, MARGIN + 150, y - 2, { width: CONTENT_W - 150 });
    y = Math.max(doc.y, y + 16) + 6;
  }

  // Summary tiles: total / open / resolved.
  const tiles: [string, number, string][] = [
    [labels.total, summary.total, COLORS.text],
    [labels.summaryOpen, summary.open, COLORS.open],
    [labels.summaryResolved, summary.resolved, COLORS.resolved],
  ];
  const gap = 12;
  const tileW = (CONTENT_W - gap * 2) / 3;
  const tileY = y + 24;
  tiles.forEach(([label, value, color], i) => {
    const x = MARGIN + i * (tileW + gap);
    doc.roundedRect(x, tileY, tileW, 74, 8).lineWidth(1).strokeColor(COLORS.line).stroke();
    doc.font("bold").fontSize(26).fillColor(color);
    doc.text(String(value), x, tileY + 16, { width: tileW, align: "center", lineBreak: false });
    doc.font("body").fontSize(9.5).fillColor(COLORS.muted);
    doc.text(label, x, tileY + 50, { width: tileW, align: "center", lineBreak: false });
  });
}

function renderPlanHeading(
  doc: PDFKit.PDFDocument,
  args: { folderName: string | null; planName: string; labels: ReportLabels }
) {
  const { folderName, planName, labels } = args;
  doc.font("bold").fontSize(9).fillColor(COLORS.accent);
  doc.text((folderName ?? labels.rootGroup).toUpperCase(), MARGIN, MARGIN, {
    characterSpacing: 1,
    width: CONTENT_W,
    lineBreak: false,
  });
  doc.font("bold").fontSize(19).fillColor(COLORS.text);
  doc.text(planName, MARGIN, doc.y + 4, { width: CONTENT_W });
  doc
    .moveTo(MARGIN, doc.y + 8)
    .lineTo(PAGE_W - MARGIN, doc.y + 8)
    .lineWidth(1)
    .strokeColor(COLORS.line)
    .stroke();
  doc.y += 20;
}

/** Draw the plan page with a numbered pin per réserve, matching the UI's colors. */
function renderPlanImage(
  doc: PDFKit.PDFDocument,
  args: { plan: ReportPlan; labels: ReportLabels; images: Map<string, Buffer> }
) {
  const { plan, labels, images } = args;
  const buffer = images.get(planKey(plan));

  if (!buffer) {
    doc.font("body").fontSize(10).fillColor(COLORS.muted);
    doc.text(labels.planUnavailable, MARGIN, doc.y, { width: CONTENT_W });
    return;
  }

  let image: { width: number; height: number };
  try {
    image = (doc as unknown as ImageOpener).openImage(buffer);
  } catch {
    doc.font("body").fontSize(10).fillColor(COLORS.muted);
    doc.text(labels.planUnavailable, MARGIN, doc.y, { width: CONTENT_W });
    return;
  }

  const maxH = BOTTOM - doc.y - 12;
  const scale = Math.min(CONTENT_W / image.width, maxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const x = MARGIN + (CONTENT_W - w) / 2;
  const y = doc.y;

  doc.image(buffer, x, y, { width: w, height: h });
  doc.rect(x, y, w, h).lineWidth(0.5).strokeColor(COLORS.line).stroke();

  const radius = 8;
  plan.reserves.forEach((reserve, index) => {
    // x/y are stored relative (0..1) so they survive any rescale.
    const cx = x + reserve.x * w;
    const cy = y + reserve.y * h;
    const color = reserve.status === "RESOLVED" ? COLORS.resolved : COLORS.open;
    doc.circle(cx, cy, radius).fillColor(color).fill();
    doc.circle(cx, cy, radius).lineWidth(1.2).strokeColor(COLORS.white).stroke();
    doc.font("bold").fontSize(8).fillColor(COLORS.white);
    doc.text(String(index + 1), cx - radius, cy - 3.6, {
      width: radius * 2,
      align: "center",
      lineBreak: false,
    });
  });

  doc.y = y + h + 6;
}

const CARD_PHOTO = 78;

function renderReserveCard(
  doc: PDFKit.PDFDocument,
  args: {
    reserve: ReportReserve;
    number: number;
    labels: ReportLabels;
    images: Map<string, Buffer>;
    ensureSpace: (needed: number) => void;
  }
) {
  const { reserve, number, labels, images, ensureSpace } = args;
  const photoUrl = reserve.photos[0]?.url;
  const photo = photoUrl ? images.get(photoKey(photoUrl)) : undefined;

  const textX = MARGIN + 30;
  const textW = CONTENT_W - 30 - (photo ? CARD_PHOTO + 12 : 0);
  const descHeight = doc.font("body").fontSize(10.5).heightOfString(reserve.description, { width: textW });
  const cardHeight = Math.max(photo ? CARD_PHOTO : 0, descHeight + 32) + 14;
  ensureSpace(cardHeight);

  const top = doc.y;
  const color = reserve.status === "RESOLVED" ? COLORS.resolved : COLORS.open;

  // Numbered badge, same colour coding as the pin on the plan.
  doc.circle(MARGIN + 10, top + 10, 10).fillColor(color).fill();
  doc.font("bold").fontSize(9).fillColor(COLORS.white);
  doc.text(String(number), MARGIN, top + 6.6, { width: 20, align: "center", lineBreak: false });

  doc.font("bold").fontSize(9).fillColor(color);
  doc.text(
    reserve.status === "RESOLVED" ? labels.statusResolved : labels.statusOpen,
    textX,
    top + 1,
    { width: textW, characterSpacing: 0.4, lineBreak: false }
  );

  doc.font("body").fontSize(10.5).fillColor(COLORS.text);
  doc.text(reserve.description, textX, top + 14, { width: textW });

  const gps = formatCoordinates(reserve.latitude, reserve.longitude);
  if (gps) {
    doc.font("body").fontSize(8.5).fillColor(COLORS.muted);
    doc.text(`${labels.gps} : ${gps}`, textX, doc.y + 3, { width: textW, lineBreak: false });
  }

  if (photo) {
    try {
      doc.image(photo, PAGE_W - MARGIN - CARD_PHOTO, top, {
        fit: [CARD_PHOTO, CARD_PHOTO],
        align: "center",
        valign: "center",
      });
    } catch {
      // Undecodable photo: the card still carries the description.
    }
  }

  const bottom = top + cardHeight;
  doc
    .moveTo(MARGIN, bottom - 6)
    .lineTo(PAGE_W - MARGIN, bottom - 6)
    .lineWidth(0.5)
    .strokeColor(COLORS.line)
    .stroke();
  doc.y = bottom;
}

/**
 * Stamp "project — page n/N" on every page except the cover.
 *
 * The vertical margins are zeroed first: pdfkit auto-paginates when text is
 * written below the bottom margin, so stamping a footer on an already
 * laid-out page would otherwise append a blank page per stamp.
 */
function stampFooters(
  doc: PDFKit.PDFDocument,
  args: { project: ReservesReportInput["project"]; labels: ReportLabels }
) {
  const { project, labels } = args;
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;

    doc.font("body").fontSize(8).fillColor(COLORS.muted);
    doc.text(project.name, MARGIN, PAGE_H - 32, {
      width: CONTENT_W / 2,
      lineBreak: false,
    });
    doc.text(
      labels.page.replace("{current}", String(i + 1)).replace("{total}", String(range.count)),
      PAGE_W / 2,
      PAGE_H - 32,
      { width: CONTENT_W / 2, align: "right", lineBreak: false }
    );
  }
}
