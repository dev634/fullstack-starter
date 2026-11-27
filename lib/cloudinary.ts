import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import { publicIdFromUrl } from "./cloudinary-url";
import {
  toCloudinaryType,
  toCloudinaryResourceType,
  fromCloudinaryType,
  fromCloudinaryResourceType,
} from "./cloudinaryDelivery";
import {
  detectRasterImageMediaType,
  looksLikeDangerousMarkup,
  looksLikePdf,
} from "@/lib/fileSignature";
import {
  convertToStrippedJpeg,
  isImageRefusal,
  mebibytes,
  isStrippableMediaType,
  stripArchivedPhotoMetadata,
  type StorageImageLimits,
} from "@/lib/imageMetadata";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

// Re-export the pure URL helpers so existing server imports keep working.
export { publicIdFromUrl, optimizedClientPhoto } from "./cloudinary-url";

// The SDK reads credentials from the CLOUDINARY_URL env var
// (cloudinary://<api_key>:<api_secret>@<cloud_name>). We only force
// HTTPS URLs here.
cloudinary.config({ secure: true });

// --- What the storage accepts ----------------------------------------------
//
// Read from Cloudinary's administration API, from the production container, on
// 2026-11-27: plan "Free", image_max_size_bytes = 10485760, raw_max_size_bytes =
// 10485760, image_max_px = 25000000. ONE source for each ceiling: the output of a
// decode that goes to storage (company photo, equipment photo, bulletin archive) is
// handled BEFORE it is sent: an output beyond the file ceiling is refused with a message that says so
// (instead of a generic upload failure from the provider), and an image beyond the pixel ceiling is
// REDUCED to fit it, proportions kept, never refused — a consequence of the storage plan, which cannot
// keep such an image as it is anyway (an A4 scanned at 600 dpi is 34.8 Mpx), and 25 Mpx stays very legible. They are NOT the input
// ceilings the application announces (project files 20 MB, reserve plans 25 MB, photos
// 10 MB): those are a product decision, still open (docs/SECURITE-CHECKLIST.md).
export const STORAGE_MAX_FILE_BYTES = 10_485_760;
export const STORAGE_MAX_IMAGE_PIXELS = 25_000_000;

/**
 * The warning of a delivery note whose archive the storage cannot take (its cleaned image is still beyond
 * STORAGE_MAX_FILE_BYTES after the reduction to the pixel ceiling): the stock is applied, the archive is
 * not. Built here, from the one constant, so the action returns dictionary text (and no number it took
 * from somewhere else).
 */
export function archiveTooLargeMessage(t: Dictionary): string {
  return format(t.materials.scan.messages.appliedArchiveTooLarge, { max: mebibytes(STORAGE_MAX_FILE_BYTES) });
}

/** What every decode that goes to storage passes to lib/imageMetadata.ts. */
export const STORAGE_IMAGE_LIMITS: StorageImageLimits = {
  maxOutputBytes: STORAGE_MAX_FILE_BYTES,
  fitInPixels: STORAGE_MAX_IMAGE_PIXELS,
};

// --- Guarded delivery --------------------------------------------------
//
// Enough of a stored row's guarded-delivery columns to call Cloudinary's
// destroy with the correct `type` + `resource_type`. `destroy` defaults
// `type` to "upload" and SILENTLY NO-OPS (no error) when it doesn't match
// the asset's real type — so these must always be read from the database,
// never re-derived from a mime type. See prisma/schema.prisma's comment on
// ProjectFile.resourceType for the same rule applied to persistence.
export type GuardedAssetRef = {
  publicId: string;
  deliveryType: CloudinaryDeliveryType;
  resourceType: CloudinaryResourceType;
};

/**
 * The four columns every guarded asset persists, read off a Cloudinary
 * upload response — never guessed. See fromCloudinaryResourceType's doc
 * (lib/cloudinaryDelivery.ts) for why resourceType can't be re-derived, and
 * the inline comment below for why format must be forced to NULL on a RAW
 * row even though Cloudinary's response does return one.
 */
type GuardedUploadFields = GuardedAssetRef & {
  format: string | null;
  version: string | null;
};

function guardedFieldsFromUploadResult(result: UploadApiResponse): GuardedUploadFields {
  const resourceType = fromCloudinaryResourceType(result.resource_type);
  return {
    publicId: result.public_id,
    resourceType,
    // NULL on a RAW row on purpose: its publicId already carries the
    // extension (Cloudinary strips it out of image/video public ids, not raw
    // ones), so storing it again here would build "devis.pdf.pdf" once
    // recomposed for delivery (see lib/cloudinaryDelivery.ts::buildDeliveryUrl).
    format: resourceType === "RAW" ? null : result.format || null,
    version: result.version != null ? String(result.version) : null,
    deliveryType: fromCloudinaryType(result.type),
  };
}

