// PNG files built byte by byte at test time (no binary committed).
import { randomFillSync } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One chunk: length, type, data, CRC of type + data. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** The chunk types of a PNG, in order (stops at a structure that does not walk). */
export function pngChunkTypes(png: Buffer): string[] {
  const types: string[] = [];
  let pos = PNG_SIGNATURE.length;
  while (pos + 12 <= png.length) {
    const next = pos + 12 + png.readUInt32BE(pos);
    if (next > png.length) break;
    types.push(png.toString("latin1", pos + 4, pos + 8));
    pos = next;
  }
  return types;
}

/** Splices `chunks` right after the IHDR chunk of `png` (a real PNG). */
export function withChunksAfterHeader(png: Buffer, chunks: Buffer[]): Buffer {
  const afterHeader = PNG_SIGNATURE.length + 12 + 13;
  return Buffer.concat([png.subarray(0, afterHeader), ...chunks, png.subarray(afterHeader)]);
}

/** A tEXt chunk with a keyword and a short value: what a legitimate tool writes. */
export function textChunk(keyword: string, value: string): Buffer {
  return pngChunk("tEXt", Buffer.from(`${keyword}\0${value}`, "latin1"));
}

/**
 * The bomb of the audit of fix/decodage-borne: a PNG of ONE pixel carrying `chunks` zTXt
 * chunks, each of which inflates to `inflatedMegabytes` MB (the deflate stream is ~40 KB).
 * With 40 chunks of 40 MB (1.5 MB on disk) the decode child went to 5.8 GB (Windows) and
 * succeeded: libpng decompresses every text chunk it meets.
 */
export function zTxtBomb(chunks: number, inflatedMegabytes: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); // width
  header.writeUInt32BE(1, 4); // height
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  const payload = deflateSync(Buffer.alloc(inflatedMegabytes * 1_000_000, 0x41), { level: 9 });
  const parts = [PNG_SIGNATURE, pngChunk("IHDR", header)];
  for (let i = 0; i < chunks; i++) {
    parts.push(pngChunk("zTXt", Buffer.concat([Buffer.from(`k${i}\0`, "latin1"), Buffer.from([0]), payload])));
  }
  parts.push(pngChunk("IDAT", deflateSync(Buffer.from([0, 128]))), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/**
 * The audit's amplifier for the OUTPUT size: an RGB PNG of `width` x `height` whose rows are all
 * the same random row, each coded with filter 2 (Up) as zeros after the first. ~160 KB for
 * 12000x3333, yet sharp writes its PNG without filtering: ~120 MB come out (3.5 s).
 */
export function identicalRowsPng(width: number, height: number): Buffer {
  const first = Buffer.alloc(1 + width * 3);
  randomFillSync(first, 1);
  const up = Buffer.alloc(1 + width * 3);
  up[0] = 2;
  const raw = Buffer.concat([first, ...Array.from({ length: height - 1 }, () => up)]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
