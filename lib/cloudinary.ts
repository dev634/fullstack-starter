import { v2 as cloudinary } from "cloudinary";

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
 * Extract the Cloudinary public id (e.g. "clients/abcd") from a delivery URL.
 */
export function publicIdFromUrl(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1] : null;
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

/**
 * Rewrite a Cloudinary URL to deliver an optimized, square, face-aware
 * avatar crop (auto format + quality). Falls back to the original URL for
 * non-Cloudinary inputs.
 */
export function optimizedClientPhoto(url: string, size = 112): string {
  const marker = "/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const transform = `f_auto,q_auto,c_fill,g_face,w_${size},h_${size}/`;
  return url.slice(0, i + marker.length) + transform + url.slice(i + marker.length);
}
