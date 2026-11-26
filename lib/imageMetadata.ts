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

/**
 * Whether stripArchivedPhotoMetadata below can re-encode this format in place:
 * the single predicate for every caller (lib/deliveryNoteScan.ts's
 * readAndValidateDeliveryNoteImage, lib/cloudinary.ts's uploadClientPhoto and
 * uploadEquipmentPhoto). It replaces two byte-identical copies, one in each
 * module (isDeliveryNoteMediaType / isStrippableEquipmentPhoto): no behavior
 * change, only one place to widen.
 */
export function isStrippableMediaType(value: RasterImageMediaType): value is DeliveryNoteMediaType {
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

// libvips keeps every decoded image in its operation cache, and sharp's default
// cache is generous. Measured on Windows, 20 successive decodes of a 27 KB GIF
// of 6000x6600 held ~3 GB resident with the default cache (+151 MB per decode)
// and ~47 MB with the cache off; a 943-byte 12-bit AVIF retains +227 MB per
// decode. Nothing here decodes the same buffer twice, so the cache buys
// nothing and costs the very memory the queue below exists to bound. Set once,
// at load: every sharp path of the app imports this module.
sharp.cache(false);

// A refusal of this module, in the shape lib/deliveryNoteScan.ts's ScanError
// already has (built as a literal: that module imports THIS one). "corruptedImage"
// is what every caller already turns into its own refusal; "imageBusy" is the
// queue below being full, which each caller turns into "the server is already
// processing images, try again in a moment". Neither ever leads to sending the
// original.
export type ImageRefusalCode = "corruptedImage" | "imageBusy";
export type ImageRefusal = { type: "error"; code: ImageRefusalCode };

function refusal(code: ImageRefusalCode): ImageRefusal {
    return { type: "error", code };
}

/** Whether a thrown value is the queue's "full, try again" refusal (and not a decode failure). */
export function isImageBusyError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "error" &&
        "code" in error &&
        error.code === "imageBusy"
    );
}

// One decode at a time, process-wide. A small file can decode into hundreds of
// megabytes of raw pixels just under SHARP_MAX_INPUT_PIXELS (measured on
// Windows: a 27 KB GIF of 6000x6600 costs ~580 MB of RSS while it runs; four in
// parallel, ~2.2 GB), and the container has neither a memory limit nor a rate
// limit in front of the photo paths. Lowering the pixel ceiling would refuse
// real 24 Mpx phone photos, so the cost is bounded here instead: the four
// application paths that decode with sharp go through this queue — company
// photo, equipment photo, bulletin archive (here) and the bulletin's image for
// the model (lib/deliveryNoteScan.ts::reduceImageForModel, which imports it).
// A failed task never blocks the next one.
//
// The queue is a SINGLETON OF THE PROCESS, kept on globalThis under a
// Symbol.for key (the way a single Prisma client is kept): the production build
// bundles this module into more than one server chunk (measured: two chunks
// each carrying the decoder), and a module-level variable would then give each
// chunk its own queue — a real concurrency of 2 under a bound announced as 1.
//
// Bounded length: at most MAX_WAITING_TASKS tasks wait behind the running one;
// the next is refused at once with "imageBusy" instead of piling up (measured:
// a 19 ms JPEG waited 4.3 s behind 5 heavy AVIFs and 17.6 s behind 20). There is
// no per-user rate limit here: that is the next batch.
export const MAX_WAITING_TASKS = 8;

type QueueState = { active: boolean; waiting: Array<() => void> };

const QUEUE_KEY = Symbol.for("fullstack-starter.imageMetadata.queue");

function isQueueState(value: unknown): value is QueueState {
    return (
        typeof value === "object" &&
        value !== null &&
        "active" in value &&
        typeof value.active === "boolean" &&
        "waiting" in value &&
        Array.isArray(value.waiting)
    );
}

function sharedQueue(): QueueState {
    const existing: unknown = Reflect.get(globalThis, QUEUE_KEY);
    if (isQueueState(existing)) return existing;
    const created: QueueState = { active: false, waiting: [] };
    Reflect.set(globalThis, QUEUE_KEY, created);
    return created;
}

function startNext(queue: QueueState): void {
    const next = queue.waiting.shift();
    if (next) {
        next();
    } else {
        queue.active = false;
    }
}

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const queue = sharedQueue();
    const run = (): Promise<T> =>
        new Promise<T>((resolve) => resolve(task())).finally(() => startNext(queue));
    if (!queue.active) {
        queue.active = true;
        return run();
    }
    if (queue.waiting.length >= MAX_WAITING_TASKS) {
        return Promise.reject(refusal("imageBusy"));
    }
    return new Promise<T>((resolve, reject) => {
        queue.waiting.push(() => {
            run().then(resolve, reject);
        });
    });
}

// A decode is abandoned by libvips after this long and the task fails like any
// other decode failure, which frees the queue. 10 s is far above a real 24 Mpx
// photo (well under a second) and below the point where a waiting upload gives up.
export const SHARP_TIMEOUT_SECONDS = 10;

// The pixel ceiling above bounds the pixel COUNT, not the decoded BYTES: bytes =
// pixels x channels x bytes per sample, and a 5-channel float32 TIFF of a few KB
// (~1.1 GB measured) or a 12-bit AVIF of 943 bytes (~1 GB measured) stay under
// 40 Mpx. The budget is the raster the pixel ceiling already admits in RGBA at
// 8 bits (40 Mpx x 4 x 1 = 160 MB), so it refuses nothing the ceiling admits in
// 8 bits (a 24 Mpx RGB JPEG is 72 MB, a 12 Mpx RGB 16-bit PNG is 72 MB) and only
// constrains high bit depth and many channels. NOT calibrated on real 10-bit
// phone AVIFs: not proven, only checked against synthetic files. The header is
// read with metadata(), which decodes nothing.
export const MAX_DECODED_BYTES = 160_000_000;