/**
 * The three columns `destroy` needs, read off the upload response — what a
 * compensation (lib/uploadCompensation.ts) destroys an asset by. Throws on an
 * unexpected resource/delivery type, like guardedFieldsFromUploadResult.
 */
function assetRefFromUploadResult(result: UploadApiResponse): GuardedAssetRef {
  const { publicId, deliveryType, resourceType } = guardedFieldsFromUploadResult(result);
  return { publicId, deliveryType, resourceType };
}

/**
 * The ONE place a buffer is sent to Cloudinary (it used to be written out six
 * times). Every failure leaves here as the application's own refusal shape,
 * `{ type: "error", message, i18n: "uploadFailed" }`, never as a raw Error:
 *
 *  - upload_stream signs the request SYNCHRONOUSLY, so a missing credential
 *    ("Must supply api_key", "Must supply cloud_name…") throws inside the
 *    Promise executor and would reject with the SDK's native Error — whose
 *    `.message` then reached the user. It is caught here, logged with its
 *    cause, and refused as uploadFailed.
 *  - A network error or a non-2xx response arrives in the callback. Its `message` and
 *    `http_code` are logged (a wrong key or secret is diagnosed from them: the user only
 *    ever sees uploadFailed).
 *  - `toResult` may THROW on an unexpected resource/delivery type (see
 *    fromCloudinaryResourceType/fromCloudinaryType). It runs inside a callback
 *    the SDK invokes later, outside the executor's call stack, so a raw throw
 *    would NOT reject this promise: it would become an uncaughtException that
 *    kills the Node process and leaves the awaiting Server Action hung forever.
 *    It is caught here for the same reason. When a `public_id` can still be read off
 *    that response, the asset IS at Cloudinary (and, for the public ones, reachable):
 *    it is destroyed before the refusal, by the `type` and `resource_type` the response
 *    itself reported — the very values that were not understood, so the destroy is
 *    attempted with them as they came.
 *
 * `failureMessage` is the English fallback of the `uploadFailed` refusal, the
 * only thing that differs between the callers.
 */
function uploadBuffer<T>(
  buffer: Buffer,
  options: UploadApiOptions,
  failureMessage: string,
  toResult: (result: UploadApiResponse) => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const refuse = () => reject({ type: "error", message: failureMessage, i18n: "uploadFailed" });
    try {
      cloudinary.uploader
        .upload_stream(options, (error, result) => {
          if (error || !result) {
            console.error("Cloudinary upload failed:", {
              message: error?.message ?? "no error and no result",
              http_code: error?.http_code,
            });
            refuse();
            return;
          }
          try {
            resolve(toResult(result));
          } catch (cause) {
            console.error("Cloudinary upload response not understood:", cause);
            void destroyUnderstoodNothing(result).finally(refuse);
          }
        })
        .end(buffer);
    } catch (cause) {
      console.error("Cloudinary upload refused before sending:", cause);
      refuse();
    }
  });
}

/**
 * The ONE place `destroy` is called and its report read (the logo, the company photo,
 * the equipment photo and every guarded asset used to read it four different ways, the
 * logo not at all). Never throws. An operation that doesn't throw hasn't necessarily
 * acted (a mismatched `type` makes it no-op in silence — see GuardedAssetRef's doc), so
 * anything other than "ok" is logged WITH the public id. "not found" is the expected
 * answer for an asset that is already gone, and is logged only when `justUploaded`:
 * an asset this process has just sent cannot be absent, so "not found" there means the
 * deletion is NOT confirmed (a wrong `type`, a propagation delay).
 */
async function destroyAndReport(
  label: string,
  publicId: string,
  options: { type?: string; resource_type?: string },
  justUploaded: boolean
): Promise<void> {
  try {
    const response: { result?: string } = await cloudinary.uploader.destroy(publicId, options);
    if (response.result === "ok") return;
    if (response.result === "not found" && !justUploaded) return;
    console.error(
      justUploaded && response.result === "not found"
        ? `Cloudinary destroy of the ${label} "${publicId}" we just uploaded answered "not found": deletion NOT confirmed`
        : `Cloudinary destroy of the ${label} "${publicId}" did not confirm deletion: "${response.result}"`
    );
  } catch (error) {
    console.error(`Cloudinary destroy failed for the ${label} "${publicId}":`, error);
  }
}

