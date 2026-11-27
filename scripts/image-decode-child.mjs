// @ts-check
// The ONLY place the application imports sharp. Started by lib/imageDecodeBridge.ts
// (through /bin/sh with a memory limit on Linux) and KILLED (SIGKILL) when a task outlasts its deadline: what bounds a decode is
// the death of this process, not a timeout inside libvips (a JPEG of 3,529 progressive
// scans is absorbed by one native call, `jpeg_start_decompress`, that no JS check
// and no `.timeout()` ever sees).
//
// Plain JavaScript ESM, executable directly by `node` — no `tsx`, no build step —
// shipped by the Dockerfile like scripts/retype-existing-guarded-assets.mjs. It
// imports nothing but sharp (tests/image-decode-bridge.test.ts reads its source;
// tests/runtime-dependencies.test.ts reads the shipped scripts from the Dockerfile and
// checks that sharp is imported by this file alone).
//
// A CLOSED executor: two operations, `metadata` and `encode`, whose request is
// validated key by key; anything else is refused with a code, never executed.
// It never answers with a native message (those can name internals): the parent
// only learns "invalidRequest" or "decodeFailed", the native message goes to this
// process's own stderr, which the container logs.
//
// Policy lives in the PARENT (lib/imageMetadata.ts): the pixel ceiling, the
// decoded-bytes budget, the qualities and the long edge arrive with each request.
// What is fixed here is how the decoder is OPENED (`failOn: "none"`, sequential
// read), because it has no other source.
//
// This is a bound on time and memory, NOT a confinement: same user as the server (see
// the header of lib/imageDecodeBridge.ts).
//
// Wire contract (kept in step with lib/imageDecodeBridge.ts, proved by
// tests/image-decode-bridge.test.ts):
//   in : { id, op: "metadata", input, limitInputPixels }
//        { id, op: "encode", input, limitInputPixels, maxLongEdge | null, maxOutputBytes,
//          output: { format: "jpeg", quality } | { format: "png" | "webp" | "gif" } }
//   out: { type: "ready" }                                  once, after sharp is loaded
//        { type: "result", id, ok: true, header }            metadata
//        { type: "result", id, ok: true, output }            encode
//        { type: "result", id, ok: false, reason }   reason: invalidRequest | decodeFailed | outputTooLarge
//   `maxOutputBytes`: an output beyond it is NOT sent (reason "outputTooLarge"): a 160 KB PNG
//   of identical rows came out of sharp as 114.6 MB, which would then cross the channel and
//   go to Cloudinary.

import sharp from "sharp";

// libvips keeps every decoded image in its operation cache and nothing here decodes
// the same buffer twice: the cache only retains memory (20 decodes of a 6000x6600
// GIF held ~3 GB with it, ~47 MB without — measured on Windows).
sharp.cache(false);
// The VPS has two cores shared with the web server and the database: the decoder
// takes one (the calibration of the deadline was measured on a single CPU).
sharp.concurrency(1);

