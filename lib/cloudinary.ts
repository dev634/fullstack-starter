import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { publicIdFromUrl } from "./cloudinary-url";
import {
  toCloudinaryType,
  toCloudinaryResourceType,
  fromCloudinaryType,
  fromCloudinaryResourceType,
} from "./cloudinaryDelivery";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";

// Re-export the pure URL helpers so existing server imports keep working.
export { publicIdFromUrl, optimizedClientPhoto } from "./cloudinary-url";

// The SDK reads credentials from the CLOUDINARY_URL env var
// (cloudinary://<api_key>:<api_secret>@<cloud_name>). We only force
// HTTPS URLs here.
cloudinary.config({ secure: true });

// --- Guarded delivery --------------------------------------------------
//
// Enough of a stored row's guarded-delivery columns to call Cloudinary's
// destroy with the correct `type` + `resource_type`. `destroy` defaults
// `type` to "upload" and SILENTLY NO-OPS (no error) when it doesn't match
// the asset's real type — so these must always be read from the database,
// never re-derived from a mime type. See prisma/schema.prisma's comment on
// ProjectFile.resourceType for the same rule applied to persistence.
type GuardedAssetRef = {
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
 * guardedFieldsFromUploadResult THROWS on an unexpected resource/delivery
 * type (see fromCloudinaryResourceType/fromCloudinaryType's docs in
 * lib/cloudinaryDelivery.ts). Every call site below is inside an
 * upload_stream callback — invoked later by the Cloudinary SDK, outside the
 * surrounding `new Promise((resolve, reject) => ...)` executor's own call
 * stack — so a raw throw there does NOT reject that promise: it becomes an
 * uncaughtException that kills the Node process, leaving the Server Action
 * that's awaiting the upload hung forever. Routing the throw through
 * `reject` here turns it back into a normal promise rejection.
 */
function safeGuardedFields(
  result: UploadApiResponse,
  reject: (reason: unknown) => void
): GuardedUploadFields | null {
  try {
    return guardedFieldsFromUploadResult(result);
  } catch (error) {
    reject(error);
    return null;
  }
}

async function destroyGuardedAsset(
  publicId: string,
  deliveryType: CloudinaryDeliveryType,
  resourceType: CloudinaryResourceType
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, {
      type: toCloudinaryType(deliveryType),
      resource_type: toCloudinaryResourceType(resourceType),
    });
  } catch (error) {
    console.error("Cloudinary destroy failed:", error);
  }
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Upload a client photo to Cloudinary and return its secure URL.
 * Validates that the file is an image under the size limit.
 */
export async function uploadClientPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw {
      type: "error",
      message: "The photo must be an image file.",
    };
  }

  if (file.size > MAX_BYTES) {
    throw {
      type: "error",
      message: "The photo must be 5 MB or smaller.",
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  return new Promise<string>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder: "clients", resource_type: "image" },
        (error, result) => {
          if (error || !result) {
            reject({
              type: "error",
              message: "Failed to upload the photo. Please try again.",
            });
            return;
          }
          resolve(result.secure_url);
        }
      )
      .end(buffer);
  });
}

/**
 * Best-effort deletion of a previously uploaded photo. Never throws so it
 * can't break the surrounding mutation if the asset is already gone.
 */
export async function destroyClientPhoto(
  url: string | null | undefined
): Promise<void> {
  if (!url) return;
  const publicId = publicIdFromUrl(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary destroy failed:", error);
  }
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Upload the app-wide branding logo to Cloudinary. Returns publicId
 * alongside the URL so the previous logo can be cleanly destroyed on
 * replacement (see destroyLogo).
 */
export async function uploadLogo(file: File): Promise<{ url: string; publicId: string }> {
  if (!file.type.startsWith("image/")) {
    throw {
      type: "error",
      message: "The logo must be an image file.",
    };
  }

  if (file.size > MAX_LOGO_BYTES) {
    throw {
      type: "error",
      message: "The logo must be 2 MB or smaller.",
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder: "app-settings", resource_type: "image" },
        (error, result) => {
          if (error || !result) {
            reject({
              type: "error",
              message: "Failed to upload the logo. Please try again.",
            });
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      )
      .end(buffer);
  });
}

/**
 * Best-effort deletion of the previous logo. Never throws so it can't break
 * the surrounding mutation if the asset is already gone.
 */
export async function destroyLogo(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    console.error("Cloudinary destroy failed:", error);
  }
}

