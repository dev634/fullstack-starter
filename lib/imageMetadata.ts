import type { RasterImageMediaType } from "@/lib/fileSignature";
import { countImageFrames } from "@/lib/imageFrameCount";
import { stripPngTextChunks } from "@/lib/pngTextChunks";
import {
    isDecodeDeadlineError,
    isOutputTooLargeError,
    runInChild,
    type DecodeOperation,
    type EncodeOutput,
    type ImageHeader,
} from "@/lib/imageDecodeBridge";

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
// keeping the worst case bounded. Sent to the decode child with each request: this is
// its only source.
export const SHARP_MAX_INPUT_PIXELS = 40_000_000;

// The archive keeps its original resolution, so quality 95 is visually
// indistinguishable from the source. Re-encoding at all is inherent to
// stripping a JPEG's metadata with sharp — there is no "delete just the EXIF
// segment, leave the rest of the file untouched" primitive here — so this is
// the quality that re-encoding step uses.
const ARCHIVE_JPEG_QUALITY = 95;

// A refusal of this module, in the shape lib/deliveryNoteScan.ts's ScanError
// already has (built as a literal: that module imports THIS one). Each code is
// turned by every caller into its own message, and none ever leads to sending the
// original:
//  - "corruptedImage": the image could not be decoded (or the child died during the task);
//  - "imageTooHeavy": the task outlasted its deadline and its child was killed — a legitimate
//    but heavy image looks like this, and must not read "not an image";
//  - "imageBusy": the queue below is full;
//  - "imageInProgress": this account already has a task in the queue (waiting or running);
//  - "imageQuota": this account has used its decode TIME for the hour (`minutes` says
//    when enough of its oldest minutes leave the window);
//  - "imageUnavailable": the decode child could not START (no task ran at all): the
//    decoder is down, which is not the user's file;
//  - "outputTooLarge": the re-encoded image is beyond what the caller's destination takes
//    (`maxBytes`: that ceiling, for the message).
// The list is the one source: the union type is derived from it, and the scan's own list
// (lib/deliveryNoteScan.ts) is built from it, never copied.
export const IMAGE_REFUSAL_CODES = [
    "corruptedImage",
    "imageTooHeavy",
    "imageBusy",
    "imageInProgress",
    "imageQuota",
    "imageUnavailable",
    "outputTooLarge",
] as const;
export type ImageRefusalCode = (typeof IMAGE_REFUSAL_CODES)[number];

type PlainRefusalCode = Exclude<ImageRefusalCode, "imageQuota" | "outputTooLarge">;

/** A discriminated union: a field exists only on the code that carries it. */
export type ImageRefusal =
    | { type: "error"; code: PlainRefusalCode }
    | { type: "error"; code: "imageQuota"; minutes: number }
    | { type: "error"; code: "outputTooLarge"; maxBytes: number };

function refusal(code: PlainRefusalCode): ImageRefusal {
    return { type: "error", code };
}

