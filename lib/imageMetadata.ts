import sharp from "sharp";
import type { RasterImageMediaType } from "@/lib/fileSignature";

// Extracted from lib/deliveryNoteScan.ts (point 13, review of the "Prêts"
// feature): stripArchivedPhotoMetadata started as a delivery-note-only
// concern, but lib/cloudinary.ts::uploadEquipmentPhoto needed the identical
// re-encode-and-strip step for a second, unrelated upload path — a shared,
// generic "image metadata" module is the right home for both, rather than
// equipment importing from a module named after delivery notes. No behavior
// change: same function, same 4-format allowlist, same sharp pipeline.

// Deliberately NARROWER than lib/fileSignature.ts's own RasterImageMediaType
// (passe 3b, point 0 widened that one to also recognize HEIC/AVIF/BMP/TIFF,
// closing a regression in lib/cloudinary.ts's photo uploads). Neither caller
// of stripArchivedPhotoMetadata below gets that widening for free: it
// re-encodes with a format-specific sharp branch for exactly these four
// media types (anything else silently falls through to its `.gif()`
// default — a real mis-encode bug, not a rejection) — narrowing back down
// here keeps that scope explicit rather than silently inheriting a wider
// one from the shared sniffer.
export type DeliveryNoteMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const DELIVERY_NOTE_MEDIA_TYPES: ReadonlySet<RasterImageMediaType> = new Set<RasterImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Exported for lib/deliveryNoteScan.ts::readAndValidateDeliveryNoteImage, the one caller outside this module. */
export function isDeliveryNoteMediaType(value: RasterImageMediaType): value is DeliveryNoteMediaType {
  return DELIVERY_NOTE_MEDIA_TYPES.has(value);
}

// Shared by lib/deliveryNoteScan.ts's own reduceImageForModel and
// stripArchivedPhotoMetadata below: sharp's own default input-pixel limit is
// ~268 megapixels, high enough that a small, well-formed file can still
// decode into hundreds of megabytes of raw pixel data (measured: a 748 KB
// PNG decoded to ~349 MB RSS) — a byte-size ceiling only bounds the
// COMPRESSED upload, not the DECODED pixel count a crafted or pathological
// image can expand to. A few such uploads in quick succession can OOM-kill
// the whole container on a small VPS, without a single byte ever reaching
// the vision provider or Cloudinary. 40 million pixels is generous headroom
// over any real phone photo (a 12 MP camera is 4032x3024 ~= 12.2 Mpx) while
// keeping the worst case bounded.
export const SHARP_MAX_INPUT_PIXELS = 40_000_000;

// The archive keeps its original resolution, so quality 95 is visually
// indistinguishable from the source. Re-encoding at all is inherent to
// stripping a JPEG's metadata with sharp — there is no "delete just the EXIF
// segment, leave the rest of the file untouched" primitive here — so this is
// the quality that re-encoding step uses.
const ARCHIVE_JPEG_QUALITY = 95;

/**
 * Strips privacy-sensitive metadata (EXIF — GPS coordinates, capture
 * timestamp, device model; also ICC profile, XMP) from an uploaded photo,
 * per an explicit product decision. Used by lib/deliveryNoteScan.ts (the
 * delivery-note photo archived on a project — crossed with "who scanned
 * this", GPS + timestamp is a presence trail of employees on a job site,
 * personal data for close to zero evidentiary value) and by
 * lib/cloudinary.ts::uploadEquipmentPhoto (a phone photo of a tool).
 *
 * Never resized: full resolution in, full resolution out. It also never
 * changes format: a JPEG stays a JPEG, a PNG stays a PNG, a WEBP stays a
 * WEBP, a GIF stays a GIF.
 *
 * Two things happen, in order:
 *  1. `.rotate()` with no argument auto-orients using the EXIF orientation
 *     tag, baking it into the pixels themselves, BEFORE metadata is dropped
 *     in step 2 — stripping the tag without applying it first would archive
 *     every portrait photo lying on its side.
 *  2. Re-encoded in its own original format. JPEG is re-encoded at
 *     ARCHIVE_JPEG_QUALITY (95) — visually indistinguishable from the
 *     source; re-encoding itself is inherent to stripping a JPEG's
 *     metadata with sharp, there is no lower-impact primitive available.
 *     PNG, WEBP and GIF are re-encoded with sharp's own defaults for that
 *     format. Metadata is dropped as a side effect of NOT calling
 *     `.withMetadata()` on the pipeline in any branch — do not add it.
 *
 * `limitInputPixels` reuses SHARP_MAX_INPUT_PIXELS above, for the same
 * reason as lib/deliveryNoteScan.ts::reduceImageForModel: a byte-size
 * ceiling only bounds the compressed upload, not the decoded pixel count a
 * crafted/pathological image can expand to.
 *
 * Throws `{ type: "error", code: "corruptedImage" }` (never a native error)
 * if sharp can't process the buffer — structurally the same shape as
 * lib/deliveryNoteScan.ts's own ScanError (so its isScanError still
 * recognizes it, caught by actions/deliveryNoteScan/deliveryNoteScan.ts),
 * built as a plain literal here rather than imported: that module imports
 * THIS function, importing its error type back would be circular. Either
 * caller failing the whole request before any database write happens is the
 * point — never silently falling back to archiving/uploading the
 * un-cleaned original, which would quietly undo the product decision this
 * exists to apply.
 */
export async function stripArchivedPhotoMetadata(
    buffer: Buffer,
    mediaType: DeliveryNoteMediaType
): Promise<Buffer> {
    try {
        const pipeline = sharp(buffer, { limitInputPixels: SHARP_MAX_INPUT_PIXELS, sequentialRead: true }).rotate();
        if (mediaType === "image/jpeg") {
            return await pipeline.jpeg({ quality: ARCHIVE_JPEG_QUALITY }).toBuffer();
        }
        if (mediaType === "image/png") {
            return await pipeline.png().toBuffer();
        }
        if (mediaType === "image/webp") {
            return await pipeline.webp().toBuffer();
        }
        return await pipeline.gif().toBuffer();
    } catch {
        throw { type: "error" as const, code: "corruptedImage" as const };
    }
}
