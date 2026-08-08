// Pure, client-safe support for the guarded asset delivery route
// (app/api/assets/[kind]/[id]/route.ts): the asset kinds/widths it accepts,
// and the single path builder every component that points at a project
// file, réserve plan or réserve photo goes through. No component may
// concatenate its own "/api/assets/..." string: this is the one place that
// does it, and the one place that can guarantee a width is never anything
// other than an ALLOWED_WIDTHS member — the type enforces it, not the
// caller's care.
//
// No imports here on purpose: this file must stay safe to bundle into a
// 'use client' component — same split as lib/cloudinary-url.ts (pure) vs
// lib/cloudinaryDelivery.ts (pulls in the Cloudinary SDK, server-only).
// lib/assetDelivery.ts (zod validation, server-oriented) imports the
// kinds/widths from here rather than the other way around, for the same
// reason.

export const ASSET_KINDS = ["project-files", "reserve-plans", "reserve-photos"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/**
 * A fixed whitelist, not a free integer. Cloudinary bills (and caches) every
 * distinct transformation separately — an open `?width=` would turn the
 * delivery route into a public image-resizing proxy, letting anyone run up
 * the Cloudinary bill just by varying the width endlessly.
 *
 * Exactly the two widths this app's components actually request: 128 (the
 * réserve photo thumbnail, ReservesSection.tsx) and 1600 (the réserve plan
 * viewer, same file). Widen this list only when a component genuinely needs
 * a third size — not speculatively, since every member is a standing,
 * separately-billed Cloudinary derivative.
 */
export const ALLOWED_WIDTHS = [128, 1600] as const;
export type AllowedWidth = (typeof ALLOWED_WIDTHS)[number];

export type AssetPathOptions = {
  /** Rasterised page of a réserve plan (reserve-plans only) — server defaults to 1 when omitted. */
  page?: number;
  /** Must be one of ALLOWED_WIDTHS above — the type enforces it. */
  width?: AllowedWidth;
};

/**
 * Build the guarded delivery path for a project file, réserve plan or réserve
 * photo: `/api/assets/<kind>/<id>[?page=&width=]`. Never a raw Cloudinary
 * URL — every one of these three kinds is delivered through the guarded
 * route, which re-checks access and signs the asset server-side on every
 * request (see app/api/assets/[kind]/[id]/route.ts).
 */
export function assetPath(kind: AssetKind, id: number, options: AssetPathOptions = {}): string {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.width !== undefined) params.set("width", String(options.width));
  const qs = params.toString();
  return `/api/assets/${kind}/${id}${qs ? `?${qs}` : ""}`;
}