const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

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
    };
  }

  if (isBlockedUpload(file)) {
    throw {
      type: "error",
      message: "This file type isn't allowed.",
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const resourceType = resourceTypeFromMime(file.type);

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `projects/${projectId}`,
          resource_type: resourceType,
          type: "authenticated",
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            reject({
              type: "error",
              message: "Failed to upload the file. Please try again.",
            });
            return;
          }
          const guardedFields = safeGuardedFields(result, reject);
          if (!guardedFields) return;
          resolve({
            // DEPRECATED — the legacy public secure_url. Still written (the
            // column stays NOT NULL for one release), never read back.
            url: result.secure_url,
            size: result.bytes,
            mimeType: file.type || "application/octet-stream",
            ...guardedFields,
          });
        }
      )
      .end(buffer);
  });
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
  await destroyGuardedAsset(publicId, asset.deliveryType, asset.resourceType);
}

const MAX_RESERVE_PLAN_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a reserve plan (a PDF) to Cloudinary as an *image* resource — unlike
 * generic project files (stored raw), this lets Cloudinary rasterise the PDF
 * so its pages can be delivered as images to pin réserves on (see
 * lib/cloudinaryDelivery.ts::buildDeliveryUrl). `type: "authenticated"` so
 * the plan is only reachable through a signed delivery URL. The guarded
 * fields are all read off Cloudinary's response, never guessed.
 */
export async function uploadReservePlan(
  file: File,
  projectId: number
): Promise<{ url: string } & GuardedUploadFields> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw { type: "error", message: "The plan must be a PDF file." };
  }
  if (file.size > MAX_RESERVE_PLAN_BYTES) {
    throw { type: "error", message: "The plan must be 25 MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `projects/${projectId}/reserve-plans`,
          resource_type: "image",
          type: "authenticated",
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            reject({ type: "error", message: "Failed to upload the plan. Please try again." });
            return;
          }
          const guardedFields = safeGuardedFields(result, reject);
          if (!guardedFields) return;
          resolve({
            // DEPRECATED — still written (see ReservePlan.url's doc in
            // prisma/schema.prisma), never read back.
            url: result.secure_url,
            ...guardedFields,
          });
        }
      )
      .end(buffer);
  });
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
  await destroyGuardedAsset(plan.publicId, plan.deliveryType, plan.resourceType);
}

const MAX_RESERVE_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload a photo attached to a réserve (must be an image, under the limit).
 * `type: "authenticated"` so it's only reachable through a signed delivery
 * URL. The guarded fields are all read off Cloudinary's response, never
 * guessed.
 */
export async function uploadReservePhoto(
  file: File,
  projectId: number
): Promise<{ url: string } & GuardedUploadFields> {
  if (!file.type.startsWith("image/") || isBlockedUpload(file)) {
    throw { type: "error", message: "The photo must be an image file." };
  }
  if (file.size > MAX_RESERVE_PHOTO_BYTES) {
    throw { type: "error", message: "The photo must be 10 MB or smaller." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `projects/${projectId}/reserve-photos`,
          resource_type: "image",
          type: "authenticated",
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            reject({ type: "error", message: "Failed to upload the photo. Please try again." });
            return;
          }
          const guardedFields = safeGuardedFields(result, reject);
          if (!guardedFields) return;
          resolve({
            // DEPRECATED — still written (see ReservePhoto.url's doc in
            // prisma/schema.prisma), never read back.
            url: result.secure_url,
            ...guardedFields,
          });
        }
      )
      .end(buffer);
  });
}

/**
 * Best-effort deletion of a réserve photo. Takes the stored publicId +
 * deliveryType + resourceType so the correct `type` reaches `destroy` — see
 * destroyReservePlan's doc. Never throws itself.
 */
export async function destroyReservePhoto(photo: GuardedAssetRef | null | undefined): Promise<void> {
  if (!photo) return;
  await destroyGuardedAsset(photo.publicId, photo.deliveryType, photo.resourceType);
}
