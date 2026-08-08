// Server-only Cloudinary delivery helpers: mapping between the enums this
// app persists (CloudinaryDeliveryType / CloudinaryResourceType — see
// prisma/schema.prisma) and the string parameters Cloudinary's own SDK
// expects, plus the URL builder that rebuilds a delivery URL from what's
// stored (publicId + resourceType + format + version + deliveryType) instead
// of replaying the deprecated `url` column. Imports the Cloudinary SDK —
// never bundle this for the browser. Distinct from lib/cloudinary-url.ts,
// which is pure and safe to import from client components.
import { v2 as cloudinary } from "cloudinary";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";

// Idempotent and cheap — set here too so this module works even when
// imported on its own (e.g. by the delivery route, once it exists) without
// lib/cloudinary.ts having run first. The SDK reads credentials from the
// CLOUDINARY_URL env var at call time.
cloudinary.config({ secure: true });

/** Our stored enum -> the `type` URL segment Cloudinary's SDK expects. A
 * straight API parameter, not a flag the application interprets itself. */
export function toCloudinaryType(deliveryType: CloudinaryDeliveryType): "upload" | "authenticated" {
  return deliveryType === "AUTHENTICATED" ? "authenticated" : "upload";
}

/** The inverse: the delivery type Cloudinary actually used for an upload, as
 * echoed back in its response `type` field — never guessed from what the
 * caller requested. */
export function fromCloudinaryType(type: string): CloudinaryDeliveryType {
  if (type === "authenticated") return "AUTHENTICATED";
  if (type === "upload") return "UPLOAD";
  throw { type: "error", message: "Unexpected Cloudinary delivery type in upload response." };
}

/** Our stored enum -> the `resource_type` Cloudinary's SDK expects. */
export function toCloudinaryResourceType(resourceType: CloudinaryResourceType): "image" | "video" | "raw" {
  switch (resourceType) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "RAW":
      return "raw";
  }
}

/** The inverse, for reading Cloudinary's own `resource_type` off an upload
 * response. NOT a function of mime type — a réserve plan is a PDF
 * deliberately uploaded as "image" so its pages can be rasterised — so this
 * must always come from what Cloudinary actually did, never re-derived. */
export function fromCloudinaryResourceType(resourceType: string): CloudinaryResourceType {
  if (resourceType === "video") return "VIDEO";
  if (resourceType === "raw") return "RAW";
  if (resourceType === "image") return "IMAGE";
  throw { type: "error", message: "Unexpected Cloudinary resource type in upload response." };
}

/** The four columns every guarded asset (ProjectFile / ReservePlan /
 * ReservePhoto) persists — enough to rebuild its delivery URL without ever
 * reading the deprecated `url` column. */
export type DeliveryAsset = {
  publicId: string;
  resourceType: CloudinaryResourceType;
  /** The SOURCE asset's extension, without the dot. NULL on a RAW row: its
   * publicId already carries the extension (Cloudinary strips it out of
   * image/video public ids, not raw ones) — appending it again here would
   * build "devis.pdf.pdf". */
  format: string | null;
  /** The "/v<version>/" segment, or null to omit it entirely. Omitting it is
   * safe: Cloudinary's URL signature does not cover the version segment. */
  version: string | null;
  deliveryType: CloudinaryDeliveryType;
};

/**
 * A transformation to compose into the delivered asset. `format`, when
 * given, overrides `asset.format` for what's actually DELIVERED — e.g.
 * `{ page: 1, format: "jpg" }` on a réserve plan (stored format "pdf")
 * rasterises page 1 as a JPG. The stored format always describes the source
 * asset; a transformation decides what a given delivery returns.
 */
export type DeliveryTransformation = {
  page?: number;
  width?: number;
  height?: number;
  crop?: "limit" | "fill" | "fit" | "scale" | "thumb";
  gravity?: string;
  quality?: "auto" | number;
  format?: string;
};

/**
 * Rebuild a delivery URL for a stored asset. Signs it when the asset has
 * been re-typed to `authenticated`; produces a plain, working (unsigned) URL
 * for the legacy `upload` state — both coexist in the database between this
 * deploy and the one-shot re-typing script that flips existing rows over.
 *
 * The transformation is passed into the SAME `cloudinary.url()` call that
 * signs the request, rather than appended afterwards: Cloudinary's signature
 * covers the transformation string, so this is what makes composing it
 * "part of" the signature rather than a separate step tacked on after.
 */
export function buildDeliveryUrl(asset: DeliveryAsset, transformation?: DeliveryTransformation): string {
  const { format: formatOverride, ...transformOptions } = transformation ?? {};
  const hasTransform = Object.values(transformOptions).some((value) => value !== undefined);

  return cloudinary.url(asset.publicId, {
    resource_type: toCloudinaryResourceType(asset.resourceType),
    type: toCloudinaryType(asset.deliveryType),
    // The delivered format: an explicit override (e.g. rasterising a plan
    // page to jpg) wins, otherwise fall back to the source asset's own
    // format — which is already null on a RAW row, so nothing gets appended.
    format: formatOverride ?? asset.format ?? undefined,
    version: asset.version ?? undefined,
    // Never let the SDK fabricate a "v1" we never actually stored — a null
    // version means "omit the segment", not "version 1".
    force_version: false,
    sign_url: asset.deliveryType === "AUTHENTICATED",
    secure: true,
    // The SDK appends a "?_a=..." client-usage-tracking query param by
    // default; irrelevant (and unwanted noise on a signed URL) for a link
    // built server-side, so it's turned off explicitly rather than left to
    // whatever the ambient config happens to default to.
    analytics: false,
    transformation: hasTransform ? [transformOptions] : undefined,
  });
}
