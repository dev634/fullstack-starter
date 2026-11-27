import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  countImageFrames,
  MAX_GIF_FRAMES,
  MAX_JPEG_SCANS,
  MAX_TIFF_ENTRIES_PER_IFD,
  MAX_TIFF_PAGES,
  MAX_WEBP_FRAMES,
} from "@/lib/imageFrameCount";
import { convertToStrippedJpeg, stripArchivedPhotoMetadata } from "@/lib/imageMetadata";
import { gifOfFrames, tiffOfPages, webpOfFrames } from "@/tests/helpers/imageFrameFixtures";
import { auditProgressiveJpeg, progressiveJpegOfScans } from "@/tests/helpers/progressiveJpegFixture";
import { tiffWithTags } from "@/tests/helpers/tiffFixture";

// The counter alone is tested on bytes. Time assertions are generous (a second where the
// walk takes milliseconds) so they stay stable in CI. Real files go through the real
// decode child at the end; the refusals that must happen BEFORE any child exists are in
// tests/image-refused-before-child.test.ts.

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

// --- JPEG: a skeleton of segments, no entropy decoding is needed to count the scans ---

const SOI = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]); // SOI + an empty APP0
const EOI = Buffer.from([0xff, 0xd9]);
/** A scan: SOS segment of length 2 (no components: only its marker matters) and some entropy bytes. */
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0x00, 0x56]);
const jpegOfScans = (scans: number, between: Buffer = Buffer.alloc(0)): Buffer =>
  Buffer.concat([SOI, ...Array.from({ length: scans }, () => Buffer.concat([SCAN, between])), EOI]);

