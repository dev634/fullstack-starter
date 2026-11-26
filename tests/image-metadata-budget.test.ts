import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertToStrippedJpeg, stripArchivedPhotoMetadata, MAX_DECODED_BYTES } from "@/lib/imageMetadata";

// REAL sharp on purpose: what is under test is what libvips is (or is not) asked to
// allocate, which a fake cannot say. Fixtures are built with sharp, or byte by byte for
// the one TIFF sharp cannot write.
//
// The budget (MAX_DECODED_BYTES = 160 MB, the raster the 40 Mpx pixel ceiling already admits
// in RGBA at 8 bits) is checked on SYNTHETIC files only. It has NOT been calibrated on real
// 10-bit AVIFs from phones: not proven.

const SLOW = 60_000;

describe("sharp's cache is off once lib/imageMetadata is imported", () => {
  it("reports a maximum of 0 for entries, memory and files", () => {
    // Imported at the top of this file: the module has run.
    const cache = sharp.cache();
    expect(cache.memory.max).toBe(0);
    expect(cache.files.max).toBe(0);
    expect(cache.items.max).toBe(0);
  });
});

/**
 * A TIFF of `width` x `height` with `channels` samples of `bits` bits (`format` 1 = unsigned
 * integer, 3 = float), written by hand: ONE strip whose declared byte count is the whole
 * raster while the file carries 64 bytes of it. 230 bytes on disk, and libvips will still
 * allocate the full raster to decode it — which is exactly the case the budget is for.
 */
function handmadeTiff(width: number, height: number, channels: number, bits: number, format: number): Buffer {
  const entryCount = 11;
  const ifdOffset = 8;
  const bitsOffset = ifdOffset + 2 + entryCount * 12 + 4;
  const formatOffset = bitsOffset + channels * 2;
  const dataOffset = formatOffset + channels * 2;
  const out = Buffer.alloc(dataOffset + 64);
  const entries: Array<[tag: number, type: number, count: number, value: number]> = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, channels, bitsOffset],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 4, 1, dataOffset],
    [277, 3, 1, channels],
    [278, 4, 1, height],
    [279, 4, 1, width * height * channels * (bits / 8)],
    [284, 3, 1, 1],
    [339, 3, channels, formatOffset],
  ];
  out.write("II", 0, "latin1");
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(ifdOffset, 4);
  out.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifdOffset + 2 + i * 12;
    out.writeUInt16LE(tag, at);
    out.writeUInt16LE(type, at + 2);
    out.writeUInt32LE(count, at + 4);
    if (type === 3 && count === 1) out.writeUInt16LE(value, at + 8);
    else out.writeUInt32LE(value, at + 8);
  });
  for (let i = 0; i < channels; i++) {
    out.writeUInt16LE(bits, bitsOffset + i * 2);
    out.writeUInt16LE(format, formatOffset + i * 2);
  }
  return out;
}

/** Peak resident-memory growth while `run` is awaited (sampled; libvips allocates off the main thread). */
async function peakGrowthDuring(run: () => Promise<unknown>): Promise<number> {
  const base = process.memoryUsage().rss;
  let peak = base;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 5);
  try {
    await run();
  } catch {
    // The caller asserts on the outcome; only the memory is read here.
  } finally {
    clearInterval(timer);
  }
  return peak - base;
}

const flat = { r: 9, g: 99, b: 199 };

