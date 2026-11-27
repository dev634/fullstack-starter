import { detectRasterImageMediaType } from "@/lib/fileSignature";

// Early refusals, in JS, of the amplifiers of a decode that are KNOWN: the progressive
// scans of a JPEG, the frames of a GIF or an animated WebP, the pages and tags of a
// TIFF. Nothing is decoded: the walk only follows the container's own structure
// (segment lengths, block sizes, chunk sizes, IFD offsets), linear in the bytes, a few
// ms on 10 MB (tests/image-frame-count.test.ts).
//
// What this module does NOT do is bound a task. It cannot: every amplifier it closes
// was found by someone who then found the next one (two audits, two bypasses of the
// counts below, and unexplored: HEIF grids, AVIF sequences, EXIF sub-IFDs). What bounds
// a task is the child process of lib/imageDecodeBridge.ts, killed at its deadline;
// these checks only turn the known cases from "20 s then killed" into "refused in a
// few ms, nothing started".
//
// Closed by default on what it does not know: the format is classified by the one
// detector of the application, lib/fileSignature.ts::detectRasterImageMediaType. PNG
// and AVIF are one image (the deadline bounds them); HEIC, BMP and anything unknown
// are `invalid`, because no path of the application decodes them (sharp's prebuilt
// libvips has no HEVC decoder and no BMP loader), so refusing them here costs nothing
// that worked.
//
// This module must NOT import sharp (tests/runtime-dependencies.test.ts) and is pure:
// bytes in, verdict out.

// A GIF costs libvips more than linearly in its frames, in ONE native call
// (`metadata()`), which no timeout of sharp interrupts. Measured on Windows, a GIF of
// 2x1 frames of 15 bytes: 10,000 frames 5 ms, 50,000 frames 221 ms, 100,000 frames
// 1.1 s, 200,000 frames 4.5 s; a 10 MB file of 690,000 frames: 60 s in `metadata()`.
// 10,000 keeps it ~200 times under a second and refuses no real file: an animated
// avatar carries a few hundred frames, a 30 fps clip of a minute is 1,800.
export const MAX_GIF_FRAMES = 10_000;

// Only the first image is ever used (an animated WebP is reduced to its first frame),
// so the cap only has to keep `metadata()` cheap.
export const MAX_WEBP_FRAMES = 1_000;

// Only page 0 of a TIFF is used, and a scan of a document is one to a few pages. The
// pages x tags product is what costs: 100 pages of 4,000 tags (4.8 MB) spent 28 s in
// `metadata()`, hence the two entry bounds next to it.
export const MAX_TIFF_PAGES = 100;
export const MAX_TIFF_ENTRIES_PER_IFD = 256;
export const MAX_TIFF_ENTRIES_TOTAL = 4_096;

// A progressive JPEG is absorbed whole by `jpeg_start_decompress`, scan after scan:
// libjpeg's default script emits 10 for three components, mozjpeg a dozen; the file
// of the audit had 3,529 (525 KB, 33.5 s in the production image).
export const MAX_JPEG_SCANS = 100;

export type FrameCount =
  | { kind: "ok"; frames: number }
  // More images / pages / scans / entries than the cap of its format: refused without reading further.
  | { kind: "tooMany" }
  // Not walkable, or a format no path decodes: refused like a corrupted header.
  | { kind: "invalid" };

const INVALID: FrameCount = { kind: "invalid" };
const TOO_MANY: FrameCount = { kind: "tooMany" };

function ok(frames: number): FrameCount {
  return { kind: "ok", frames };
}

// --- JPEG --------------------------------------------------------------------

// Walks the file with libjpeg's OWN resynchronisation (jdmarker.c::next_marker),
// not with a stricter reading of the standard: a scan that libjpeg finds behind stray
// bytes must be counted here too, or the cap is a decoration. Between segments, bytes
// that are not 0xFF are skipped; 0xFF bytes repeat freely (fill bytes); `FF 00` is a
// stuffed zero and is skipped; anything else after `FF` is a marker. The same rule
// ends the entropy-coded data after a SOS (jdhuff.c::fill_bit_buffer), so one loop is
// the whole walk: the data of a scan is "bytes until the next marker". A restart
// marker inside it is a marker without a length and changes nothing.
//
// A file that is cut, or whose structure stops making sense, is NOT refused for it:
// `failOn: "none"` decodes what is decodable (an interrupted transfer is a real
// upload). The walk stops there and returns the scans seen so far.
function countJpeg(buffer: Buffer): FrameCount {
  const end = buffer.length;
  let pos = 2; // past SOI (the signature sniffer saw FF D8 FF)
  let scans = 0;
  while (pos < end) {
    // A plain loop, not indexOf: entropy-coded data is full of `FF 00` pairs, and a call
    // per pair costs 5x more (10 MB of them: 179 ms against ~15 ms).
    let at = pos;
    while (at < end && buffer[at] !== 0xff) at += 1;
    at += 1;
    while (at < end && buffer[at] === 0xff) at += 1;
    if (at >= end) break;
    const marker = buffer[at];
    pos = at + 1;
    if (marker === 0x00) continue; // stuffed zero
    if (marker === 0xd9) break; // EOI
    // Markers without a length: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xda) {
      scans += 1;
      if (scans > MAX_JPEG_SCANS) return TOO_MANY;
    }
    if (pos + 2 > end) break;
    pos += Math.max(buffer.readUInt16BE(pos), 2);
  }
  return ok(1);
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

