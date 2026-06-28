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
