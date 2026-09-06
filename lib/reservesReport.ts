import { buildDeliveryUrl } from "@/lib/cloudinaryDelivery";
import { contrastTextColor, mixTowardBlack } from "@/lib/color";
import { format } from "@/lib/i18n/format";
import {
  PAGE_W,
  MARGIN,
  CONTENT_W,
  BOTTOM,
  REPORT_COLORS as COLORS,
  createReportDocument,
  ensureSpace as ensureSpaceOnPage,
  renderBrandHeader,
  renderSummaryTiles,
  renderSectionHeading,
  stampFooters,
  type ReportDocument,
  type MetaRow,
  type TileSpec,
} from "@/lib/pdfReport";
import {
  groupPlansForReport,
  summarizeReserves,
  formatCoordinates,
  type ReportFolder,
  type ReportPlan,
  type ReportPhoto,
  type ReportReserve,
} from "@/lib/reservesReportData";

// A4 geometry, the shared colour palette, page-buffering and the brand
// header/tiles/section-heading/footer mechanics below all now live in
// lib/pdfReport.ts — this was the first PDF report this app shipped, so it
// carried all of that inline before a second report needed the same pieces.
// Nothing in this file's OWN drawing (the cover's meta rows, the per-plan
// heading, the annotated plan image, the réserve cards) moved: only the
// mechanics common to any report did.

// The OPEN/RESOLVED pin, badge and tile colours are NOT in the constant
// above: they are per-project configurable (Project.reserveOpenColor /
// reserveResolvedColor, resolved by lib/reserveStatusStyle.ts's
// resolveReserveStatusStyle — the ONLY place the #e11d48/#16a34a defaults
// still live). They arrive as `statusColors` on ReservesReportInput instead,
// so the report always draws the exact same colours the screen shows for
// this project, never a hard-coded, forever-default pair.
type StatusColors = { open: string; resolved: string };

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
const PLAN_PAGE_WIDTH = 1600;

// Keys into the prefetched-image map. Both the prefetch pass and the render
// pass go through these SAME functions, so a transform tweak can't silently
// orphan an image (the two passes would build different keys for what's
// otherwise the same asset).
//
// This report runs server-side and already holds the authorization the
// guarded delivery route (app/api/assets/[kind]/[id]/route.ts) exists to
// re-check on every request — going through it here would only add an HTTP
// round-trip and a dependency on this server's own public origin, for no
// extra safety. So it composes and signs its own URLs directly via
// buildDeliveryUrl, same as that route does internally. The transformation
// (page/width/format) is passed into the SAME call that signs the URL,
// because on a signed asset it has to be composed BEFORE signing — splicing
// it into an already-built URL (the old cloudinary-url.ts approach) breaks
// the signature.
// `crop: "limit"` matches the guarded delivery route's own transformation
// (lib/assetDelivery.ts::buildAssetTransformation) for the exact same width —
// without it, this report requests a SECOND, distinct Cloudinary derivative
// for what's meant to be the same rendered intention as the on-screen plan
// viewer, and nothing guarantees the two ever look alike.
const planKey = (plan: ReportPlan) =>
  buildDeliveryUrl(plan.asset, { page: 1, format: "jpg", width: PLAN_PAGE_WIDTH, crop: "limit", quality: "auto" });
const photoKey = (photo: ReportPhoto) =>
  buildDeliveryUrl(photo.asset, { format: "jpg", width: PHOTO_WIDTH, crop: "limit", quality: "auto" });

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
    if (!res.ok) {
      // Never the signed URL itself (it's a working, authenticated link) —
      // just enough to tell which asset and why, without which a report that
      // silently renders "plan unavailable" on every page is invisible: it
      // still returns 200, so nothing else would ever surface the failure.
      console.error("Réserves report: remote image fetch failed", {
        status: res.status,
        host: parsed.hostname,
      });
      return null;
    }
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= MAX_IMAGE_BYTES ? buf : null;
  } catch (error) {
    // A missing plan/photo must not fail the whole report — it is rendered as
    // a "couldn't load" note instead. Still logged, for the same reason as
    // the !res.ok branch above.
    console.error("Réserves report: remote image fetch threw", {
      host: parsed.hostname,
      error: error instanceof Error ? error.message : String(error),
    });
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
  total: string;
  /** This project's configured OPEN/RESOLVED label (falls back to the i18n
   * default) — the SAME string draws the cover tiles' counts AND the
   * per-réserve badges. Used to read "Ouvertes"/"Levées" on the cover and
   * "Ouverte"/"Levée" on the cards: two fixed, hard-coded product strings
   * that could silently drift from a project's own configured wording (a
   * chantier set to "À traiter" would say "Ouvertes : 3" at the top and "À
   * traiter" on every card below it — arbitrage, PR #196). */
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
  /** OPEN/RESOLVED pin, badge and tile colours — see the module doc above.
   * Callers resolve this with lib/reserveStatusStyle.ts's
   * resolveReserveStatusStyle, the SAME call the on-screen UI makes, so the
   * two never draw a different colour for the same status. */
  statusColors: StatusColors;
  locale: string;
  generatedAt?: Date;
  fetchImage?: ImageFetcher;
};

