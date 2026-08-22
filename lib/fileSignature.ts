// Shared "don't trust the client-declared name/mime" technique: sniff the
// actual bytes rather than the `File.type` the browser attached (trivially
// spoofable — a request can set it to anything) or the filename extension
// (equally client-controlled). Extracted once two call sites needed the same
// raster-image sniffing: lib/deliveryNoteScan.ts (delivery note photos,
// cross-checked against the extension) and lib/cloudinary.ts (client photos,
// the branding logo, réserve photos, and — for a narrower "is this really an
// image" check only — generic project files). One place that knows what a
// real raster image actually looks like on disk, not one per upload path.
//
// Passe 3b, point 0 — regression fix: this originally recognized only
// JPEG/PNG/GIF/WEBP. Before this module existed, uploadClientPhoto/
// uploadLogo/uploadReservePhoto (lib/cloudinary.ts) accepted anything merely
// LABELED "image/*" (spoofable, but functionally permissive) — so HEIC (the
// default photo format on every iPhone) and AVIF (increasingly the default
// on recent Android) used to go through. Once those three paths started
// requiring a RECOGNIZED signature instead of a label, HEIC/AVIF photos —
// the single most common upload on a chantier app used from a phone —
// started being silently rejected. HEIC/AVIF are added back below, detected
// by their real ISOBMFF `ftyp` box, not merely trusted by extension.
//
// BMP and TIFF were also accepted before, on the same label-only basis, and
// are added back too for the same non-regression reason: same risk profile
// as the other formats (no executable content, just pixels), and
// lib/assetDelivery.ts's MIME_BY_FORMAT already anticipates both appearing
// as real stored content. Both get a real structural check, not a bare
// 2-4 byte prefix match, so this doesn't trade signature strength for
// coverage (see detectBmp/detectTiff below).

export type RasterImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/heic"
  | "image/avif"
  | "image/bmp"
  | "image/tiff";

export const RASTER_IMAGE_EXTENSION_MEDIA_TYPES: Record<string, RasterImageMediaType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

// ISOBMFF brands (bytes 8-11 of the `ftyp` box, itself at bytes 4-7) that
// identify a HEIC/HEIF vs an AVIF file — both containers share the exact
// same box structure, only the brand differs. Not exhaustive of every
// possible HEIF variant in the wild, but covers Apple's own encoder
// (heic/heix), the sequence/image variants it also writes (heim/heis), the
// generic HEVC-codec brand (hevc) and the codec-agnostic HEIF brands
// (mif1/msf1) some Android vendors use.
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * The ISOBMFF `ftyp` box's major brand (bytes 8-11), or null if `buffer`
 * doesn't even have the box (bytes 4-7 must read "ftyp"). Shared by the
 * HEIC and AVIF checks below — both formats are ISOBMFF containers that only
 * differ by this brand.
 */
function ftypMajorBrand(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return null;
  return buffer.toString("ascii", 8, 12);
}

/**
 * BMP's only fixed magic is the 2-byte "BM" signature — too weak alone (any
 * file starting with those two bytes would match). Strengthened here by also
 * checking the BITMAPFILEHEADER's own declared file size (bytes 2-5, little
 * endian) against the buffer's actual length: a real BMP always sets this to
 * its own total size, so this rejects a "BM"-prefixed non-BMP the bare magic
 * number alone would have let through.
 */
function detectBmp(buffer: Buffer): boolean {
  if (buffer.length < 6 || buffer[0] !== 0x42 || buffer[1] !== 0x4d) return false;
  return buffer.readUInt32LE(2) === buffer.length;
}

/** TIFF's two byte-order variants: "II*\0" (little endian) or "MM\0*" (big endian). */
function detectTiff(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const littleEndian = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
  const bigEndian = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
  return littleEndian || bigEndian;
}

/**
 * Sniffs the first bytes of a buffer for one of the raster image signatures
 * this app accepts server-side. Returns null for anything else — including a
 * well-formed SVG (XML text, no binary magic number) or an HTML file, which
 * is exactly the point: neither can pass this check no matter what extension
 * or declared MIME type is attached to it.
 */
export function detectRasterImageMediaType(buffer: Buffer): RasterImageMediaType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  const brand = ftypMajorBrand(buffer);
  if (brand && HEIC_BRANDS.has(brand)) return "image/heic";
  if (brand && AVIF_BRANDS.has(brand)) return "image/avif";
  if (detectTiff(buffer)) return "image/tiff";
  if (detectBmp(buffer)) return "image/bmp";
  return null;
}

// PDF's magic bytes ("%PDF-", ISO 32000-1 §7.5.2) don't have to sit at byte 0:
// the spec explicitly tolerates producers prepending a few bytes of junk
// before the header, as long as it appears within the file's first 1024
// bytes — some scanners/exporters do exactly that. Searching the whole
// window (rather than only offset 0) avoids rejecting a legitimately
// produced PDF on a check stricter than the format itself requires.
const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");
const PDF_SNIFF_WINDOW = 1024;

/**
 * Confirms `buffer` really starts with a PDF header — sniffed from its magic
 * bytes, never the client-declared `file.type` or the filename's `.pdf`
 * extension, both of which a request can set to anything. A réserve plan
 * (lib/cloudinary.ts::uploadReservePlan) is uploaded to Cloudinary as an
 * *image* resource specifically so it can be rasterised — an HTML or SVG
 * file renamed to "plan.pdf" would otherwise pass a label-only check and
 * reach Cloudinary unread.
 */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_SNIFF_WINDOW).indexOf(PDF_SIGNATURE) !== -1;
}

/**
 * Sniffs for the same "active content that executes when opened directly"
 * shapes lib/cloudinary.ts's BLOCKED_UPLOAD_MIME_TYPES / BLOCKED_UPLOAD_EXTENSIONS
 * deny by label (SVG, HTML, XHTML, bare XML) — but this time by the actual
 * bytes, so renaming evil.svg to facture.png and declaring image/png doesn't
 * get past a label-only check. Skips a leading UTF-8 BOM and whitespace, the
 * two things real authoring tools commonly put before the first tag. Not a
 * full parser — a bounded, best-effort sniff over the first 512 bytes, same
 * spirit as the magic-number checks above: it closes the "renamed + relabeled"
 * gap, it does not claim to detect every possible disguise.
 */
export function looksLikeDangerousMarkup(buffer: Buffer): boolean {
  const head = buffer
    .subarray(0, 512)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith("<svg") ||
    head.startsWith("<?xml") ||
    head.startsWith("<!doctype html") ||
    head.startsWith("<html")
  );
}
