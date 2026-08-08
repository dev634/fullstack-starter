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
 * non-Cloudinary inputs. `Client.photoUrl` is the one asset still delivered
 * from a public Cloudinary URL — see the field's doc in prisma/schema.prisma
 * for why — so this is the only place left that needs to splice a
 * transformation into an already-built URL.
 */
export function optimizedClientPhoto(url: string, size = 112): string {
  const marker = "/upload/";
  const i = url.indexOf(marker);
  if (i === -1) return url;
  const at = i + marker.length;
  const transform = `f_auto,q_auto,c_fill,g_face,w_${size},h_${size}`;
  return `${url.slice(0, at)}${transform}/${url.slice(at)}`;
}