describe("countImageFrames: JPEG", () => {
  it("the progressive JPEG of the audit (3,529 scans, 525 KB) is refused in a few ms", () => {
    const { buffer, scans } = auditProgressiveJpeg();
    expect(scans).toBe(3_529);
    const started = performance.now();
    expect(countImageFrames(buffer)).toEqual({ kind: "tooMany" });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("a real progressive JPEG of sharp and a baseline one pass, as one image", async () => {
    const raw = Buffer.alloc(300 * 200 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
    const source = () => sharp(raw, { raw: { width: 300, height: 200, channels: 3 } });
    const progressive = await source().jpeg({ progressive: true }).toBuffer();
    const baseline = await source().jpeg({ progressive: false }).toBuffer();
    expect(countImageFrames(progressive)).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(baseline)).toEqual({ kind: "ok", frames: 1 });
  });

  it("the cap is exact: MAX_JPEG_SCANS scans pass, one more is refused", () => {
    expect(countImageFrames(jpegOfScans(MAX_JPEG_SCANS))).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(jpegOfScans(MAX_JPEG_SCANS + 1))).toEqual({ kind: "tooMany" });
  });

  it("a small generated progressive file (one component, 64 scans) passes", () => {
    const { buffer, scans } = progressiveJpegOfScans({ width: 1024, height: 1024, components: 1, maxAl: 0 });
    expect(scans).toBe(64);
    expect(countImageFrames(buffer)).toEqual({ kind: "ok", frames: 1 });
  });

  // libjpeg resynchronises on its own rules (next_marker): bytes that are not FF are skipped,
  // FF bytes repeat, `FF 00` is skipped. A scan behind such bytes is decoded by libjpeg, so it
  // must be counted. Three probes: the form that hides a scan, the neighbouring forms, and the
  // form that must NOT change the count.
  describe("resynchronisation as libjpeg does it", () => {
    const hidden = [
      ["stray bytes", Buffer.from([0x41, 0x42, 0x43])],
      ["a stuffed zero", Buffer.from([0xff, 0x00])],
      ["fill bytes then a stuffed zero then text", Buffer.from([0xff, 0xff, 0xff, 0x00, 0x41])],
      ["a restart marker", Buffer.from([0xff, 0xd0])],
    ] as const;
    for (const [label, between] of hidden) {
      it(`a scan behind ${label} is still counted`, () => {
        expect(countImageFrames(jpegOfScans(MAX_JPEG_SCANS, between))).toEqual({ kind: "ok", frames: 1 });
        expect(countImageFrames(jpegOfScans(MAX_JPEG_SCANS + 1, between))).toEqual({ kind: "tooMany" });
      });
    }

    it("stray bytes right before the LAST scan do not end the walk (the scan after them is the 101st)", () => {
      const parts = [SOI, ...Array.from({ length: MAX_JPEG_SCANS }, () => SCAN), Buffer.from([0x00, 0x41, 0xff, 0xff]), SCAN, EOI];
      expect(countImageFrames(Buffer.concat(parts))).toEqual({ kind: "tooMany" });
    });

    it("scans after the first EOI are not counted (the decoder stops there)", () => {
      const after = Buffer.concat([jpegOfScans(2), ...Array.from({ length: 300 }, () => SCAN)]);
      expect(countImageFrames(after)).toEqual({ kind: "ok", frames: 1 });
    });
  });

  it("a truncated JPEG is never refused for its truncation", () => {
    const whole = jpegOfScans(5);
    for (const cut of [whole.length - 1, whole.length - 2, whole.length - 5, 8, 5, 3]) {
      expect(countImageFrames(whole.subarray(0, cut)), `cut at ${cut}`).toEqual({ kind: "ok", frames: 1 });
    }
  });

  it("10 MB of stuffed zeros walks in well under a second", () => {
    const stuffed = Buffer.alloc(10_000_000);
    for (let i = 0; i < stuffed.length; i += 2) stuffed[i] = 0xff;
    const started = performance.now();
    expect(countImageFrames(Buffer.concat([SOI, SCAN, stuffed]))).toEqual({ kind: "ok", frames: 1 });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("countImageFrames: GIF", () => {
  it("counts the image descriptors", () => {
    expect(countImageFrames(gifOfFrames(1))).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(gifOfFrames(50))).toEqual({ kind: "ok", frames: 50 });
    expect(countImageFrames(gifOfFrames(MAX_GIF_FRAMES))).toEqual({ kind: "ok", frames: MAX_GIF_FRAMES });
  });

  it("refuses one frame past the cap", () => {
    expect(countImageFrames(gifOfFrames(MAX_GIF_FRAMES + 1))).toEqual({ kind: "tooMany" });
  });

  it("the audit's file (690,000 frames, ~10 MB) is refused in under a second", () => {
    const bomb = gifOfFrames(690_000);
    expect(bomb.length).toBeGreaterThan(10_000_000);
    const started = performance.now();
    expect(countImageFrames(bomb)).toEqual({ kind: "tooMany" });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("a GIF without any complete image is invalid", () => {
    expect(countImageFrames(gifOfFrames(0))).toEqual({ kind: "invalid" });
    expect(countImageFrames(Buffer.from("GIF89a"))).toEqual({ kind: "invalid" });
    expect(countImageFrames(gifOfFrames(1).subarray(0, 13 + 6 + 8))).toEqual({ kind: "invalid" });
  });

  describe("a cut after the first complete image keeps what was walked", () => {
    it("a cut inside the 3rd image counts it as one more", () => {
      const whole = gifOfFrames(3);
      expect(countImageFrames(whole.subarray(0, whole.length - 8))).toEqual({ kind: "ok", frames: 3 });
    });

    it("an unknown block, stray bytes where the trailer should be, or a descriptor cut short end the walk", () => {
      const two = gifOfFrames(2, { trailer: false });
      expect(countImageFrames(Buffer.concat([two, Buffer.from([0x99, 0x3b])]))).toEqual({ kind: "ok", frames: 2 });
      expect(countImageFrames(Buffer.concat([two, Buffer.from([0x41, 0x42, 0x43])]))).toEqual({ kind: "ok", frames: 2 });
      expect(countImageFrames(Buffer.concat([two, Buffer.from([0x2c, 0, 0])]))).toEqual({ kind: "ok", frames: 3 });
      expect(countImageFrames(Buffer.concat([two, Buffer.from([0x21, 0xf9, 0x04])]))).toEqual({ kind: "ok", frames: 2 });
    });

    it("accepts a GIF that merely lacks its trailer", () => {
      expect(countImageFrames(gifOfFrames(4, { trailer: false }))).toEqual({ kind: "ok", frames: 4 });
    });

    it("the cut file still decodes through the real child (first frame kept)", async () => {
      const whole = gifOfFrames(3);
      const out = await stripArchivedPhotoMetadata(whole.subarray(0, whole.length - 8), "image/gif");
      expect(out.length).toBeGreaterThan(0);
    }, 20_000);
  });
});

describe("countImageFrames: WebP", () => {
  it("counts the ANMF chunks, up to the cap", () => {
    expect(countImageFrames(webpOfFrames(MAX_WEBP_FRAMES))).toEqual({ kind: "ok", frames: MAX_WEBP_FRAMES });
    expect(countImageFrames(webpOfFrames(MAX_WEBP_FRAMES + 1))).toEqual({ kind: "tooMany" });
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

  it("the worst walk, 10 MB of empty JUNK chunks (1.25 million), takes well under a second", () => {
    const junk = Buffer.alloc(12 + 8 * 1_249_998);
    junk.write("RIFF", 0, "latin1");
    junk.writeUInt32LE(junk.length - 8, 4);
    junk.write("WEBP", 8, "latin1");
    for (let pos = 12; pos < junk.length; pos += 8) junk.write("JUNK", pos, "latin1");
    expect(junk.length).toBeGreaterThan(9_999_000);
    const started = performance.now();
    expect(countImageFrames(junk)).toEqual({ kind: "ok", frames: 1 });
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("countImageFrames: TIFF", () => {
  it("counts the pages of the IFD chain in both byte orders, up to the cap", () => {
    expect(countImageFrames(tiffOfPages(3))).toEqual({ kind: "ok", frames: 3 });
    expect(countImageFrames(tiffOfPages(3, { bigEndian: true }))).toEqual({ kind: "ok", frames: 3 });
    expect(countImageFrames(tiffOfPages(MAX_TIFF_PAGES))).toEqual({ kind: "ok", frames: MAX_TIFF_PAGES });
    expect(countImageFrames(tiffOfPages(MAX_TIFF_PAGES + 1))).toEqual({ kind: "tooMany" });
    expect(countImageFrames(tiffOfPages(MAX_TIFF_PAGES + 1, { bigEndian: true }))).toEqual({ kind: "tooMany" });
  });

  it("the 100-page x 4,000-tag TIFF of the audit (4.8 MB) is refused in a few ms", () => {
    const bomb = tiffWithTags(100, 4_000);
    expect(bomb.length).toBeGreaterThan(4_000_000);
    const started = performance.now();
    expect(countImageFrames(bomb)).toEqual({ kind: "tooMany" });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("the entry bounds: per IFD, then over the whole chain", () => {
    // 9 real tags + extra: 256 entries pass, 257 are refused.
    expect(countImageFrames(tiffWithTags(1, MAX_TIFF_ENTRIES_PER_IFD - 9))).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(tiffWithTags(1, MAX_TIFF_ENTRIES_PER_IFD - 8))).toEqual({ kind: "tooMany" });
    // 40 pages x 100 entries = 4,000 pass; 42 pages x 100 = 4,200 are over the total.
    expect(countImageFrames(tiffWithTags(40, 91))).toEqual({ kind: "ok", frames: 40 });
    expect(countImageFrames(tiffWithTags(42, 91))).toEqual({ kind: "tooMany" });
  });

  it("a legitimate TIFF with many tags (60) passes", () => {
    expect(countImageFrames(tiffWithTags(1, 51))).toEqual({ kind: "ok", frames: 1 });
  });

  it("a chain that loops is INVALID (the loop guard), not merely 'too many'", () => {
    expect(countImageFrames(tiffOfPages(3, { lastNext: 8 }))).toEqual({ kind: "invalid" });
    expect(countImageFrames(tiffOfPages(1, { lastNext: 8 }))).toEqual({ kind: "invalid" });
    expect(countImageFrames(tiffOfPages(2, { lastNext: 8, bigEndian: true }))).toEqual({ kind: "invalid" });
  }, 2_000);

  describe("a chain cut after the first IFD keeps what was walked", () => {
    it("a next-IFD pointer outside the file ends the chain", () => {
      expect(countImageFrames(tiffOfPages(2, { lastNext: 1_000_000 }))).toEqual({ kind: "ok", frames: 2 });
      expect(countImageFrames(tiffOfPages(1, { lastNext: 9_999_999 }))).toEqual({ kind: "ok", frames: 1 });
    });

    it("a later IFD whose entries run past the end of the file ends the chain too", () => {
      const whole = tiffWithTags(2, 5);
      const firstPageEnd = 8 + (2 + 14 * 12 + 4 + 2);
      expect(countImageFrames(whole.subarray(0, firstPageEnd + 20))).toEqual({ kind: "ok", frames: 1 });
    });

    it("a FIRST IFD outside the file, or running past the end, is still invalid", () => {
      const firstOutside = tiffOfPages(1);
      firstOutside.writeUInt32LE(5_000, 4);
      expect(countImageFrames(firstOutside)).toEqual({ kind: "invalid" });
      const hugeCount = tiffOfPages(1);
      hugeCount.writeUInt16LE(200, 8);
      expect(countImageFrames(hugeCount)).toEqual({ kind: "invalid" });
    });
  });

  it("refuses BigTIFF and a header-only file", () => {
    const big = tiffOfPages(1);
    big.writeUInt16LE(43, 2);
    expect(countImageFrames(big)).toEqual({ kind: "invalid" });
    expect(countImageFrames(Buffer.from("II*\u0000", "latin1"))).toEqual({ kind: "invalid" });
  });
});

describe("countImageFrames: closed on what it does not know", () => {
  it("PNG and AVIF count for one image: the deadline bounds them", async () => {
    expect(countImageFrames(await image().png().toBuffer())).toEqual({ kind: "ok", frames: 1 });
    expect(countImageFrames(await image().avif({ effort: 0 }).toBuffer())).toEqual({ kind: "ok", frames: 1 });
  });

  it("HEIC, BMP, text and empty input are invalid", () => {
    const heic = Buffer.alloc(32);
    heic.writeUInt32BE(32, 0);
    heic.write("ftypheic", 4, "latin1");
    expect(countImageFrames(heic)).toEqual({ kind: "invalid" });
    const bmp = Buffer.alloc(64);
    bmp.write("BM", 0, "latin1");
    bmp.writeUInt32LE(bmp.length, 2);
    expect(countImageFrames(bmp)).toEqual({ kind: "invalid" });
    expect(countImageFrames(Buffer.from("not an image"))).toEqual({ kind: "invalid" });
    expect(countImageFrames(Buffer.alloc(0))).toEqual({ kind: "invalid" });
  });
});

describe("through the real decoder (the real child)", () => {
  it("ordinary photos pass: JPEG, PNG, still WebP, one-frame GIF, one-page TIFF", async () => {
    expect((await stripArchivedPhotoMetadata(await image().jpeg().toBuffer(), "image/jpeg")).length).toBeGreaterThan(0);
    expect((await stripArchivedPhotoMetadata(await image().png().toBuffer(), "image/png")).length).toBeGreaterThan(0);
    expect((await stripArchivedPhotoMetadata(await image().webp().toBuffer(), "image/webp")).length).toBeGreaterThan(0);
    expect((await stripArchivedPhotoMetadata(await image().gif().toBuffer(), "image/gif")).length).toBeGreaterThan(0);
    const tiff = await image().tiff().toBuffer();
    expect(countImageFrames(tiff)).toEqual({ kind: "ok", frames: 1 });
    expect((await convertToStrippedJpeg(tiff)).length).toBeGreaterThan(0);
  }, 20_000);

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
  }, 20_000);

  it("a real animated WebP under the cap passes, reduced to its first frame", async () => {
    const pngs = (await distinctPngs()).slice(0, 2);
    const animated = await sharp(pngs, { join: { animated: true } }).webp().toBuffer();
    expect(countImageFrames(animated)).toEqual({ kind: "ok", frames: 2 });
    const out = await stripArchivedPhotoMetadata(animated, "image/webp");
    expect((await sharp(out).metadata()).pages ?? 1).toBe(1);
  }, 20_000);

  it("a legitimate multi-tag TIFF is converted", async () => {
    expect((await convertToStrippedJpeg(tiffWithTags(1, 40))).length).toBeGreaterThan(0);
  }, 20_000);

  it("a WebP over the cap, a TIFF over the cap and a looping TIFF are refused", async () => {
    await expect(stripArchivedPhotoMetadata(webpOfFrames(MAX_WEBP_FRAMES + 1), "image/webp")).rejects.toEqual(REFUSED);
    await expect(convertToStrippedJpeg(tiffOfPages(MAX_TIFF_PAGES + 1))).rejects.toEqual(REFUSED);
    const started = Date.now();
    await expect(convertToStrippedJpeg(tiffOfPages(4, { lastNext: 8 }))).rejects.toEqual(REFUSED);
    expect(Date.now() - started).toBeLessThan(1_000);
  }, 5_000);
});
