// Pure Cloudinary URL helpers — no SDK import, safe to use in client
// components (the SDK pulls in Node's `fs` and can't be bundled for the browser).

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
  const marker = "/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const transform = `f_auto,q_auto,c_fill,g_face,w_${size},h_${size}/`;
  return url.slice(0, i + marker.length) + transform + url.slice(i + marker.length);
}
