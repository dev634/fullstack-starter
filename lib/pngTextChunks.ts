// Removes the PNG text chunks (tEXt, zTXt, iTXt) before a file reaches the decode child.
//
// Why: a PNG of ONE pixel carrying 40 `zTXt` chunks is 1.5 MB, and each chunk inflates to
// 40 MB; libpng decompresses them all, the child went to 5.8 GB (measured on Windows)
// and succeeded. The application throws these chunks away anyway: it re-encodes without
// any metadata. Everything else is kept untouched, `iCCP` (colours) and `eXIf`
// (orientation, applied before the metadata is dropped) included.
//
// Pure: bytes in, bytes out. The CRC belongs to its own chunk, so nothing is recomputed.
// A structure that is cut or incoherent (a length running past the end) is copied as it
// is from there on: the decoder stops at the same place, and a truncated file is never
// refused for being truncated (`failOn: "none"`).

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// length (4) + type (4) + CRC (4)
const CHUNK_OVERHEAD = 12;

const FOURCC_TEXT = 0x74455874; // tEXt
const FOURCC_ZTXT = 0x7a545874; // zTXt
const FOURCC_ITXT = 0x69545874; // iTXt

function isTextChunk(fourcc: number): boolean {
  return fourcc === FOURCC_TEXT || fourcc === FOURCC_ZTXT || fourcc === FOURCC_ITXT;
}

/** `buffer` without its tEXt / zTXt / iTXt chunks; the same buffer when it is not a PNG or has none. */
export function stripPngTextChunks(buffer: Buffer): Buffer {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return buffer;
  }
  const kept: Buffer[] = [];
  let keptFrom = 0; // start of the run of bytes not yet pushed
  let dropped = false;
  let pos = PNG_SIGNATURE.length;
  while (pos + CHUNK_OVERHEAD <= buffer.length) {
    const next = pos + CHUNK_OVERHEAD + buffer.readUInt32BE(pos);
    // A length that runs past the end: the rest is copied as it is.
    if (next > buffer.length) break;
    if (isTextChunk(buffer.readUInt32BE(pos + 4))) {
      kept.push(buffer.subarray(keptFrom, pos));
      keptFrom = next;
      dropped = true;
    }
    pos = next;
  }
  if (!dropped) return buffer;
  kept.push(buffer.subarray(keptFrom));
  return Buffer.concat(kept);
}