/** A byte ceiling as a message shows it, in MB with one decimal at most (10,485,760 -> 10). */
export function mebibytes(bytes: number): number {
    return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function isCountOf(value: object, key: string): boolean {
    return key in value && typeof Reflect.get(value, key) === "number" && Number.isFinite(Reflect.get(value, key));
}

/** Whether a thrown value is one of this module's own refusals: a code of the closed list, and the numeric field its code carries. */
export function isImageRefusal(error: unknown): error is ImageRefusal {
    if (typeof error !== "object" || error === null) return false;
    if (!("type" in error) || error.type !== "error" || !("code" in error)) return false;
    const code = error.code;
    if (!IMAGE_REFUSAL_CODES.some((known) => known === code)) return false;
    if (code === "imageQuota") return isCountOf(error, "minutes");
    if (code === "outputTooLarge") return isCountOf(error, "maxBytes");
    return true;
}

// One decode at a time, process-wide. A small file can decode into hundreds of
// megabytes of raw pixels just under SHARP_MAX_INPUT_PIXELS (measured on
// Windows: a 27 KB GIF of 6000x6600 costs ~580 MB of RSS while it runs; four in
// parallel, ~2.2 GB). Lowering the pixel ceiling would refuse real 24 Mpx phone
// photos, so the cost is bounded here instead: the four application paths that
// decode go through this queue — company photo, equipment photo, bulletin
// archive (here) and the bulletin's image for the model
// (lib/deliveryNoteScan.ts::reduceImageForModel, which imports it). A failed task
// never blocks the next one.
//
// The queue is a SINGLETON OF THE PROCESS, kept on globalThis under a
// Symbol.for key (the way a single Prisma client is kept): the production build
// bundles this module into more than one server chunk (measured: two chunks
// each carrying the decoder), and a module-level variable would then give each
// chunk its own queue — a real concurrency of 2 under a bound announced as 1.
// The per-account state below lives on globalThis for the same reason: what it
// protects is the process.
//
// Bounded length: at most MAX_WAITING_TASKS tasks wait behind the running one;
// the next is refused at once with "imageBusy" instead of piling up (measured:
// a 19 ms JPEG waited 4.3 s behind 5 heavy AVIFs and 17.6 s behind 20).
export const MAX_WAITING_TASKS = 8;

// THE SHARE OF AN ACCOUNT. The queue bounds the process, not WHO fills it: nine
// simultaneous sends of ONE account filled it (1 + 8) and every other account
// received "imageBusy" (proved by the audit). What costs is decoder TIME, not the
// number of requests, so two things are bounded per account, by the identifier the
// session resolved (never a form field: the caller passes what the role/session guard
// returned):
//  1. AT MOST ONE TASK in the queue, waiting or running (`imageInProgress`, refused at
//     once). A person sends a photo, waits, sends the next; a second one while the first
//     has not finished is a loop or a second tab.
//  2. A BUDGET OF DECODE TIME: the sum of the real durations spent in the child, from the
//     start of the task (the child ready) to its end, kill included, over a sliding hour,
//     capped at DECODE_BUDGET_MS. Beyond it a task is refused BEFORE it enters the queue
//     (`imageQuota`, with the delay in minutes). The check happens at admission, so a task
//     admitted just under the budget may end well past it (by one task, 20 s at most): the
//     budget is a threshold of admission, not a ceiling on the sum. Calibrated on the
//     legitimate side, not on a request count: a 40-tool inventory taken on a phone and a
//     session of 20 bulletin scans (40 decodes) spend about 3 s of decoder each on a 12 Mpx
//     phone photo (tests/image-account-share-real.test.ts, Windows, not the VPS), against 300 s;
//     a bomb killed at the 20 s deadline costs 20 s, so 15 of them in an hour end it.
// Costs nothing: size, signature and JS refusals (they never reach the queue), and
// `imageBusy`, `imageInProgress`, `imageQuota` themselves. Costs: a decode that succeeded,
// failed or was killed, AT LEAST DECODE_MIN_COST_MS. A child that could not START ran
// nothing: `imageUnavailable` costs nothing either.
// The check and the reservation are ONE synchronous step (no `await` between them): two
// requests of one account cannot both observe "free".
//
// THE ACCOUNTING IS BOUNDED. A ledger is one slot per MINUTE (at most 60 live per account,
// with a running total), and a task costs at least 250 ms: a cheap task (a refusal after the
// header read costs well under a millisecond) used to add an interval each, and an account
// could pile up ~716,000 of them in an hour (measured: 16.8 ms of synchronous time per call for
// ANOTHER account, 74 MB of heap). With the floor, an account is bounded to
// DECODE_BUDGET_MS / DECODE_MIN_COST_MS = 1,200 tasks per hour, which also bounds what it can
// send down the decoded paths. Expired minutes are dropped for the caller at each access, and
// the other accounts are swept at most once a minute (the sweep walks accounts, not intervals).
export const DECODE_BUDGET_MS = 300_000;
export const DECODE_BUDGET_WINDOW_MINUTES = 60;
export const DECODE_BUDGET_WINDOW_MS = DECODE_BUDGET_WINDOW_MINUTES * 60_000;
export const DECODE_MIN_COST_MS = 250;

type QueueState = { active: boolean; waiting: Array<() => void> };
/** What an account spent in one minute (`minute` = Date.now() / 60000, floored), in ms. */
type Bucket = { minute: number; ms: number };
type Ledger = { buckets: Bucket[]; total: number };
type AccountState = { queued: Set<string>; spent: Map<string, Ledger>; sweptMinute: number };

const QUEUE_KEY = Symbol.for("fullstack-starter.imageMetadata.queue");
const ACCOUNTS_KEY = Symbol.for("fullstack-starter.imageMetadata.accounts");

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

function isAccountState(value: unknown): value is AccountState {
    return (
        typeof value === "object" &&
        value !== null &&
        "queued" in value &&
        value.queued instanceof Set &&
        "spent" in value &&
        value.spent instanceof Map &&
        "sweptMinute" in value &&
        typeof value.sweptMinute === "number"
    );
}

function sharedQueue(): QueueState {
    const existing: unknown = Reflect.get(globalThis, QUEUE_KEY);
    if (isQueueState(existing)) return existing;
    const created: QueueState = { active: false, waiting: [] };
    Reflect.set(globalThis, QUEUE_KEY, created);
    return created;
}

function sharedAccounts(): AccountState {
    const existing: unknown = Reflect.get(globalThis, ACCOUNTS_KEY);
    if (isAccountState(existing)) return existing;
    const created: AccountState = { queued: new Set(), spent: new Map(), sweptMinute: 0 };
    Reflect.set(globalThis, ACCOUNTS_KEY, created);
    return created;
}

const minuteOf = (time: number): number => Math.floor(time / 60_000);

/** Drops the minutes of `ledger` that left the window (oldest first, the ledger is in minute order). */
function expire(ledger: Ledger, nowMinute: number): void {
    let oldest = ledger.buckets[0];
    while (oldest && oldest.minute <= nowMinute - DECODE_BUDGET_WINDOW_MINUTES) {
        ledger.total -= oldest.ms;
        ledger.buckets.shift();
        oldest = ledger.buckets[0];
    }
}

/** At most once a minute, drops what left the window for EVERY account and forgets the empty ones: nothing grows for an account that never comes back. */
function sweepInactive(accounts: AccountState, nowMinute: number): void {
    if (accounts.sweptMinute === nowMinute) return;
    accounts.sweptMinute = nowMinute;
    for (const [owner, ledger] of accounts.spent) {
        expire(ledger, nowMinute);
        if (ledger.buckets.length === 0) accounts.spent.delete(owner);
    }
}

/** The quota refusal of a ledger already expired (its delay in minutes: when enough of its oldest minutes have left the window), or null while the account has budget left. */
function quotaRefusal(ledger: Ledger | undefined, nowMinute: number): ImageRefusal | null {
    if (!ledger || ledger.total < DECODE_BUDGET_MS) return null;
    let remaining = ledger.total;
    let leaving = 0;
    for (const [index, bucket] of ledger.buckets.entries()) {
        remaining -= bucket.ms;
        leaving = bucket.minute;
        if (remaining < DECODE_BUDGET_MS || index === ledger.buckets.length - 1) break;
    }
    return { type: "error", code: "imageQuota", minutes: Math.max(1, leaving + DECODE_BUDGET_WINDOW_MINUTES - nowMinute) };
}

/** Adds the real duration of a task that ran in the child (never less than DECODE_MIN_COST_MS) to the account's current minute. */
function recordDecodeTime(owner: string, measuredMs: number): void {
    const accounts = sharedAccounts();
    const ms = Math.max(DECODE_MIN_COST_MS, Math.round(measuredMs));
    const minute = minuteOf(Date.now());
    const ledger = accounts.spent.get(owner) ?? { buckets: [], total: 0 };
    const last = ledger.buckets[ledger.buckets.length - 1];
    if (last && last.minute === minute) last.ms += ms;
    else ledger.buckets.push({ minute, ms });
    ledger.total += ms;
    accounts.spent.set(owner, ledger);
}

/**
 * The cheap half of the admission, ONE synchronous step: refuses `imageInProgress` or
 * `imageQuota`, or RESERVES the account's place (nothing has been parsed yet: this comes
 * before the JS walk of a 10 MB file). The caller must `enqueue` or `release`.
 */
function reserve(owner: string): ImageRefusal | null {
    const accounts = sharedAccounts();
    if (accounts.queued.has(owner)) return refusal("imageInProgress");
    const nowMinute = minuteOf(Date.now());
    sweepInactive(accounts, nowMinute);
    const ledger = accounts.spent.get(owner);
    if (ledger) expire(ledger, nowMinute);
    const quota = quotaRefusal(ledger, nowMinute);
    if (quota) return quota;
    accounts.queued.add(owner);
    return null;
}

function release(owner: string): void {
    sharedAccounts().queued.delete(owner);
}

function startNext(queue: QueueState): void {
    const next = queue.waiting.shift();
    if (next) {
        next();
    } else {
        queue.active = false;
    }
}

/** The queue itself, for an account that already holds its reservation: refused `imageBusy` when full (the place is given back). */
function enqueue<T>(owner: string, task: () => Promise<T>): Promise<T> {
    const queue = sharedQueue();
    if (queue.active && queue.waiting.length >= MAX_WAITING_TASKS) {
        release(owner);
        return Promise.reject(refusal("imageBusy"));
    }
    const run = (): Promise<T> =>
        new Promise<T>((resolve) => resolve(task())).finally(() => {
            release(owner);
            startNext(queue);
        });
    if (!queue.active) {
        queue.active = true;
        return run();
    }
    return new Promise<T>((resolve, reject) => {
        queue.waiting.push(() => {
            run().then(resolve, reject);
        });
    });
}

/**
 * The queue, with the share of an account in front of it. `owner` is REQUIRED (there is no
 * signature without it: a caller that forgets it does not compile) and is the account
 * identifier the role/session guard resolved. Refusals, in this order and all synchronous:
 * `imageInProgress`, `imageQuota`, `imageBusy`.
 */
export function runExclusive<T>(owner: string, task: () => Promise<T>): Promise<T> {
    const refused = reserve(owner);
    if (refused) return Promise.reject(refused);
    return enqueue(owner, task);
}

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

// The largest OUTPUT the application accepts from a decode: the GLOBAL, upper bound of every
// path. Each caller passes its own, lower or equal ceiling (EncodeLimits.maxOutputBytes: the
// storage's, lib/cloudinary.ts::STORAGE_MAX_FILE_BYTES, for the three paths that store), and
// the smaller of the two is asked of the child with every encode (the child refuses a larger
// output before sending it). A small PNG can come out of
// sharp enormous — 160 KB of identical rows, 12000x3333, came out as 114.6 MB in 3.5 s —
// and the company and equipment photos then go to Cloudinary. 32 MiB is more than twice
// the largest legitimate output measured: a 40 Mpx JPEG of 10 MB re-encoded at q95 gives
// 12.5 to 13.1 MB, an interlaced 40 Mpx PNG 4.0 MB, a noisy WebP 9.4 MB. One source: the
// parent. `png({ adaptiveFiltering })` is NOT used: on the interlaced 40 Mpx PNG it takes
// the output from 4.0 to 0.39 MB but the time from 0.55 to 1.17 s (2.1 times), above the
// 2 times accepted for it (docs/CONVENTIONS.md).
export const MAX_ENCODED_OUTPUT_BYTES = 32 * 1024 * 1024;

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

/** What the CALLER's destination takes, per path: the decode itself does not know where its output goes. */
export type EncodeLimits = {
    /** The long edge to resize to (the model path), or null to keep the dimensions. */
    maxLongEdge: number | null;
    /** The largest output the destination accepts; capped by MAX_ENCODED_OUTPUT_BYTES, the global bound. */
    maxOutputBytes: number;
    /**
     * The pixel count the output must fit in, or null. An image beyond it is REDUCED to fit, proportions
     * kept (see longEdgeToFit), never refused. Read from the header, so a resize is decided before anything is decoded.
     */
    fitInPixels: number | null;
};

/**
 * The limits of a path that STORES the image (company photo, equipment photo, bulletin archive): the
 * dimensions are kept unless the image is beyond what the storage takes, in which case it is reduced to
 * `fitInPixels` — a consequence of the storage plan (lib/cloudinary.ts), which cannot keep such an image
 * as it is anyway, and 25 Mpx stays very legible.
 */
export type StorageImageLimits = { maxOutputBytes: number; fitInPixels: number };

/**
 * The long edge that makes an image of this header fit in `fitInPixels`, proportions kept, or null when it already
 * fits. The long edge of the oriented image is the larger side whatever the EXIF orientation. One pixel is taken off
 * so that the rounding of the short side (sharp rounds it) cannot push the product over the ceiling.
 */
export function longEdgeToFit(header: ImageHeader, fitInPixels: number | null): number | null {
    const { width, height } = header;
    if (fitInPixels === null || !width || !height || width * height <= fitInPixels) return null;
    const scale = Math.sqrt(fitInPixels / (width * height));
    return Math.max(1, Math.floor(Math.max(width, height) * scale) - 1);
}

/** The smaller of two optional long edges. */
function smallerEdge(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
}

/**
 * The one decode of the application. `owner` is REQUIRED: the identifier of the account the
 * role/session guard resolved (never a form field). In this order:
 *  1. The share of the account, BEFORE anything is parsed (a cheap, synchronous step that
 *     reserves the account's place): `imageInProgress`, `imageQuota`. A 10 MB file of an
 *     account that is refused anyway is never walked.
 *  2. JS refusals, still before the queue and still synchronous (a refused file gives the
 *     place back, never answers `imageBusy` and costs the account nothing): the structure walk of
 *     lib/imageFrameCount.ts (images, pages, scans, entries; closed on formats nobody
 *     decodes), then the removal of the PNG text chunks (lib/pngTextChunks.ts: a 1-pixel PNG
 *     of 40 zTXt chunks inflates to 1.6 GB).
 *  3. Queued like every decode (at most MAX_WAITING_TASKS waiting, `imageBusy` beyond), in the
 *     decode child and under ONE deadline for the whole task (lib/imageDecodeBridge.ts): reads the
 *     header (nothing is decoded), refuses a decoded size beyond MAX_DECODED_BYTES BEFORE allocating
 *     anything, reduces an image beyond `limits.fitInPixels` to fit it, re-encodes with the
 *     orientation applied and without any metadata; the child refuses an output beyond
 *     `limits.maxOutputBytes` before sending it.
 *  4. The real duration spent in the child (the child ready, to the end of the task, a kill
 *     included, at least DECODE_MIN_COST_MS) is charged to the account's hour, whatever the outcome.
 *
 * Failures, never a native message and never a fallback that decodes in this process or
 * returns the original: `corruptedImage` (a structure that does not walk, a header beyond
 * the budget, a native error, a child that died during the task), `imageTooHeavy` (killed at the
 * deadline), `outputTooLarge`, and `imageUnavailable` when the child could not START (no task
 * ran: the decoder is down, the file is not at fault). The refusals of the share and the queue
 * (`imageInProgress`, `imageQuota`, `imageBusy`) keep their code.
 *
 * `failOn: "none"` is set in the child (its `open()` says why): one behavior for every
 * caller on purpose, the bulletin's image for the model included.
 */
export function encodeOriented(
    operation: DecodeOperation,
    owner: string,
    buffer: Buffer,
    output: EncodeOutput,
    limits: EncodeLimits
): Promise<Buffer> {
    const refused = reserve(owner);
    if (refused) return Promise.reject(refused);
    let input: Buffer;
    try {
        if (countImageFrames(buffer).kind !== "ok") {
            release(owner);
            return Promise.reject(refusal("corruptedImage"));
        }
        input = stripPngTextChunks(buffer);
    } catch (error) {
        release(owner);
        return Promise.reject(error);
    }
    const maxOutputBytes = Math.min(limits.maxOutputBytes, MAX_ENCODED_OUTPUT_BYTES);
    const outputTooLarge: ImageRefusal = { type: "error", code: "outputTooLarge", maxBytes: maxOutputBytes };
    return enqueue(owner, async () => {
        // Set when the child is READY and the task starts: null = nothing ran, nothing to charge.
        const ran: { startedAt: number | null } = { startedAt: null };
        try {
            return await runInChild(operation, async (session) => {
                ran.startedAt = performance.now();
                const header = await session.readHeader(input, SHARP_MAX_INPUT_PIXELS);
                assertDecodedSizeWithinBudget(header);
                const maxLongEdge = smallerEdge(limits.maxLongEdge, longEdgeToFit(header, limits.fitInPixels));
                const encoded = await session.encode(input, SHARP_MAX_INPUT_PIXELS, maxLongEdge, maxOutputBytes, output);
                // The child already refuses a larger output before sending it: this is depth, against a child that drifts.
                if (encoded.length > maxOutputBytes) throw outputTooLarge;
                return encoded;
            });
        } catch (error) {
            if (ran.startedAt === null) throw refusal("imageUnavailable");
            if (isImageRefusal(error)) throw error;
            if (isOutputTooLargeError(error)) throw outputTooLarge;
            throw refusal(isDecodeDeadlineError(error) ? "imageTooHeavy" : "corruptedImage");
        } finally {
            if (ran.startedAt !== null) recordDecodeTime(owner, performance.now() - ran.startedAt);
        }
    });
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
 * Two things happen, in order (in the decode child, scripts/image-decode-child.mjs):
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
 * decoded rather than refused (encodeOriented above).
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
 * `owner` is the account the role/session guard resolved (see encodeOriented), and
 * `limits` what the destination takes (output bytes, pixels): the callers pass
 * lib/cloudinary.ts's STORAGE_IMAGE_LIMITS. Throws `{ type: "error", code }` — one
 * of ImageRefusalCode, never a native error: `imageInProgress`, `imageQuota` and
 * `imageBusy` at once and for free, `imageUnavailable` when the decoder cannot start,
 * `outputTooLarge` / `imageTooManyPixels` for the destination's ceilings, and
 * `corruptedImage` if the image can't be processed — or the decoded size is
 * beyond MAX_DECODED_BYTES, or the task outlasts DECODE_DEADLINE_SECONDS and its
 * child is killed — structurally the same shape as
 * lib/deliveryNoteScan.ts's own ScanError (so its isScanError still
 * recognizes it, caught by actions/deliveryNoteScan/deliveryNoteScan.ts),
 * built as a plain literal here rather than imported: that module imports
 * THIS function, importing its error type back would be circular. Either
 * caller failing the whole request before any database write happens is the
 * point — never silently falling back to archiving/uploading the
 * un-cleaned original, which would quietly undo the product decision this
 * exists to apply.
 */
export function stripArchivedPhotoMetadata(
    owner: string,
    buffer: Buffer,
    mediaType: DeliveryNoteMediaType,
    limits: StorageImageLimits
): Promise<Buffer> {
    return encodeOriented("strip", owner, buffer, outputFor(mediaType), { maxLongEdge: null, ...limits });
}

function outputFor(mediaType: DeliveryNoteMediaType): EncodeOutput {
    if (mediaType === "image/jpeg") return { format: "jpeg", quality: ARCHIVE_JPEG_QUALITY };
    if (mediaType === "image/png") return { format: "png" };
    if (mediaType === "image/webp") return { format: "webp" };
    return { format: "gif" };
}

/**
 * AVIF and TIFF are not re-encoded in their own format here, but both decode:
 * this decodes, applies the orientation, and encodes a JPEG without any
 * metadata. Same pixel ceiling, same queue and share of the account, same refusal
 * shape as stripArchivedPhotoMetadata. Used by lib/cloudinary.ts::uploadClientPhoto
 * only; the equipment photo keeps refusing both formats.
 */
export function convertToStrippedJpeg(owner: string, buffer: Buffer, limits: StorageImageLimits): Promise<Buffer> {
    return encodeOriented("convert", owner, buffer, { format: "jpeg", quality: ARCHIVE_JPEG_QUALITY }, { maxLongEdge: null, ...limits });
}