describe("decoded-bytes budget — refused before anything is allocated", () => {
  it("the fixture is what it claims: 230 bytes, 5 float channels, 6000x6600 (premise of the cases below)", async () => {
    const tiff = handmadeTiff(6000, 6600, 5, 32, 3);
    expect(tiff.length).toBeLessThan(300);
    const meta = await sharp(tiff, { failOn: "none" }).metadata();
    expect(meta).toMatchObject({ format: "tiff", width: 6000, height: 6600, channels: 5, depth: "float" });
    // 792 MB: far beyond the budget, yet under the 40 Mpx ceiling.
    expect(6000 * 6600).toBeLessThan(40_000_000);
    expect(6000 * 6600 * 5 * 4).toBeGreaterThan(MAX_DECODED_BYTES);
  });

  it("a 5-channel float32 TIFF is refused quickly, without a large memory peak (companies' photo converter)", async () => {
    const tiff = handmadeTiff(6000, 6600, 5, 32, 3);
    let outcome: unknown;
    const started = Date.now();
    const growth = await peakGrowthDuring(async () => {
      outcome = await convertToStrippedJpeg(tiff).then(
        () => "accepted",
        (error: unknown) => error,
      );
    });
    expect(outcome).toEqual({ type: "error", code: "corruptedImage" });
    // Decoding it costs ~950 MB (measured on Windows); refusing it from the header costs nothing.
    expect(growth).toBeLessThan(150 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(2_000);
  }, SLOW);

  it("a TIFF with more than 4 channels is refused even when tiny", async () => {
    await expect(convertToStrippedJpeg(handmadeTiff(40, 30, 5, 8, 1))).rejects.toEqual({
      type: "error",
      code: "corruptedImage",
    });
  });

  it("a float TIFF with 3 channels is refused (TIFF depth other than uchar/ushort), even when tiny", async () => {
    await expect(convertToStrippedJpeg(handmadeTiff(40, 30, 3, 32, 3))).rejects.toEqual({
      type: "error",
      code: "corruptedImage",
    });
  });

  it("a 12-bit AVIF beyond the budget (6000x6600x3x2 = 238 MB) is refused", async () => {
    const avif = await sharp({ create: { width: 6000, height: 6600, channels: 3, background: flat } })
      .avif({ bitdepth: 12, effort: 0 })
      .toBuffer();
    expect(avif.length).toBeLessThan(5_000);
    const growth = await peakGrowthDuring(async () => {
      await expect(convertToStrippedJpeg(avif)).rejects.toEqual({ type: "error", code: "corruptedImage" });
    });
    expect(growth).toBeLessThan(150 * 1024 * 1024);
  }, SLOW);
});

describe("decoded-bytes budget — what the pixel ceiling admitted in 8 bits is still admitted", () => {
  it("an 8-bit AVIF of 12 Mpx is accepted and converted", async () => {
    const avif = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: flat } })
      .avif({ effort: 0 })
      .toBuffer();
    const jpeg = await convertToStrippedJpeg(avif);
    expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 4000, height: 3000 });
  }, SLOW);

  it("a 12-bit AVIF of 12 Mpx (72 MB decoded) is accepted", async () => {
    const avif = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: flat } })
      .avif({ bitdepth: 12, effort: 0 })
      .toBuffer();
    const jpeg = await convertToStrippedJpeg(avif);
    expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 4000, height: 3000 });
  }, SLOW);

  it("a 16-bit RGB PNG of 12 Mpx (72 MB decoded) is accepted and stays a PNG", async () => {
    const png = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: flat } })
      .toColourspace("rgb16")
      .png({ compressionLevel: 1 })
      .toBuffer();
    expect(await sharp(png).metadata()).toMatchObject({ depth: "ushort", channels: 3 });
    const out = await stripArchivedPhotoMetadata(png, "image/png");
    expect(await sharp(out).metadata()).toMatchObject({ format: "png", width: 4000, height: 3000 });
  }, SLOW);

  it("an RGB JPEG of 24 Mpx is accepted", async () => {
    const jpeg = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: flat } })
      .jpeg()
      .toBuffer();
    const out = await stripArchivedPhotoMetadata(jpeg, "image/jpeg");
    expect(await sharp(out).metadata()).toMatchObject({ format: "jpeg", width: 6000, height: 4000 });
  }, SLOW);

  it("a plain 8-bit RGB TIFF is accepted and converted", async () => {
    const tiff = await sharp({ create: { width: 400, height: 300, channels: 3, background: flat } }).tiff().toBuffer();
    const jpeg = await convertToStrippedJpeg(tiff);
    expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 400, height: 300 });
  });

  it("an RGBA 8-bit GIF at the pixel ceiling's own raster (160 MB) is not refused by the budget", async () => {
    // 6000 x 6600 = 39.6 Mpx, 4 channels, 1 byte: 158.4 MB <= MAX_DECODED_BYTES.
    expect(6000 * 6600 * 4 * 1).toBeLessThanOrEqual(MAX_DECODED_BYTES);
    const gif = await sharp({ create: { width: 6000, height: 6600, channels: 3, background: flat } })
      .gif()
      .toBuffer();
    expect(await sharp(gif).metadata()).toMatchObject({ channels: 4, depth: "uchar" });
    const out = await stripArchivedPhotoMetadata(gif, "image/gif");
    expect(await sharp(out).metadata()).toMatchObject({ format: "gif", width: 6000, height: 6600 });
  }, SLOW);
});
