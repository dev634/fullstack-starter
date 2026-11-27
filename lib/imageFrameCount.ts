// Counts the images (GIF, animated WebP) or pages (TIFF) a file DECLARES, in JS,
// before sharp sees it. Nothing is decoded: the walk only follows the container's
// own structure (block sizes, chunk sizes, IFD offsets), so its cost is linear in
// the bytes and measured at a few ms on 10 MB (tests/image-frame-count.test.ts).
//
// Why it exists: the 10 s timeout of lib/imageMetadata.ts does not bound a task.
// `metadata()` has no timeout and libvips walks every frame of a GIF in one native
// call, at a cost that grows FASTER than the frame count (measured on Windows, one
// 2x1 frame = 15 bytes: 10,000 frames 5 ms, 50,000 frames 221 ms, 100,000 frames
// 1.1 s, 200,000 frames 4.5 s; the audit's 10 MB / 690,000 frames file: 60 s in
// `metadata()`, 119 s in all, then success). Only the byte count is bounded
// upstream (10 MB), and a frame costs 15 bytes.
//
// This module must NOT import sharp (tests/runtime-dependencies.test.ts: lib/
// imageMetadata.ts is the only importer) and is pure: bytes in, verdict out.

// MAX_IMAGE_FRAMES = 10,000, chosen on the measurement above:
//  - it bounds `metadata()` at ~5 ms here (GIF, 15-byte frames), 200x under the
//    one-second target, which leaves room for a slower Linux VPS that has NOT been
//    measured (the production image measurement is the open point, see
//    docs/CONVENTIONS.md);
//  - it refuses no real photo: a photo is ONE image/page, and an animated avatar
//    GIF carries a few hundred frames at most (a 30 fps clip of a full minute is
//    1,800). The same cap on pages is far above any scanned TIFF handed to a
//    construction-site app;
//  - past ~70,000 the superlinear cost makes `metadata()` alone approach a second,
//    so the cap sits well inside the flat part of the curve.
// It bounds the NUMBER of frames, not frames x pixels: see the limits in
// docs/CONVENTIONS.md.
export const MAX_IMAGE_FRAMES = 10_000;

export type FrameCount =
  | { kind: "ok"; frames: number }
  // More than `limit` images / pages: refused without reading further.
  | { kind: "tooMany" }
  // The structure does not walk cleanly (truncated, bad block, loop, offset
  // outside the file): refused like a corrupted header.
  | { kind: "invalid" };

const INVALID: FrameCount = { kind: "invalid" };
const TOO_MANY: FrameCount = { kind: "tooMany" };

function ok(frames: number): FrameCount {
  return { kind: "ok", frames };
}

// --- GIF ---------------------------------------------------------------------

/** Position after the sub-blocks starting at `pos` (size byte, data, ..., 0 terminator), or -1 if cut short. */
function skipGifSubBlocks(buffer: Buffer, start: number): number {
  let pos = start;
  while (pos < buffer.length) {
    const size = buffer.readUInt8(pos);
    pos += 1 + size;
    if (size === 0) return pos <= buffer.length ? pos : -1;
  }
  return -1;
}

