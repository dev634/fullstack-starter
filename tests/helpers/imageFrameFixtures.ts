// Files built byte by byte for the frame / page counter (lib/imageFrameCount.ts).
// No sharp here: the counter must be testable without it, and
// tests/image-refused-before-child.test.ts replaces the decode child with a spy.

/**
 * A GIF of `frames` images of 2x1 pixels (15 bytes each, LZW data included), global colour
 * table of 2 entries. A real file: sharp decodes it (first frame) when it is allowed to.
 */
export function gifOfFrames(frames: number, options: { trailer?: boolean } = {}): Buffer {
  const header = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    2, 0, 1, 0, 0x80, 0, 0, // logical screen 2x1, global colour table of 2 entries
    0, 0, 0, 255, 255, 255, // the table
  ]);
  const frame = Buffer.from([
    0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, // image descriptor, no local table
    2, 2, 0x04, 0x0a, 0, // LZW: minimum code size 2, one sub-block (clear, 0, 0, end), terminator
  ]);
  const trailer = options.trailer === false ? [] : [Buffer.from([0x3b])];
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame), ...trailer]);
}

/** An animated WebP made of `frames` ANMF chunks (empty frame payload: only the structure is real). */
export function webpOfFrames(frames: number): Buffer {
  const chunk = (fourcc: string, payload: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, "latin1");
    head.writeUInt32LE(payload.length, 4);
    return Buffer.concat([head, payload]);
  };
  const body = Buffer.concat([
    Buffer.from("WEBP", "latin1"),
    chunk("VP8X", Buffer.alloc(10)),
    chunk("ANIM", Buffer.alloc(6)),
    ...Array.from({ length: frames }, () => chunk("ANMF", Buffer.alloc(16))),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

const IFD_BYTES = 6; // entry count (2) + next offset (4): an IFD without any entry

/**
 * A TIFF whose IFD chain has `pages` empty IFDs, laid out one after the other from offset 8.
 * `lastNext` is where the LAST one points (0 = end of chain; 8 = back to the first, a loop;
 * anything else = that raw offset).
 */
export function tiffOfPages(pages: number, options: { bigEndian?: boolean; lastNext?: number } = {}): Buffer {
  const bigEndian = options.bigEndian === true;
  const out = Buffer.alloc(8 + pages * IFD_BYTES);
  out.write(bigEndian ? "MM" : "II", 0, "latin1");
  const write16 = (value: number, at: number): void => {
    if (bigEndian) out.writeUInt16BE(value, at);
    else out.writeUInt16LE(value, at);
  };
  const write32 = (value: number, at: number): void => {
    if (bigEndian) out.writeUInt32BE(value, at);
    else out.writeUInt32LE(value, at);
  };
  write16(42, 2);
  write32(8, 4);
  for (let page = 0; page < pages; page++) {
    const at = 8 + page * IFD_BYTES;
    write16(0, at);
    write32(page === pages - 1 ? (options.lastNext ?? 0) : at + IFD_BYTES, at + 2);
  }
  return out;
}