/**
 * Render the project's réserves as a printable report: a cover page, then one
 * section per plan (grouped by folder) showing the annotated plan followed by
 * a numbered card per réserve.
 *
 * Réserve numbers come from the stored `number` field, not from the render
 * order, so the plan annotations, the cards and a report printed months ago all
 * cite the same reference even after other réserves have been deleted.
 */
export async function buildReservesReport(input: ReservesReportInput): Promise<Buffer> {
  const { project, companyName, folders, plans, labels, statusColors, locale } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const fetchImage = input.fetchImage ?? fetchRemoteImage;

  const { doc, done } = createReportDocument({ title: `${labels.title} — ${project.name}`, author: companyName });

  const dateText = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(generatedAt);
  const summary = summarizeReserves(plans);
  const groups = groupPlansForReport(folders, plans);

  // Resolve every image before drawing anything, so rendering stays synchronous.
  const images = await prefetchImages(
    [
      ...plans.map(planKey),
      ...plans.flatMap((p) => p.reserves.flatMap((r) => (r.photos[0] ? [photoKey(r.photos[0])] : []))),
    ],
    fetchImage
  );

  // Start a new page when `needed` points won't fit under the current cursor.
  const ensureSpace = (needed: number) => ensureSpaceOnPage(doc, needed);

  renderCover(doc, { project, companyName, labels, statusColors, dateText, summary });

  for (const group of groups) {
    for (const plan of group.plans) {
      doc.addPage();
      renderPlanHeading(doc, {
        folderName: group.folder?.name ?? null,
        planName: plan.name,
        labels,
      });
      renderPlanImage(doc, { plan, labels, statusColors, images });

      if (plan.reserves.length === 0) {
        ensureSpace(24);
        doc.font("body").fontSize(10).fillColor(COLORS.muted);
        doc.text(labels.noReserves, MARGIN, doc.y + 12, { width: CONTENT_W });
        continue;
      }

      doc.y += 16;
      for (const reserve of plan.reserves) {
        renderReserveCard(doc, { reserve, labels, statusColors, images, ensureSpace });
      }
    }
  }

  stampFooters(doc, {
    leftText: project.name,
    pageLabel: (current, total) => format(labels.page, { current, total }),
  });
  doc.end();
  return done;
}

type Summary = { total: number; open: number; resolved: number };

