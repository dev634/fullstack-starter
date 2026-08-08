// Pure support for the guarded asset delivery route
// (app/api/assets/[kind]/[id]/route.ts): kind/query validation, the
// Cloudinary transformation a request may compose, and response-shaping
// helpers (MIME type, Content-Disposition). Kept out of the route file so
// the validation/whitelist logic is unit-testable without mocking
// Request/Response or the database — the same split
// lib/reservesReportData.ts (pure shaping) keeps from lib/reservesReport.ts
// (rendering) and its route.
import z from "zod";
import type { DeliveryAsset, DeliveryTransformation } from "@/lib/cloudinaryDelivery";
import type { ProjectSectionKey } from "@/lib/projectSections";
import { ASSET_KINDS, ALLOWED_WIDTHS, type AssetKind } from "@/lib/assetPath";

// The kinds/widths themselves live in lib/assetPath.ts, the single source
// shared with the client-safe path builder — this module (zod, server-
// oriented) is not re-exported from there on purpose: a caller that only
// needs the kind/width constants (the route, tests, any client component)
// imports lib/assetPath.ts directly instead of pulling in zod for no reason.

export const assetKindSchema = z.enum(ASSET_KINDS);

export const assetIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

function isAllowedWidth(value: number): value is (typeof ALLOWED_WIDTHS)[number] {
  return ALLOWED_WIDTHS.some((allowed) => allowed === value);
}

export const assetQuerySchema = z.object({
  // The rasterised page of a réserve plan (a PDF uploaded as an IMAGE
  // resource — see lib/cloudinary.ts::uploadReservePlan). A real chantier
  // plan never runs to more than a handful of pages; twenty is comfortably
  // above any of them while still keeping the value a bounded integer rather
  // than an arbitrary one handed straight to Cloudinary (each distinct page
  // is its own billed, cached derivative).
  page: z.coerce.number().int().min(1).max(20).optional(),
  width: z.coerce.number().int().refine(isAllowedWidth, "width must be one of the allowed values").optional(),
});
export type AssetQuery = z.infer<typeof assetQuerySchema>;

/** Which project-detail section governs each asset kind — the second access
 * axis (see docs/CONVENTIONS.md), checked before the row is even resolved. */
export const SECTION_BY_KIND: Record<AssetKind, ProjectSectionKey> = {
  "project-files": "files",
  "reserve-plans": "reserves",
  "reserve-photos": "reserves",
};

/**
 * `inline` for what a page embeds directly (a réserve plan or photo,
 * rendered as an `<img>`); `attachment` for a project document, which the
 * Files module only ever links as a download. Fixed per kind, not
 * caller-chosen: letting the caller pick would let a project FILE — an
 * open-ended upload type (PDFs, office docs, arbitrary binaries) — be
 * requested "inline" and rendered by the browser, which is exactly the
 * asset class the upload guard is strictest about (see
 * lib/cloudinary.ts's BLOCKED_UPLOAD_* sets).
 */
export const DISPOSITION_BY_KIND: Record<AssetKind, "inline" | "attachment"> = {
  "project-files": "attachment",
  "reserve-plans": "inline",
  "reserve-photos": "inline",
};

/**
 * Compose the Cloudinary transformation for a request, from the resolved
 * asset (never the caller — only its resourceType matters here) and the
 * already-validated query.
 *
 * A réserve plan is a PDF stored under resourceType IMAGE purely so
 * Cloudinary can rasterise it — delivering it therefore ALWAYS forces a page
 * plus a concrete image format, or the response would be the original PDF
 * bytes rather than a displayable page. `width` composes on top of that for
 * any IMAGE asset (plan or photo) when the caller asked for one; it's a
 * no-op for a RAW/VIDEO project file, which a width transform doesn't apply to.
 */
export function buildAssetTransformation(
  kind: AssetKind,
  asset: Pick<DeliveryAsset, "resourceType">,
  query: AssetQuery
): DeliveryTransformation | undefined {
  const transform: DeliveryTransformation = {};

  if (kind === "reserve-plans") {
    transform.page = query.page ?? 1;
    transform.format = "jpg";
  }

  if (asset.resourceType === "IMAGE" && query.width !== undefined) {
    transform.width = query.width;
    transform.crop = "limit"; // never upscale, or crop past the source
    transform.quality = "auto";
  }

  return Object.keys(transform).length > 0 ? transform : undefined;
}

const MIME_BY_FORMAT: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
};

/**
 * Best-effort MIME from a stored Cloudinary format string ("jpg", "pdf",
 * ...) — used where there's no separate mimeType column (ReservePlan has
 * one but it's never the delivered type since a plan is always re-rasterised
 * to jpg; ReservePhoto has none at all — see its schema doc) or as a
 * fallback for ProjectFile, whose own mimeType is otherwise authoritative.
 * An unknown/absent format falls back to a generic binary type rather than
 * guessing.
 */
export function mimeFromFormat(format: string | null | undefined): string | null {
  if (!format) return null;
  return MIME_BY_FORMAT[format.toLowerCase()] ?? null;
}

/** Characters that could break out of the header value entirely: CR/LF
 * (header injection / response splitting), a bare quote (ends the
 * quoted-string early), path separators (no legitimate reason a download
 * name needs one). The stored name is the original upload filename —
 * attacker-supplied, exactly like the project name sanitized for the
 * réserves report (see lib/reservesReportData.ts::slugify's callers). */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "fichier";
}

/**
 * `inline`, or an `attachment` Content-Disposition carrying a sanitized
 * filename — both the ASCII fallback (`filename=`) and the UTF-8 form
 * (`filename*=`, RFC 5987), so an accented original name survives instead of
 * falling back to a mangled ASCII-only name in browsers that support it.
 */
export function contentDispositionHeader(
  disposition: "inline" | "attachment",
  filename: string | null
): string {
  if (disposition === "inline" || !filename) return disposition;
  const safe = sanitizeFilename(filename);
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
