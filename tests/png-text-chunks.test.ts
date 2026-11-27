import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { deflateSync } from "node:zlib";
import { stripPngTextChunks } from "@/lib/pngTextChunks";
import { stripArchivedPhotoMetadata } from "@/lib/imageMetadata";
import { pngChunk, pngChunkTypes, textChunk, withChunksAfterHeader, zTxtBomb } from "@/tests/helpers/pngFixture";

const base = () => sharp({ create: { width: 24, height: 16, channels: 3, background: { r: 9, g: 99, b: 199 } } });
const pixels = (png: Buffer) => sharp(png).raw().toBuffer({ resolveWithObject: true });

describe("stripPngTextChunks (pure)", () => {
  it("removes tEXt, zTXt and iTXt, and only those", async () => {
    const clean = await base().png().toBuffer();
    const dirty = withChunksAfterHeader(clean, [
      textChunk("Author", "someone"),
      pngChunk("zTXt", Buffer.concat([Buffer.from("k\0\0", "latin1"), deflateSync(Buffer.from("hello"))])),
      pngChunk("iTXt", Buffer.from("k\0\0\0\0\0hello", "latin1")),
    ]);
    expect(pngChunkTypes(dirty)).toEqual(["IHDR", "tEXt", "zTXt", "iTXt", ...pngChunkTypes(clean).slice(1)]);
    expect(stripPngTextChunks(dirty).equals(clean)).toBe(true);
  });

  it("keeps iCCP (colours), eXIf (orientation), IDAT and the rest, byte for byte", async () => {
    const oriented = await base().withMetadata({ orientation: 6 }).png().toBuffer();
    expect(pngChunkTypes(oriented)).toContain("eXIf");
    const dirty = withChunksAfterHeader(oriented, [textChunk("Comment", "x")]);
    expect(stripPngTextChunks(dirty).equals(oriented)).toBe(true);
    const profile = withChunksAfterHeader(oriented, [pngChunk("iCCP", Buffer.from("p\0\0", "latin1"))]);
    // Nothing to remove: the very same buffer, the colour profile chunk still there.
    expect(stripPngTextChunks(profile)).toBe(profile);
    expect(pngChunkTypes(profile)).toContain("iCCP");
  });

  it("is the identity on a non-PNG and on a PNG without text", async () => {
    const jpeg = await base().jpeg().toBuffer();
    expect(stripPngTextChunks(jpeg)).toBe(jpeg);
    expect(stripPngTextChunks(Buffer.alloc(0)).length).toBe(0);
    const png = await base().png().toBuffer();
    expect(stripPngTextChunks(png)).toBe(png);
  });

  it("a cut structure is copied as it is, never refused", async () => {
    const png = await base().png().toBuffer();
    const dirty = withChunksAfterHeader(png, [textChunk("a", "b")]);
    for (const cut of [dirty.length - 3, dirty.length - 20, 40, 30, 12]) {
      const part = dirty.subarray(0, cut);
      const out = stripPngTextChunks(part);
      expect(out.length).toBeLessThanOrEqual(part.length);
      // The tail is the same bytes (the cut chunk, if any, is left as it is).
      expect(out.subarray(out.length - 3).equals(part.subarray(part.length - 3))).toBe(true);
    }
  });

  it("a length that runs past the end stops the walk: what precedes is cleaned, the rest is copied", async () => {
    const png = await base().png().toBuffer();
    const header = png.subarray(0, 8 + 12 + 13);
    const lie = Buffer.from([0x7f, 0xff, 0xff, 0xff, 0x74, 0x45, 0x58, 0x74, 1, 2, 3, 4, 5]);
    const out = stripPngTextChunks(Buffer.concat([header, textChunk("a", "b"), lie]));
    expect(out.equals(Buffer.concat([header, lie]))).toBe(true);
  });
});

describe("through the real decode child", () => {
  it("the bomb of the audit (120 zTXt chunks of 40 MB inflated) is cleaned and decodes in well under a few seconds", async () => {
    const bomb = zTxtBomb(120, 40);
    expect(bomb.length).toBeGreaterThan(4_000_000);
    const stripped = stripPngTextChunks(bomb);
    expect(pngChunkTypes(stripped)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(stripped.length).toBeLessThan(100);
    const started = performance.now();
    const out = await stripArchivedPhotoMetadata(bomb, "image/png");
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(out.length).toBeGreaterThan(0);
  }, 60_000);

  it("pixels are identical with and without the text chunks", async () => {
    const clean = await base().png().toBuffer();
    const dirty = withChunksAfterHeader(clean, [textChunk("a", "b"), textChunk("c", "d")]);
    const viaApp = await pixels(await stripArchivedPhotoMetadata(dirty, "image/png"));
    const reference = await pixels(await stripArchivedPhotoMetadata(clean, "image/png"));
    expect(viaApp.data.equals(reference.data)).toBe(true);
    expect(viaApp.info).toMatchObject({ width: 24, height: 16 });
  }, 30_000);

  it("the orientation carried by eXIf is still applied, and a legitimate PNG with a few tEXt passes", async () => {
    const oriented = await base().withMetadata({ orientation: 6 }).png().toBuffer();
    const dirty = withChunksAfterHeader(oriented, [textChunk("Software", "a tool"), textChunk("Comment", "hello")]);
    const out = await stripArchivedPhotoMetadata(dirty, "image/png");
    const meta = await sharp(out).metadata();
    // 24x16 displayed with orientation 6 is 16x24: applied, then the tag is gone.
    expect([meta.width, meta.height]).toEqual([16, 24]);
    expect(meta.orientation).toBeUndefined();
  }, 30_000);
});