function renderCover(
  doc: ReportDocument,
  args: {
    project: ReservesReportInput["project"];
    companyName: string;
    labels: ReportLabels;
    statusColors: StatusColors;
    dateText: string;
    summary: Summary;
  }
) {
  const { project, companyName, labels, statusColors, dateText, summary } = args;
  doc.addPage();

  // Meta rows — only those the project actually has.
  const metaRows: MetaRow[] = [];
  if (project.businessNumber) metaRows.push([labels.businessNumber, project.businessNumber]);
  if (project.address) metaRows.push([labels.address, project.address]);
  metaRows.push([labels.generatedOn, dateText]);

  // kickerY: 132 reproduces this cover's pre-extraction fixed position
  // exactly (see lib/pdfReport.ts::renderBrandHeader's own doc for why
  // headingY doesn't need its own override).
  const y = renderBrandHeader(doc, {
    kicker: labels.title,
    heading: project.name,
    subheading: companyName,
    metaRows,
    kickerY: 132,
  });

  // Summary tiles: total / open / resolved. The open/resolved tiles' NUMBER
  // is drawn with mixTowardBlack(...), never the raw configured hex: this is
  // text straight on the white cover page (no coloured disc behind it, unlike
  // the plan pin or the card's own number badge), so a pale, admin-picked
  // colour (bright yellow, say) needs the exact same contrast floor the
  // on-screen pill's text already has — see lib/color.ts::mixTowardBlack's
  // own doc. The label BELOW each tile now reuses labels.statusOpen/
  // statusResolved too (see ReportLabels's own doc) — never fed to
  // mixTowardBlack, it's always drawn in COLORS.muted, same as `total`'s own
  // label.
  const tiles: TileSpec[] = [
    { label: labels.total, value: String(summary.total), color: COLORS.text },
    { label: labels.statusOpen, value: String(summary.open), color: mixTowardBlack(statusColors.open) },
    { label: labels.statusResolved, value: String(summary.resolved), color: mixTowardBlack(statusColors.resolved) },
  ];
  renderSummaryTiles(doc, tiles, y + 24);
}

function renderPlanHeading(
  doc: ReportDocument,
  args: { folderName: string | null; planName: string; labels: ReportLabels }
) {
  const { folderName, planName, labels } = args;
  renderSectionHeading(doc, { kicker: folderName ?? labels.rootGroup, heading: planName });
}

/** Draw the plan page with a numbered pin per réserve, matching the UI's colors. */
function renderPlanImage(
  doc: ReportDocument,
  args: { plan: ReportPlan; labels: ReportLabels; statusColors: StatusColors; images: Map<string, Buffer> }
) {
  const { plan, labels, statusColors, images } = args;
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
  plan.reserves.forEach((reserve) => {
    // x/y are stored relative (0..1) so they survive any rescale.
    const cx = x + reserve.x * w;
    const cy = y + reserve.y * h;
    const color = reserve.status === "RESOLVED" ? statusColors.resolved : statusColors.open;
    doc.circle(cx, cy, radius).fillColor(color).fill();
    doc.circle(cx, cy, radius).lineWidth(1.2).strokeColor(COLORS.white).stroke();
    // The number is written on top of `color` — a project-configured colour
    // may be pale, so its readable text colour is computed, never assumed
    // white (see lib/color.ts::contrastTextColor).
    doc.font("bold").fontSize(8).fillColor(contrastTextColor(color));
    doc.text(String(reserve.number), cx - radius, cy - 3.6, {
      width: radius * 2,
      align: "center",
      lineBreak: false,
    });
  });

  doc.y = y + h + 6;
}

const CARD_PHOTO = 78;

function renderReserveCard(
  doc: ReportDocument,
  args: {
    reserve: ReportReserve;
    labels: ReportLabels;
    statusColors: StatusColors;
    images: Map<string, Buffer>;
    ensureSpace: (needed: number) => void;
  }
) {
  const { reserve, labels, statusColors, images, ensureSpace } = args;
  const firstPhoto = reserve.photos[0];
  const photo = firstPhoto ? images.get(photoKey(firstPhoto)) : undefined;

  const textX = MARGIN + 30;
  const textW = CONTENT_W - 30 - (photo ? CARD_PHOTO + 12 : 0);
  const descHeight = doc.font("body").fontSize(10.5).heightOfString(reserve.description, { width: textW });
  const cardHeight = Math.max(photo ? CARD_PHOTO : 0, descHeight + 32) + 14;
  ensureSpace(cardHeight);

  const top = doc.y;
  const color = reserve.status === "RESOLVED" ? statusColors.resolved : statusColors.open;

  // Numbered badge, same colour coding as the pin on the plan.
  doc.circle(MARGIN + 10, top + 10, 10).fillColor(color).fill();
  // Same readability rule as the plan pin above.
  doc.font("bold").fontSize(9).fillColor(contrastTextColor(color));
  doc.text(String(reserve.number), MARGIN, top + 6.6, { width: 20, align: "center", lineBreak: false });

  // Straight on the white card background (unlike the disc above it, or the
  // pin on the plan) — same contrast floor as the cover tiles' numbers, see
  // ReportLabels's own doc and lib/color.ts::mixTowardBlack.
  doc.font("bold").fontSize(9).fillColor(mixTowardBlack(color));
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