// libvips band formats, in bytes per sample (sharp's `depth` metadata).
const BYTES_PER_SAMPLE: Readonly<Record<string, number>> = {
    uchar: 1,
    char: 1,
    ushort: 2,
    short: 2,
    uint: 4,
    int: 4,
    float: 4,
    complex: 8,
    double: 8,
    dpcomplex: 16,
};

// TIFF is the one container that can carry float samples and arbitrarily many
// bands: only 8/16-bit integer samples and at most 4 channels are accepted.
const TIFF_MAX_CHANNELS = 4;
const TIFF_DEPTHS: ReadonlySet<string> = new Set(["uchar", "ushort"]);

type ImageHeader = { format?: string; width?: number; height?: number; channels?: number; depth?: string };

/** Refuses (throws `corruptedImage`) a header whose decoded size is beyond the budget. */
function assertDecodedSizeWithinBudget(header: ImageHeader): void {
    const { format, width, height, channels, depth } = header;
    if (!width || !height || !channels || !depth) throw refusal("corruptedImage");
    const bytesPerSample = BYTES_PER_SAMPLE[depth];
    if (bytesPerSample === undefined) throw refusal("corruptedImage");
    if (format === "tiff" && (!TIFF_DEPTHS.has(depth) || channels > TIFF_MAX_CHANNELS)) {
        throw refusal("corruptedImage");
    }
    if (width * height * channels * bytesPerSample > MAX_DECODED_BYTES) throw refusal("corruptedImage");
}

// `failOn: "none"`: sharp's default ("warning") refuses a JPEG that merely
// lacks its two end-of-image bytes or is cut short by an interrupted transfer
// — files Cloudinary used to accept — so a legitimate upload would start
// failing. "none" decodes what is decodable; a header that is really
// corrupted is still refused (sharp throws on it whatever `failOn` says).
// Shared by every caller on purpose: one function, one behavior (the
// bulletin's image for the model, lib/deliveryNoteScan.ts, included).
//
// Reads the header first (metadata(): nothing is decoded) and refuses a decoded
// size beyond MAX_DECODED_BYTES BEFORE allocating anything, then opens the
// pipeline with the pixel ceiling, the orientation and the decode timeout.
// Call it inside runExclusive, and await it.
export async function decodeOriented(buffer: Buffer): Promise<ReturnType<typeof sharp>> {
    const options = { limitInputPixels: SHARP_MAX_INPUT_PIXELS, sequentialRead: true, failOn: "none" } as const;
    assertDecodedSizeWithinBudget(await sharp(buffer, options).metadata());
    return sharp(buffer, options).rotate().timeout({ seconds: SHARP_TIMEOUT_SECONDS });
}

/**
 * Strips privacy-sensitive metadata (EXIF — GPS coordinates, capture
 * timestamp, device model; also ICC profile, XMP) from an uploaded photo,
 * per an explicit product decision. Used by lib/deliveryNoteScan.ts (the
 * delivery-note photo archived on a project — crossed with "who scanned
 * this", GPS + timestamp is a presence trail of employees on a job site,
 * personal data for close to zero evidentiary value), by
 * lib/cloudinary.ts::uploadEquipmentPhoto (a phone photo of a tool) and by
 * lib/cloudinary.ts::uploadClientPhoto (the company photo, public).
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
 * Only one call runs at a time (runExclusive above), and a truncated JPEG is
 * decoded rather than refused (decodeOriented above).
 *
 * An animated GIF or WebP is reduced to its FIRST frame (sharp's default:
 * `animated: true` is deliberately not set). Acceptable for a thumbnail or an
 * archived photo, and it keeps the output small and the decode bounded.
 *
 * `limitInputPixels` reuses SHARP_MAX_INPUT_PIXELS above, for the same
 * reason as lib/deliveryNoteScan.ts::reduceImageForModel: a byte-size
 * ceiling only bounds the compressed upload, not the decoded pixel count a
 * crafted/pathological image can expand to.
 *
 * Throws `{ type: "error", code: "imageBusy" }` at once when MAX_WAITING_TASKS
 * tasks already wait (the caller says "the server is already processing
 * images, try again"), and `{ type: "error", code: "corruptedImage" }` (never
 * a native error) if sharp can't process the buffer — or the decoded size is
 * beyond MAX_DECODED_BYTES, or the decode outlasts SHARP_TIMEOUT_SECONDS — structurally the same shape as
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
    return runExclusive(async () => {
        try {
            const pipeline = await decodeOriented(buffer);
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
            throw refusal("corruptedImage");
        }
    });
}

/**
 * AVIF and TIFF are not re-encoded in their own format here, but both decode:
 * this decodes, applies the orientation, and encodes a JPEG without any
 * metadata. Same pixel ceiling, same queue, same refusal shape as
 * stripArchivedPhotoMetadata. Used by lib/cloudinary.ts::uploadClientPhoto
 * only; the equipment photo keeps refusing both formats.
 */
export async function convertToStrippedJpeg(buffer: Buffer): Promise<Buffer> {
    return runExclusive(async () => {
        try {
            return await (await decodeOriented(buffer)).jpeg({ quality: ARCHIVE_JPEG_QUALITY }).toBuffer();
        } catch {
            throw refusal("corruptedImage");
        }
    });
}
