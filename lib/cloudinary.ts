import { v2 as cloudinary } from "cloudinary";
import { publicIdFromUrl } from "./cloudinary-url";

// Re-export the pure URL helpers so existing server imports keep working.
export { publicIdFromUrl, optimizedClientPhoto } from "./cloudinary-url";

// The SDK reads credentials from the CLOUDINARY_URL env var
// (cloudinary://<api_key>:<api_secret>@<cloud_name>). We only force
// HTTPS URLs here.
cloudinary.config({ secure: true });

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
 * "raw" resource type. Destroy calls must pass the matching resource_type
 * or they silently no-op, so we derive it from the stored mime type.
 */
export function resourceTypeFromMime(mimeType: string | null | undefined): "image" | "video" | "raw" {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return "raw";
}

/**
 * Upload an arbitrary project document (image, PDF, plan, ...) to
 * Cloudinary under a per-project folder.
 */
export async function uploadProjectFile(
  file: File,
  projectId: number
): Promise<{ url: string; publicId: string; size: number; mimeType: string }> {
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
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            size: result.bytes,
            mimeType: file.type || "application/octet-stream",
          });
        }
      )
      .end(buffer);
  });
}

/**
 * Best-effort deletion of a previously uploaded project file. Never throws
 * so it can't break the surrounding mutation if the asset is already gone.
 */
export async function destroyProjectFile(
  publicId: string,
  mimeType: string | null | undefined
): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceTypeFromMime(mimeType) });
  } catch (error) {
    console.error("Cloudinary destroy failed:", error);
  }
}

const MAX_RESERVE_PLAN_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a reserve plan (a PDF) to Cloudinary as an *image* resource — unlike
 * generic project files (stored raw), this lets Cloudinary rasterise the PDF
 * so its pages can be delivered as images to pin réserves on (see
 * planPageImageUrl). Returns the secure URL + public id for later deletion.
 */
export async function uploadReservePlan(
  file: File,
  projectId: number
): Promise<{ url: string; publicId: string }> {
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
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error || !result) {
            reject({ type: "error", message: "Failed to upload the plan. Please try again." });
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      )
      .end(buffer);
  });
}

/**
 * Best-effort deletion of a reserve plan (image resource). Never throws.
 */
export async function destroyReservePlan(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    console.error("Cloudinary destroy failed:", error);
  }
}