const OUTPUT_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);
// sharp's own default input-pixel limit (~268 Mpx): nothing above it is ever asked for.
const MAX_LIMIT_INPUT_PIXELS = 268_402_689;
const MAX_LONG_EDGE = 20_000;
// A sanity bound on what the parent may ask for (its policy constant is far below).
const MAX_OUTPUT_BYTES_LIMIT = 1_073_741_824;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {string[]} keys */
function hasExactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/** @param {unknown} value @param {number} min @param {number} max @returns {value is number} */
function isIntegerBetween(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * @typedef {{ format: "jpeg"; quality: number } | { format: "png" | "webp" | "gif" }} Output
 * @typedef {{ id: number; op: "metadata"; input: Uint8Array; limitInputPixels: number }} MetadataRequest
 * @typedef {{ id: number; op: "encode"; input: Uint8Array; limitInputPixels: number; maxLongEdge: number | null; maxOutputBytes: number; output: Output }} EncodeRequest
 */

/** @param {unknown} output @returns {output is Output} */
function isOutput(output) {
  if (!isRecord(output) || typeof output.format !== "string" || !OUTPUT_FORMATS.has(output.format)) return false;
  if (output.format === "jpeg") return hasExactKeys(output, ["format", "quality"]) && isIntegerBetween(output.quality, 1, 100);
  return hasExactKeys(output, ["format"]);
}

/**
 * Strict shape check. Returns the typed request, or null for anything that is not
 * exactly one of the two operations (unknown key, unknown op, wrong type, bound).
 * @param {unknown} message
 * @returns {MetadataRequest | EncodeRequest | null}
 */
function parseRequest(message) {
  if (!isRecord(message)) return null;
  const { id, op, input, limitInputPixels } = message;
  if (!isIntegerBetween(id, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!(input instanceof Uint8Array) || input.length === 0) return null;
  if (!isIntegerBetween(limitInputPixels, 1, MAX_LIMIT_INPUT_PIXELS)) return null;
  if (op === "metadata") {
    if (!hasExactKeys(message, ["id", "op", "input", "limitInputPixels"])) return null;
    return { id, op, input, limitInputPixels };
  }
  if (op === "encode") {
    if (!hasExactKeys(message, ["id", "op", "input", "limitInputPixels", "maxLongEdge", "maxOutputBytes", "output"])) return null;
    const { maxLongEdge, maxOutputBytes, output } = message;
    if (maxLongEdge !== null && !isIntegerBetween(maxLongEdge, 1, MAX_LONG_EDGE)) return null;
    if (!isIntegerBetween(maxOutputBytes, 1, MAX_OUTPUT_BYTES_LIMIT)) return null;
    if (!isOutput(output)) return null;
    return { id, op, input, limitInputPixels, maxLongEdge, maxOutputBytes, output };
  }
  return null;
}

/**
 * `failOn: "none"`: sharp's default refuses a JPEG that merely lacks its end-of-image
 * bytes or is cut short by an interrupted transfer, files Cloudinary used to accept.
 * A header that is really corrupted is still refused whatever `failOn` says.
 * @param {Uint8Array} input @param {number} limitInputPixels
 */
function open(input, limitInputPixels) {
  return sharp(input, { limitInputPixels, sequentialRead: true, failOn: "none" });
}

/** @param {MetadataRequest} request */
async function readHeader(request) {
  const { format, width, height, channels, depth } = await open(request.input, request.limitInputPixels).metadata();
  return { format, width, height, channels, depth };
}

/** @param {EncodeRequest} request @returns {Promise<Buffer>} */
async function encode(request) {
  // Orientation first, THEN the metadata is dropped (never `.withMetadata()`): stripping
  // the tag without applying it would hand back every portrait photo lying on its side.
  let pipeline = open(request.input, request.limitInputPixels).rotate();
  if (request.maxLongEdge !== null) {
    pipeline = pipeline.resize({
      width: request.maxLongEdge,
      height: request.maxLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { output } = request;
  if (output.format === "jpeg") return pipeline.jpeg({ quality: output.quality }).toBuffer();
  if (output.format === "png") return pipeline.png().toBuffer();
  if (output.format === "webp") return pipeline.webp().toBuffer();
  return pipeline.gif().toBuffer();
}

/** @param {unknown} message */
function send(message) {
  if (process.send) process.send(message);
}

process.on("message", async (message) => {
  const request = parseRequest(message);
  if (request === null) {
    const id = isRecord(message) && isIntegerBetween(message.id, 0, Number.MAX_SAFE_INTEGER) ? message.id : -1;
    // The bridge only sends well-formed requests: this is a bug on its side. Keys only, never values.
    console.error("[image-decode-child] invalid request, keys:", isRecord(message) ? Object.keys(message).join(",") : typeof message);
    send({ type: "result", id, ok: false, reason: "invalidRequest" });
    return;
  }
  try {
    if (request.op === "metadata") {
      send({ type: "result", id: request.id, ok: true, header: await readHeader(request) });
    } else {
      const output = await encode(request);
      // Refused BEFORE sending: the channel never carries more than the parent accepts.
      if (output.length > request.maxOutputBytes) {
        send({ type: "result", id: request.id, ok: false, reason: "outputTooLarge" });
      } else {
        send({ type: "result", id: request.id, ok: true, output });
      }
    }
  } catch (error) {
    console.error(`[image-decode-child] ${request.op} failed:`, error instanceof Error ? error.message : "unknown error");
    send({ type: "result", id: request.id, ok: false, reason: "decodeFailed" });
  }
});

// The parent is gone (or let go of the channel): nothing left to serve.
process.on("disconnect", () => process.exit(0));

send({ type: "ready" });
