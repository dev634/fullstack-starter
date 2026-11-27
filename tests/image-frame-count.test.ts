import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { countImageFrames, MAX_IMAGE_FRAMES } from "@/lib/imageFrameCount";
import { convertToStrippedJpeg, stripArchivedPhotoMetadata } from "@/lib/imageMetadata";
import { gifOfFrames, tiffOfPages, webpOfFrames } from "@/tests/helpers/imageFrameFixtures";

// Real sharp where a file must go through it (ordinary photos, animated files under the cap);
// the counter alone is tested on bytes. The refusals that must happen BEFORE sharp is called
// are proven in tests/image-frame-count-no-sharp.test.ts, where sharp is replaced by a spy.

const REFUSED = { type: "error", code: "corruptedImage" };
const flat = { r: 9, g: 99, b: 199 };
const image = (background: { r: number; g: number; b: number } = flat) =>
  sharp({ create: { width: 24, height: 16, channels: 3, background } });
// Distinct frames: an encoder merges identical consecutive ones into a single frame.
const distinctPngs = async () => [
  await image({ r: 255, g: 0, b: 0 }).png().toBuffer(),
  await image({ r: 0, g: 255, b: 0 }).png().toBuffer(),
  await image({ r: 0, g: 0, b: 255 }).png().toBuffer(),
];

describe("countImageFrames: GIF", () => {
  it("counts the image descriptors", () => {
    expect(countImageFrames(gifOfFrames(1))).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(gifOfFrames(50))).toEqual({ kind: "ok", frames: 50 });
    expect(countImageFrames(gifOfFrames(MAX_IMAGE_FRAMES))).toEqual({ kind: "ok", frames: MAX_IMAGE_FRAMES });
  });

  it("refuses one frame past the cap", () => {
    expect(countImageFrames(gifOfFrames(MAX_IMAGE_FRAMES + 1))).toEqual({ kind: "tooMany" });
  });

  it("the audit's file (690,000 frames, ~10 MB) is refused in under 100 ms", () => {
    const bomb = gifOfFrames(690_000);
    expect(bomb.length).toBeGreaterThan(10_000_000);
    const started = performance.now();
    expect(countImageFrames(bomb)).toEqual({ kind: "tooMany" });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("a full walk of ~10 MB (no early exit: a huge cap) stays fast", () => {
    const big = gifOfFrames(690_000);
    const started = performance.now();
    expect(countImageFrames(big, Number.MAX_SAFE_INTEGER)).toEqual({ kind: "ok", frames: 690_000 });
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("refuses a GIF cut inside a block, an unknown block, and a GIF without any image", () => {
    const whole = gifOfFrames(3);
    expect(countImageFrames(whole.subarray(0, whole.length - 8))).toEqual({ kind: "invalid" });
    const unknown = Buffer.concat([gifOfFrames(1, { trailer: false }), Buffer.from([0x99, 0x3b])]);
    expect(countImageFrames(unknown)).toEqual({ kind: "invalid" });
    expect(countImageFrames(gifOfFrames(0))).toEqual({ kind: "invalid" });
    expect(countImageFrames(Buffer.from("GIF89a"))).toEqual({ kind: "invalid" });
  });

  it("accepts a GIF that merely lacks its trailer (cut between two frames)", () => {
    expect(countImageFrames(gifOfFrames(4, { trailer: false }))).toEqual({ kind: "ok", frames: 4 });
  });
});

describe("countImageFrames: WebP", () => {
  it("counts the ANMF chunks, up to the cap", () => {
    expect(countImageFrames(webpOfFrames(MAX_IMAGE_FRAMES))).toEqual({ kind: "ok", frames: MAX_IMAGE_FRAMES });
    expect(countImageFrames(webpOfFrames(MAX_IMAGE_FRAMES + 1))).toEqual({ kind: "tooMany" });
  });

  it("a still WebP is one image", async () => {
    const still = await image().webp().toBuffer();
    expect(countImageFrames(still)).toEqual({ kind: "ok", frames: 1 });
  });

  it("refuses a RIFF cut short or with a chunk running past its end", () => {
    const whole = webpOfFrames(5);
    expect(countImageFrames(whole.subarray(0, whole.length - 10))).toEqual({ kind: "invalid" });
    const lying = Buffer.from(whole);
    lying.writeUInt32LE(0xffffff, 16); // size of the VP8X chunk
    expect(countImageFrames(lying)).toEqual({ kind: "invalid" });
  });
});

describe("countImageFrames: TIFF", () => {
  it("counts the pages of the IFD chain in both byte orders", () => {
    expect(countImageFrames(tiffOfPages(3))).toEqual({ kind: "ok", frames: 3 });
    expect(countImageFrames(tiffOfPages(3, { bigEndian: true }))).toEqual({ kind: "ok", frames: 3 });
    expect(countImageFrames(tiffOfPages(MAX_IMAGE_FRAMES))).toEqual({ kind: "ok", frames: MAX_IMAGE_FRAMES });
    expect(countImageFrames(tiffOfPages(MAX_IMAGE_FRAMES + 1))).toEqual({ kind: "tooMany" });
    expect(countImageFrames(tiffOfPages(MAX_IMAGE_FRAMES + 1, { bigEndian: true }))).toEqual({ kind: "tooMany" });
  });

  it("a chain that loops is INVALID (the loop guard), not merely 'too many'", () => {
    // Without the visited-offset guard the walk only stops at the cap and says "tooMany":
    // this assertion is what holds the guard.
    expect(countImageFrames(tiffOfPages(3, { lastNext: 8 }))).toEqual({ kind: "invalid" });
    expect(countImageFrames(tiffOfPages(1, { lastNext: 8 }))).toEqual({ kind: "invalid" });
    expect(countImageFrames(tiffOfPages(2, { lastNext: 8, bigEndian: true }))).toEqual({ kind: "invalid" });
  }, 2_000);

  it("refuses an offset outside the file, a first IFD outside the file, and entries running past the end", () => {
    expect(countImageFrames(tiffOfPages(2, { lastNext: 1_000_000 }))).toEqual({ kind: "invalid" });
    const firstOutside = tiffOfPages(1);
    firstOutside.writeUInt32LE(5_000, 4);
    expect(countImageFrames(firstOutside)).toEqual({ kind: "invalid" });
    const hugeCount = tiffOfPages(1);
    hugeCount.writeUInt16LE(60_000, 8);
    expect(countImageFrames(hugeCount)).toEqual({ kind: "invalid" });
  });

  it("refuses BigTIFF and a header-only file", () => {
    const big = tiffOfPages(1);
    big.writeUInt16LE(43, 2);
    expect(countImageFrames(big)).toEqual({ kind: "invalid" });
    expect(countImageFrames(Buffer.from("II*\u0000", "latin1"))).toEqual({ kind: "invalid" });
  });
});

describe("countImageFrames: other formats are one image", () => {
  it("JPEG, PNG and anything unrecognised", async () => {
    expect(countImageFrames(await image().jpeg().toBuffer())).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(await image().png().toBuffer())).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(Buffer.from("not an image"))).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(Buffer.alloc(0))).toEqual({ kind: "ok", frames: 1 });
  });
});

