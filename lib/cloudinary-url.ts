// Pure Cloudinary URL helpers — no SDK import, safe to use in client
// components (the SDK pulls in Node's `fs` and can't be bundled for the browser).

const UPLOAD_MARKER = "/upload/";

/**
 * Insert a Cloudinary transformation right after the `/upload/` segment.
 * Returns the URL unchanged when it isn't a Cloudinary delivery URL, so every
 * caller degrades gracefully on foreign inputs.
 */
function withTransform(url: string, transform: string): string {
  const i = url.indexOf(UPLOAD_MARKER);
  if (i === -1) return url;
  const at = i + UPLOAD_MARKER.length;
  return `${url.slice(0, at)}${transform}/${url.slice(at)}`;
}

/**
 * Extract the Cloudinary public id (e.g. "clients/abcd") from a delivery URL.
 */
export function publicIdFromUrl(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1] : null;
}

/**
 * Rewrite a Cloudinary URL to deliver an optimized, square, face-aware
 * avatar crop (auto format + quality). Falls back to the original URL for
 * non-Cloudinary inputs.
 */
export function optimizedClientPhoto(url: string, size = 112): string {
  return withTransform(url, `f_auto,q_auto,c_fill,g_face,w_${size},h_${size}`);
}

/**
 * Rewrite a Cloudinary PDF (uploaded as an image resource) delivery URL to
 * deliver one page rasterised as a JPG at a given width — used to display a
 * reserve plan the pins are dropped on. Falls back to the original URL for
 * non-Cloudinary inputs.
 */
export function planPageImageUrl(url: string, page = 1, width = 1600): string {
  return withTransform(url, `pg_${page},f_jpg,q_auto,w_${width}`).replace(/\.pdf$/i, ".jpg");
}

/**
 * Rewrite a Cloudinary image URL to a bounded-width JPG for embedding in a
 * generated PDF. JPG (not f_auto) because the PDF writer needs a format it can
 * embed — it cannot decode WebP/AVIF, which `f_auto` would happily return.
 */
export function reportImageUrl(url: string, width = 900): string {
  return withTransform(url, `f_jpg,q_auto,w_${width},c_limit`).replace(/\.(png|webp|avif|heic|pdf)$/i, ".jpg");
}