// Once one image is complete, whatever follows that is not a walkable block (an
// unknown block, a cut, stray bytes where the 0x3B trailer should be) is the END of
// the file: a GIF cut by an interrupted transfer is a real upload, and the first image
// is the one that is kept. An image whose descriptor was read but whose data is cut
// counts as one more. With no complete image there is nothing to keep: invalid.
function countGif(buffer: Buffer): FrameCount {
  // Header (6) + logical screen descriptor (7).
  if (buffer.length < 13) return INVALID;
  let pos = 13 + gifColorTableBytes(buffer.readUInt8(10));
  let frames = 0;
  const ended = (cutImageStarted: boolean): FrameCount => {
    if (frames === 0) return INVALID;
    const total = frames + (cutImageStarted ? 1 : 0);
    return total > MAX_GIF_FRAMES ? TOO_MANY : ok(total);
  };
  while (pos < buffer.length) {
    const block = buffer.readUInt8(pos);
    if (block === 0x3b) return ended(false);
    if (block === 0x21) {
      // Extension: introducer, label, then sub-blocks.
      pos = skipGifSubBlocks(buffer, pos + 2);
      if (pos < 0) return ended(false);
    } else if (block === 0x2c) {
      // Image descriptor (10 bytes), local colour table, LZW minimum code size, sub-blocks.
      if (pos + 10 > buffer.length) return ended(true);
      pos += 10 + gifColorTableBytes(buffer.readUInt8(pos + 9)) + 1;
      pos = pos <= buffer.length ? skipGifSubBlocks(buffer, pos) : -1;
      if (pos < 0) return ended(true);
      frames += 1;
      if (frames > MAX_GIF_FRAMES) return TOO_MANY;
    } else {
      return ended(false);
    }
  }
  // The file ends exactly on a block boundary without its trailer.
  return ended(false);
}

// --- WebP --------------------------------------------------------------------

// FourCCs compared as one big-endian word, not decoded to a string per chunk: a file
// of 10 MB of empty `JUNK` chunks is 1.3 million of them.
const FOURCC_ANMF = 0x414e4d46;

function countWebp(buffer: Buffer): FrameCount {
  if (buffer.length < 12) return INVALID;
  const end = buffer.readUInt32LE(4) + 8;
  if (end > buffer.length) return INVALID;
  let pos = 12;
  let frames = 0;
  while (pos < end) {
    if (pos + 8 > end) return INVALID;
    const size = buffer.readUInt32LE(pos + 4);
    if (pos + 8 + size > end) return INVALID;
    if (buffer.readUInt32BE(pos) === FOURCC_ANMF) {
      frames += 1;
      if (frames > MAX_WEBP_FRAMES) return TOO_MANY;
    }
    // Chunks are padded to an even size; the pad byte of the last one may be missing.
    pos += 8 + size + (size & 1);
  }
  // A still image has no ANMF: one image.
  return ok(Math.max(frames, 1));
}

// --- TIFF --------------------------------------------------------------------

// A pointer to the next IFD that leaves the file ends the chain, AFTER the first IFD:
// the first image is the one that is kept, and a transfer cut in the later pages is a
// real upload. A first IFD outside the file is not a TIFF at all.
function countTiff(buffer: Buffer): FrameCount {
  if (buffer.length < 8) return INVALID;
  const littleEndian = buffer[0] === 0x49;
  const read16 = (at: number): number => (littleEndian ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const read32 = (at: number): number => (littleEndian ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  // The signature sniffer (lib/fileSignature.ts) admits only classic TIFF ("II*\0" /
  // "MM\0*", whose version word is 42): BigTIFF has another magic and is `invalid` there.
  const seen = new Set<number>();
  let offset = read32(4);
  let pages = 0;
  let entriesTotal = 0;
  while (offset !== 0) {
    // Loop guard: an IFD chain that comes back to an IFD already walked never ends.
    if (seen.has(offset)) return INVALID;
    seen.add(offset);
    if (offset + 2 > buffer.length) return pages > 0 ? ok(pages) : INVALID;
    const entries = read16(offset);
    if (entries > MAX_TIFF_ENTRIES_PER_IFD) return TOO_MANY;
    entriesTotal += entries;
    if (entriesTotal > MAX_TIFF_ENTRIES_TOTAL) return TOO_MANY;
    const nextAt = offset + 2 + entries * 12;
    if (nextAt + 4 > buffer.length) return pages > 0 ? ok(pages) : INVALID;
    pages += 1;
    if (pages > MAX_TIFF_PAGES) return TOO_MANY;
    offset = read32(nextAt);
  }
  return pages > 0 ? ok(pages) : INVALID;
}

// --- Entry point -------------------------------------------------------------

/**
 * What a decode of `buffer` would have to walk — images (GIF, animated WebP), pages
 * (TIFF) or progressive scans (JPEG) — read from the container structure, with the cap
 * of each format. The format comes from the application's one detector, never from the
 * declared type. PNG and AVIF count for one image; HEIC, BMP and anything unrecognised
 * are `invalid`.
 */
export function countImageFrames(buffer: Buffer): FrameCount {
  switch (detectRasterImageMediaType(buffer)) {
    case "image/jpeg":
      return countJpeg(buffer);
    case "image/gif":
      return countGif(buffer);
    case "image/webp":
      return countWebp(buffer);
    case "image/tiff":
      return countTiff(buffer);
    case "image/png":
    case "image/avif":
      return ok(1);
    case "image/heic":
    case "image/bmp":
    case null:
      return INVALID;
  }
}