describe("through the real decoder", () => {
  it("ordinary photos pass: JPEG, PNG, still WebP, one-frame GIF, one-page TIFF", async () => {
    expect((await stripArchivedPhotoMetadata(await image().jpeg().toBuffer(), "image/jpeg")).length).toBeGreaterThan(0);
    expect((await stripArchivedPhotoMetadata(await image().png().toBuffer(), "image/png")).length).toBeGreaterThan(0);
    expect((await stripArchivedPhotoMetadata(await image().webp().toBuffer(), "image/webp")).length).toBeGreaterThan(0);
    expect((await stripArchivedPhotoMetadata(await image().gif().toBuffer(), "image/gif")).length).toBeGreaterThan(0);
    const tiff = await image().tiff().toBuffer();
    expect(countImageFrames(tiff)).toEqual({ kind: "ok", frames: 1 });
    expect((await convertToStrippedJpeg(tiff)).length).toBeGreaterThan(0);
  });

  it("a GIF of 2 to 50 frames passes and is reduced to its first frame", async () => {
    for (const frames of [2, 3, 50]) {
      const source = gifOfFrames(frames);
      expect((await sharp(source).metadata()).pages).toBe(frames);
      const out = await stripArchivedPhotoMetadata(source, "image/gif");
      expect((await sharp(out).metadata()).pages ?? 1).toBe(1);
    }
    const pngs = await distinctPngs();
    const animated = await sharp(pngs, { join: { animated: true } }).gif().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(3);
    const out = await stripArchivedPhotoMetadata(animated, "image/gif");
    expect((await sharp(out).metadata()).pages ?? 1).toBe(1);
  });

  it("a real animated WebP under the cap passes, reduced to its first frame", async () => {
    const pngs = (await distinctPngs()).slice(0, 2);
    const animated = await sharp(pngs, { join: { animated: true } }).webp().toBuffer();
    expect(countImageFrames(animated)).toEqual({ kind: "ok", frames: 2 });
    const out = await stripArchivedPhotoMetadata(animated, "image/webp");
    expect((await sharp(out).metadata()).pages ?? 1).toBe(1);
  });

  it("a WebP of more than MAX_IMAGE_FRAMES frames is refused", async () => {
    await expect(stripArchivedPhotoMetadata(webpOfFrames(MAX_IMAGE_FRAMES + 1), "image/webp")).rejects.toEqual(REFUSED);
  });

  it("a TIFF of more than MAX_IMAGE_FRAMES pages is refused", async () => {
    await expect(convertToStrippedJpeg(tiffOfPages(MAX_IMAGE_FRAMES + 1))).rejects.toEqual(REFUSED);
  });

  it("a TIFF whose IFD chain loops is refused, without looping", async () => {
    const started = Date.now();
    await expect(convertToStrippedJpeg(tiffOfPages(4, { lastNext: 8 }))).rejects.toEqual(REFUSED);
    expect(Date.now() - started).toBeLessThan(1_000);
  }, 2_000);

  it("a TIFF with an offset outside the file is refused", async () => {
    await expect(convertToStrippedJpeg(tiffOfPages(3, { lastNext: 9_999_999 }))).rejects.toEqual(REFUSED);
  });
});