/** Bytes of a GIF colour table announced by a packed field (flag 0x80, size bits 0x07), 0 when absent. */
function gifColorTableBytes(packed: number): number {
  return (packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
}

function countGif(buffer: Buffer, limit: number): FrameCount {
  // Header (6) + logical screen descriptor (7).
  if (buffer.length < 13) return INVALID;
  let pos = 13 + gifColorTableBytes(buffer.readUInt8(10));
  let frames = 0;
  while (pos < buffer.length) {
    const block = buffer.readUInt8(pos);
    if (block === 0x3b) return frames > 0 ? ok(frames) : INVALID;
    if (block === 0x21) {
      // Extension: introducer, label, then sub-blocks.
      pos = skipGifSubBlocks(buffer, pos + 2);
    } else if (block === 0x2c) {
      // Image descriptor (10 bytes), local colour table, LZW minimum code size, sub-blocks.
      if (pos + 10 > buffer.length) return INVALID;
      pos += 10 + gifColorTableBytes(buffer.readUInt8(pos + 9)) + 1;
      pos = skipGifSubBlocks(buffer, pos);
      frames += 1;
      if (frames > limit) return TOO_MANY;
    } else {
      return INVALID;
    }
    if (pos < 0) return INVALID;
  }
  // The file ends exactly on a block boundary without its 0x3B trailer: a transfer
  // cut between two frames (failOn "none" exists for such files). Accepted only
  // when something was walked; a cut INSIDE a block is refused above.
  return frames > 0 ? ok(frames) : INVALID;
}

// --- WebP --------------------------------------------------------------------

function countWebp(buffer: Buffer, limit: number): FrameCount {
  if (buffer.length < 12) return INVALID;
  const end = buffer.readUInt32LE(4) + 8;
  if (end > buffer.length) return INVALID;
  let pos = 12;
  let frames = 0;
  while (pos < end) {
    if (pos + 8 > end) return INVALID;
    const size = buffer.readUInt32LE(pos + 4);
    if (pos + 8 + size > end) return INVALID;
    if (buffer.toString("latin1", pos, pos + 4) === "ANMF") {
      frames += 1;
      if (frames > limit) return TOO_MANY;
    }
    // Chunks are padded to an even size; the pad byte of the last one may be missing.
    pos += 8 + size + (size & 1);
  }
  // A still image has no ANMF: one image.
  return ok(Math.max(frames, 1));
}

// --- TIFF --------------------------------------------------------------------

function countTiff(buffer: Buffer, limit: number): FrameCount {
  if (buffer.length < 8) return INVALID;
  const littleEndian = buffer.toString("latin1", 0, 2) === "II";
  const read16 = (at: number): number => (littleEndian ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const read32 = (at: number): number => (littleEndian ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  // The signature sniffer (lib/fileSignature.ts) only admits classic TIFF (42): a
  // BigTIFF (43) or anything else is not walked, hence refused.
  if (read16(2) !== 42) return INVALID;
  const seen = new Set<number>();
  let offset = read32(4);
  let pages = 0;
  while (offset !== 0) {
    // Loop guard: an IFD chain that comes back to an IFD already walked never ends.
    if (seen.has(offset)) return INVALID;
    seen.add(offset);
    if (offset + 2 > buffer.length) return INVALID;
    const entries = read16(offset);
    const nextAt = offset + 2 + entries * 12;
    if (nextAt + 4 > buffer.length) return INVALID;
    pages += 1;
    if (pages > limit) return TOO_MANY;
    offset = read32(nextAt);
  }
  return pages > 0 ? ok(pages) : INVALID;
}

// --- Entry point -------------------------------------------------------------

/**
 * How many images / pages `buffer` declares, read from its container structure,
 * stopping as soon as `limit` is passed. GIF, WebP and TIFF are walked (detected
 * by their own magic bytes, as sharp does, not by the declared type); any other
 * format is ONE image here: JPEG, PNG and BMP hold one, and AVIF / HEIF are not
 * walked (see docs/CONVENTIONS.md: sharp reads only the primary image of those).
 */
export function countImageFrames(buffer: Buffer, limit: number = MAX_IMAGE_FRAMES): FrameCount {
  const magic = buffer.toString("latin1", 0, 4);
  if (magic === "GIF8") return countGif(buffer, limit);
  if (magic === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return countWebp(buffer, limit);
  if (magic === "II*\u0000" || magic === "MM\u0000*") return countTiff(buffer, limit);
  // BigTIFF magic ("II+\0" / "MM\0+"): not a classic TIFF, not walked.
  if (magic === "II+\u0000" || magic === "MM\u0000+") return INVALID;
  return ok(1);
}