async function destroyGuardedAsset(
  publicId: string,
  deliveryType: CloudinaryDeliveryType,
  resourceType: CloudinaryResourceType,
  justUploaded: boolean
): Promise<void> {
  await destroyAndReport(
    "asset",
    publicId,
    { type: toCloudinaryType(deliveryType), resource_type: toCloudinaryResourceType(resourceType) },
    justUploaded
  );
}

/**
 * The upload response was not understood (an unexpected `type` or `resource_type`) but
 * a `public_id` is readable: the asset exists. Destroys it by what the response said,
 * as it said it. Never throws.
 */
async function destroyUnderstoodNothing(result: UploadApiResponse): Promise<void> {
  const publicId: unknown = result.public_id;
  if (typeof publicId !== "string" || publicId === "") return;
  const type: unknown = result.type;
  const resourceType: unknown = result.resource_type;
  await destroyAndReport(
    "asset of an upload response that was not understood",
    publicId,
    {
      ...(typeof type === "string" ? { type } : {}),
      ...(typeof resourceType === "string" ? { resource_type: resourceType } : {}),
    },
    true
  );
}

/**
 * Best-effort destruction of an asset this process has just uploaded, by the
 * `type` + `resource_type` the upload response reported (lib/uploadCompensation.ts).
 * Never throws.
 */
export async function destroyUploadedAsset(asset: GuardedAssetRef): Promise<void> {
  await destroyGuardedAsset(asset.publicId, asset.deliveryType, asset.resourceType, true);
}

/**
 * Confirms `buffer` really is one of the eight raster image formats this app
 * recognizes (RasterImageMediaType) — sniffed from its magic bytes (lib/fileSignature.ts), never the
 * client-declared `file.type`, which a request can set to anything. Used by
 * the paths that only need a yes/no on "is this a photo" (the branding logo,
 * réserve photos, and uploadProjectFile's image check below): unlike
 * uploadProjectFile (an open-ended set of document types, which can't enforce
 * a full allowlist), these can and do — an SVG or an HTML file renamed to
 * "photo.png" and declared "image/png" has no binary magic number for any of
 * the four and is rejected here regardless of its label. The company photo
 * and the equipment photo no longer use it: they need the detected FORMAT
 * (to clean the metadata), so they call detectRasterImageMediaType directly.
 */
function isRealImage(buffer: Buffer): boolean {
  return detectRasterImageMediaType(buffer) !== null;
}

/**
 * What a refusal of lib/imageMetadata.ts's decode becomes at an upload boundary: the
 * application's own error shape with a stable `i18n` code (getErrorMessage translates
 * it). Nothing is ever sent to Cloudinary after one, the original included. A queue that
 * is full, an account already processing an image or out of decode time, a decoder that
 * is down, an output beyond the storage ceiling each say so, instead
 * of calling the photo "not an image"; only a decode that failed does.
 */
function uploadErrorFromDecode(error: unknown) {
  // A decode that failed in any other way (not one of the module's own refusals): never a fallback
  // to the original, which would quietly undo the stripping.
  if (!isImageRefusal(error)) return { type: "error", message: "The photo must be an image file.", i18n: "uploadNotImage" };
  switch (error.code) {
    case "imageBusy":
      return {
        type: "error",
        message: "The server is already processing images. Try again in a moment.",
        i18n: "uploadBusy",
      };
    case "imageInProgress":
      return {
        type: "error",
        message: "One of your images is already being processed. Try again in a moment.",
        i18n: "imageInProgress",
      };
    case "imageQuota":
      return {
        type: "error",
        message: "Too many images processed for now. Try again later.",
        i18n: "imageQuota",
        i18nParams: { minutes: error.minutes },
      };
    case "imageUnavailable":
      return {
        type: "error",
        message: "Image processing is temporarily unavailable. Try again in a few minutes.",
        i18n: "imageUnavailable",
      };
    case "imageTooHeavy":
      return {
        type: "error",
        message: "This image is too heavy to process. Try a lighter version.",
        i18n: "imageTooHeavy",
      };
    case "outputTooLarge":
      return {
        type: "error",
        message: "Image too large after processing.",
        i18n: "imageOutputTooLarge",
        i18nParams: { max: mebibytes(error.maxBytes) },
      };
    case "corruptedImage":
      return { type: "error", message: "The photo must be an image file.", i18n: "uploadNotImage" };
    default:
      return error satisfies never;
  }
}

export const MAX_CLIENT_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Upload a client photo to Cloudinary and return its secure URL. Validates
 * the size first (cheap, no need to buffer an oversized file just to reject
 * it), then that the CONTENT is really an image — sniffed from its bytes,
 * never the client-declared `file.type` (detectRasterImageMediaType; the
 * detected format also decides how the metadata is cleaned, below). This asset is served from a
 * PUBLIC Cloudinary URL on purpose (unlike project files/plans/photos,
 * guarded — see app/api/assets), so an unvalidated upload here would be
 * directly reachable.
 */
export async function uploadClientPhoto(file: File, owner: string): Promise<string> {
  if (file.size > MAX_CLIENT_PHOTO_BYTES) {
    throw {
      type: "error",
      message: "The photo must be 5 MB or smaller.",
      i18n: "uploadTooLarge",
      i18nParams: { max: MAX_CLIENT_PHOTO_BYTES / (1024 * 1024) },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = detectRasterImageMediaType(buffer);

  if (!mediaType) {
    throw {
      type: "error",
      message: "The photo must be an image file.",
      i18n: "uploadNotImage",
    };
  }

  // The photo is served from a PUBLIC URL and a phone photo routinely carries
  // GPS coordinates in its EXIF. The buffer that leaves is a cleaned one —
  // orientation applied to the pixels first, metadata dropped after — for:
  //  - JPEG, PNG, WebP, GIF: re-encoded in their own format
  //    (stripArchivedPhotoMetadata). An animated GIF/WebP keeps only its first
  //    frame: acceptable for an avatar.
  //  - AVIF and TIFF: sharp decodes both, so they leave as a cleaned JPEG
  //    (convertToStrippedJpeg).
  // Both go through one queue, one decode at a time (lib/imageMetadata.ts).
  //
  // OPEN POINT — HEIC and BMP are still accepted but sent UNMODIFIED.
  //  - HEIC (the iPhone default; refusing it would turn away the most common
  //    legitimate upload): sharp cannot decode it (no HEVC), and its
  //    orientation lives in the container (see isStrippableMediaType's use in
  //    uploadEquipmentPhoto's doc below, which records the live probes). Its
  //    GPS stays readable on the public URL unless Cloudinary removes it on its
  //    side — NOT proven, do not assume it does. Closing it needs a real iPhone
  //    HEIC dropped on a test Cloudinary account, then exiftool on the
  //    secure_url, or a product decision to refuse the format.
  //  - BMP: the format has no EXIF/GPS block (a file header, a DIB header and
  //    pixels), so there is nothing to strip; sharp's build here does not read
  //    it either.
  let outgoing: Buffer = buffer;
  if (isStrippableMediaType(mediaType) || mediaType === "image/avif" || mediaType === "image/tiff") {
    try {
      outgoing = isStrippableMediaType(mediaType)
        ? await stripArchivedPhotoMetadata(owner, buffer, mediaType, STORAGE_IMAGE_LIMITS)
        : await convertToStrippedJpeg(owner, buffer, STORAGE_IMAGE_LIMITS);
    } catch (error) {
      // Every refusal of the decode says what it is (see uploadErrorFromDecode); never a
      // fallback to the original.
      throw uploadErrorFromDecode(error);
    }
  }

  return uploadBuffer(
    outgoing,
    { folder: "clients", resource_type: "image" },
    "Failed to upload the photo. Please try again.",
    (result) => result.secure_url
  );
}

/**
 * Best-effort deletion of a previously uploaded photo. Never throws so it
 * can't break the surrounding mutation if the asset is already gone — but it
 * reads `destroy`'s own report (`{ result: "ok" | "not found" | ... }`) and
 * logs anything else: an operation that doesn't throw hasn't necessarily
 * acted. An unparseable URL (no public id) is logged too, since nothing was
 * destroyed.
 */
export async function destroyClientPhoto(
  url: string | null | undefined,
  /** "previous": a photo that was replaced or removed; "justUploaded": the compensation of one this call sent. */
  which: "previous" | "justUploaded"
): Promise<void> {
  if (!url) return;
  const publicId = publicIdFromUrl(url);
  if (!publicId) {
    console.error(`Cloudinary destroy skipped: no public id in client photo url "${url}"`);
    return;
  }
  await destroyAndReport("client photo", publicId, {}, which === "justUploaded");
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Upload the app-wide branding logo to Cloudinary. Returns publicId
 * alongside the URL so the previous logo can be cleanly destroyed on
 * replacement (see destroyLogo). This asset is served from a PUBLIC
 * Cloudinary URL (unlike project files/plans/photos, guarded — see
 * app/api/assets), so an unvalidated upload here would be directly
 * reachable — content, not just label, must be a real image (isRealImage
 * above).
 */
export async function uploadLogo(file: File): Promise<{ url: string } & GuardedAssetRef> {
  if (file.size > MAX_LOGO_BYTES) {
    throw {
      type: "error",
      message: "The logo must be 2 MB or smaller.",
      i18n: "uploadTooLarge",
      i18nParams: { max: MAX_LOGO_BYTES / (1024 * 1024) },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!isRealImage(buffer)) {
    throw {
      type: "error",
      message: "The logo must be an image file.",
      i18n: "uploadNotImage",
    };
  }

  return uploadBuffer(
    buffer,
    { folder: "app-settings", resource_type: "image" },
    "Failed to upload the logo. Please try again.",
    (result) => ({ url: result.secure_url, ...assetRefFromUploadResult(result) })
  );
}

/**
 * Best-effort deletion of the previous logo. Never throws so it can't break
 * the surrounding mutation if the asset is already gone.
 */
export async function destroyLogo(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  await destroyAndReport("logo", publicId, { resource_type: "image" }, false);
}

export const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

// Active content that executes script when opened directly from the
// Cloudinary URL (stored-XSS / content-spoofing). We don't tightly
// allowlist — project docs are an open-ended set (PDFs, photos, CAD,
// office files) — but these few types are never legitimate here and are
// the actual danger. Checked by BOTH declared MIME and file extension,
// since a crafted request can set file.type to anything.
const BLOCKED_UPLOAD_MIME_TYPES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
]);
const BLOCKED_UPLOAD_EXTENSIONS = new Set(["svg", "html", "htm", "xhtml", "xml", "js", "mjs", "svgz"]);

function isBlockedUpload(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BLOCKED_UPLOAD_MIME_TYPES.has(file.type) || BLOCKED_UPLOAD_EXTENSIONS.has(ext);
}

/**
 * Cloudinary stores non-image/video uploads (PDFs, docs, ...) under the
 * "raw" resource type. Used ONLY to pick the resource_type an upload
 * REQUESTS. The resource_type actually used — everywhere else, including any
 * `destroy` call — must come from what Cloudinary returned (see
 * fromCloudinaryResourceType), never re-derived from a mime type.
 */
export function resourceTypeFromMime(mimeType: string | null | undefined): "image" | "video" | "raw" {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return "raw";
}

/**
 * Upload an arbitrary project document (image, PDF, plan, ...) to
 * Cloudinary under a per-project folder, `type: "authenticated"` so it's
 * only reachable through a signed delivery URL. The guarded fields
 * (resourceType, format, version, deliveryType) are all read off Cloudinary's
 * response, never guessed — see guardedFieldsFromUploadResult.
 *
 * Unlike uploadClientPhoto/uploadLogo/uploadReservePhoto above, this path
 * deliberately accepts an open-ended set of document types (PDFs, CAD,
 * office files, photos, ...) — a full raster-image allowlist isn't an
 * option. The compromise kept: BOTH declared label (isBlockedUpload, name +
 * mime — spoofable, kept as a first cheap pass) AND, once the bytes are in
 * hand, two content-based checks that don't require knowing every legitimate
 * format up front — (1) a file declared as an image must actually BE one of
 * the four raster formats this app recognizes (isRealImage — closes the
 * "evil.svg renamed to devis.png, declared image/png" gap the label-only
 * check above can't), and (2) regardless of what the file claims to be, its
 * content must not look like the exact active-content shapes
 * BLOCKED_UPLOAD_MIME_TYPES/EXTENSIONS deny by label (SVG/HTML/XML —
 * looksLikeDangerousMarkup, lib/fileSignature.ts), closing the same gap for
 * those. A PDF, DOCX, DWG, ... whose content isn't independently verified
 * here still reaches Cloudinary unread past these two checks — verifying
 * every open-ended document format's content would need one parser per
 * format, disproportionate to the actual danger (arbitrary binary docs don't
 * execute when opened directly the way SVG/HTML do).
 */
export async function uploadProjectFile(
  file: File,
  projectId: number
): Promise<
  { url: string; size: number; mimeType: string } & GuardedUploadFields
> {
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    throw {
      type: "error",
      message: "The file must be 20 MB or smaller.",
      i18n: "uploadTooLarge",
      i18nParams: { max: MAX_PROJECT_FILE_BYTES / (1024 * 1024) },
    };
  }

  if (isBlockedUpload(file)) {
    throw {
      type: "error",
      message: "This file type isn't allowed.",
      i18n: "uploadTypeNotAllowed",
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (looksLikeDangerousMarkup(buffer)) {
    throw {
      type: "error",
      message: "This file type isn't allowed.",
      i18n: "uploadTypeNotAllowed",
    };
  }

  if (file.type.startsWith("image/") && !isRealImage(buffer)) {
    throw {
      type: "error",
      message: "This file type isn't allowed.",
      i18n: "uploadTypeNotAllowed",
    };
  }

  const resourceType = resourceTypeFromMime(file.type);

  return uploadBuffer(
    buffer,
    {
      folder: `projects/${projectId}`,
      resource_type: resourceType,
      type: "authenticated",
      use_filename: true,
      unique_filename: true,
    },
    "Failed to upload the file. Please try again.",
    (result) => ({
      // DEPRECATED — the legacy public secure_url. Still written (the
      // column stays NOT NULL for one release), never read back.
      url: result.secure_url,
      size: result.bytes,
      mimeType: file.type || "application/octet-stream",
      ...guardedFieldsFromUploadResult(result),
    })
  );
}

/**
 * Best-effort deletion of a previously uploaded project file. Never throws
 * so it can't break the surrounding mutation if the asset is already gone.
 *
 * Always takes the guarded form — publicId plus the stored deliveryType +
 * resourceType — so the correct `type` reaches `destroy`. There used to be a
 * second, legacy overload taking just a mime type, reached by the bulk-purge
 * paths (deleting a client, a project, or a folder). It has been removed on
 * purpose, not left "for now": `destroy` defaults `type` to "upload" and
 * SILENTLY NO-OPS on a mismatch (see GuardedAssetRef's doc), so that branch
 * would have quietly stopped deleting anything the day a row gets re-typed to
 * "authenticated" by the one-shot script — a retention bug with no error to
 * notice it by. Deleting the overload turns "a caller forgot to pass the
 * guarded columns" into a compile error instead of a silent no-op in
 * production.
 */
export async function destroyProjectFile(
  publicId: string,
  asset: Pick<GuardedAssetRef, "deliveryType" | "resourceType">
): Promise<void> {
  await destroyGuardedAsset(publicId, asset.deliveryType, asset.resourceType, false);
}

export const MAX_RESERVE_PLAN_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a reserve plan (a PDF) to Cloudinary as an *image* resource — unlike
 * generic project files (stored raw), this lets Cloudinary rasterise the PDF
 * so its pages can be delivered as images to pin réserves on (see
 * lib/cloudinaryDelivery.ts::buildDeliveryUrl). `type: "authenticated"` so
 * the plan is only reachable through a signed delivery URL. The guarded
 * fields are all read off Cloudinary's response, never guessed.
 *
 * Adversarial pass, lot C1, #3: this was the FIFTH upload path, and the only
 * one that never read a single byte — `isPdf` below checked only the
 * client-declared `file.type` and the filename's `.pdf` extension, both
 * trivially spoofable. An HTML or SVG file renamed to "plan.pdf" passed this
 * check and reached Cloudinary — uploaded as `resource_type: "image"`, same
 * as every other guarded image asset here, so it would have been served back
 * through the exact same signed delivery path a real plan is. Content, not
 * just label, must look like a real PDF now (looksLikePdf,
 * lib/fileSignature.ts) — same technique as isRealImage above, applied to a
 * format that isn't a raster image so it can't reuse that check.
 */
export async function uploadReservePlan(
  file: File,
  projectId: number
): Promise<{ url: string } & GuardedUploadFields> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw { type: "error", message: "The plan must be a PDF file.", i18n: "uploadNotPdf" };
  }
  if (file.size > MAX_RESERVE_PLAN_BYTES) {
    throw {
      type: "error",
      message: "The plan must be 25 MB or smaller.",
      i18n: "uploadTooLarge",
      i18nParams: { max: MAX_RESERVE_PLAN_BYTES / (1024 * 1024) },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!looksLikePdf(buffer)) {
    throw { type: "error", message: "The plan must be a PDF file.", i18n: "uploadNotPdf" };
  }

  return uploadBuffer(
    buffer,
    {
      folder: `projects/${projectId}/reserve-plans`,
      resource_type: "image",
      type: "authenticated",
      use_filename: true,
      unique_filename: true,
    },
    "Failed to upload the plan. Please try again.",
    (result) => ({
      // DEPRECATED — still written (see ReservePlan.url's doc in
      // prisma/schema.prisma), never read back.
      url: result.secure_url,
      ...guardedFieldsFromUploadResult(result),
    })
  );
}

/**
 * Best-effort deletion of a reserve plan. Takes the stored publicId +
 * deliveryType + resourceType (not just a bare publicId) so the correct
 * `type` reaches `destroy` — passing the wrong one silently no-ops on an
 * `authenticated` asset instead of erroring (see GuardedAssetRef's doc).
 * Never throws itself.
 */
export async function destroyReservePlan(plan: GuardedAssetRef | null | undefined): Promise<void> {
  if (!plan) return;
  await destroyGuardedAsset(plan.publicId, plan.deliveryType, plan.resourceType, false);
}

export const MAX_RESERVE_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload a photo attached to a réserve (must be an image, under the limit).
 * `type: "authenticated"` so it's only reachable through a signed delivery
 * URL. The guarded fields are all read off Cloudinary's response, never
 * guessed. Content, not just label, must be a real image (isRealImage
 * above) — same reasoning as uploadClientPhoto/uploadLogo.
 */
export async function uploadReservePhoto(
  file: File,
  projectId: number
): Promise<{ url: string } & GuardedUploadFields> {
  if (file.size > MAX_RESERVE_PHOTO_BYTES) {
    throw {
      type: "error",
      message: "The photo must be 10 MB or smaller.",
      i18n: "uploadTooLarge",
      i18nParams: { max: MAX_RESERVE_PHOTO_BYTES / (1024 * 1024) },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!isRealImage(buffer)) {
    throw { type: "error", message: "The photo must be an image file.", i18n: "uploadNotImage" };
  }

  return uploadBuffer(
    buffer,
    {
      folder: `projects/${projectId}/reserve-photos`,
      resource_type: "image",
      type: "authenticated",
      use_filename: true,
      unique_filename: true,
    },
    "Failed to upload the photo. Please try again.",
    (result) => ({
      // DEPRECATED — still written (see ReservePhoto.url's doc in
      // prisma/schema.prisma), never read back.
      url: result.secure_url,
      ...guardedFieldsFromUploadResult(result),
    })
  );
}

/**
 * Best-effort deletion of a réserve photo. Takes the stored publicId +
 * deliveryType + resourceType so the correct `type` reaches `destroy` — see
 * destroyReservePlan's doc. Never throws itself.
 */
export async function destroyReservePhoto(photo: GuardedAssetRef | null | undefined): Promise<void> {
  if (!photo) return;
  await destroyGuardedAsset(photo.publicId, photo.deliveryType, photo.resourceType, false);
}

// Reuses MAX_RESERVE_PHOTO_BYTES rather than a second, independently
// calibrated number for the same "photo attached to something" use case
// (point 9, review of the "Prêts" feature) — kept as its own name at
// equipment's own call sites below for readability, but never a value that
// can drift from réserve photo's: tests/next-config-upload-limit.test.ts
// asserts the two stay equal.
export const MAX_EQUIPMENT_PHOTO_BYTES = MAX_RESERVE_PHOTO_BYTES;

/** What uploadEquipmentPhoto returns: the public URL and the three columns `destroy` needs. */
export type UploadedEquipmentPhoto = { url: string } & GuardedAssetRef;

/**
 * Upload a piece of equipment's photo to Cloudinary and return its secure
 * URL + public id — same shape and size ceiling as uploadLogo, but the
 * buffer is re-encoded through stripArchivedPhotoMetadata BEFORE it ever
 * reaches Cloudinary: this asset is served from a PUBLIC URL (like
 * Client.photoUrl, Equipment has no guarded delivery — it's a thumbnail of a
 * tool, not a project asset), and a phone photo routinely carries GPS
 * coordinates in its EXIF. stripArchivedPhotoMetadata applies the EXIF
 * orientation to the pixels BEFORE stripping the tag that describes it, so
 * the archived copy doesn't come out sideways (see that function's header).
 *
 * Accepted formats: JPEG, PNG, WebP, GIF (isStrippableMediaType,
 * lib/imageMetadata.ts — the formats stripArchivedPhotoMetadata re-encodes in
 * place; anything else would silently fall through its `.gif()` default, a
 * mis-encode bug, not a rejection). HEIC, AVIF, BMP and TIFF are REFUSED here
 * with a message that names what IS accepted (decision B below) rather than
 * the generic "must be an image file". Unlike this path, the company photo
 * (uploadClientPhoto) converts AVIF and TIFF to a cleaned JPEG and accepts
 * HEIC/BMP as they are: that is its own product decision, not this one's.
 *
 * Decision B (delivery report) considered delegating HEIC/AVIF/BMP/TIFF to
 * Cloudinary instead — an incoming `transformation: [{ format: "jpg" }]`
 * upload, rather than the top-level `format` parameter the SDK's own types
 * document as a plain rename/convert. Still REJECTED, but the first live
 * proof's conclusion ("Cloudinary never rotates") was wrong, and worth
 * recording precisely so the next attempt doesn't repeat it:
 *
 *  - That first probe fabricated an AVIF with an EXIF orientation tag (sharp
 *    has no HEIC encoder to fabricate a HEIC one) and found no combination
 *    of options rotated it. That result doesn't generalize: per the HEIF
 *    spec, an AVIF/HEIC decoder is supposed to IGNORE a legacy EXIF
 *    Orientation tag and read rotation from the container's own `irot`/
 *    `imir` transformative properties instead — an iPhone's actual HEIC
 *    photos carry a real `irot` box, which sharp's fabricated file never
 *    had. The probe was testing a shape no real iPhone HEIC has.
 *  - Re-tested on a JPEG (orientation 6 + GPS/Make — JPEG DOES use EXIF
 *    Orientation, so this is the format the first probe should have used):
 *    `transformation: [{ format: "jpg", angle: "exif" }]` correctly rotated
 *    the pixels (200×300) and stripped GPS/Make entirely. Without
 *    `angle: "exif"`, neither rotation nor stripping happened — that
 *    explicit flag, not the bare transformation, was the missing piece.
 *  - HEIC itself is still UNPROVEN: forcing `angle: "exif"` on a real HEIC
 *    that already carries a correct `irot` box risks rotating it TWICE (once
 *    by the decoder honoring `irot`, once more by the explicit EXIF-based
 *    flag) — a real iPhone-produced HEIC file is needed to check for that
 *    before shipping the delegation for HEIC specifically. AVIF's/BMP's/
 *    TIFF's own EXIF-vs-container-metadata behavior is equally unverified.
 *
 * So: HEIC/AVIF/BMP/TIFF stay refused here until each is proven live on a
 * REAL file of its own format, not fabricated — the
 * `EXIF orientation → sideways photo` bug this whole app already paid for
 * once (docs/CONVENTIONS.md) is worse than a narrower accepted-format list.
 */
export async function uploadEquipmentPhoto(file: File, owner: string): Promise<UploadedEquipmentPhoto> {
  if (file.size > MAX_EQUIPMENT_PHOTO_BYTES) {
    throw {
      type: "error",
      message: "The photo must be 10 MB or smaller.",
      i18n: "uploadTooLarge",
      i18nParams: { max: MAX_EQUIPMENT_PHOTO_BYTES / (1024 * 1024) },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = detectRasterImageMediaType(buffer);
  if (!mediaType || !isStrippableMediaType(mediaType)) {
    throw {
      type: "error",
      message: "Accepted formats: JPEG, PNG, WebP, GIF.",
      i18n: "equipmentPhotoUnsupportedFormat",
    };
  }

  let stripped: Buffer;
  try {
    stripped = await stripArchivedPhotoMetadata(owner, buffer, mediaType, STORAGE_IMAGE_LIMITS);
  } catch (error) {
    // stripArchivedPhotoMetadata throws its own ScanError-shaped refusal
    // ({type, code}, no i18n field) — re-thrown here in this module's own
    // upload-error shape so getErrorMessage translates it the same way as every
    // other cloudinary.ts validation failure instead of falling back to the
    // generic server error.
    throw uploadErrorFromDecode(error);
  }

  return uploadBuffer(
    stripped,
    { folder: "equipment", resource_type: "image" },
    "Failed to upload the photo. Please try again.",
    (result) => ({ url: result.secure_url, ...assetRefFromUploadResult(result) })
  );
}

/**
 * Best-effort deletion of an equipment photo. Never throws so it can't break
 * the surrounding mutation if the asset is already gone. Like every destroy it goes
 * through destroyAndReport, which reads `destroy`'s own returned report
 * (`{ result: "ok" | "not found" | ... }`) and logs when it's neither: an
 * operation that doesn't throw hasn't necessarily done anything (Cloudinary
 * `destroy` silently no-ops on a `type`/`resource_type` mismatch instead of
 * erroring — see GuardedAssetRef's doc above), so silence alone isn't proof
 * of deletion.
 */
export async function destroyEquipmentPhoto(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  await destroyAndReport("equipment photo", publicId, { resource_type: "image" }, false);
}
