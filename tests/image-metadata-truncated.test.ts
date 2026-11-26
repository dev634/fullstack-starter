import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { stripArchivedPhotoMetadata } from "@/lib/imageMetadata";

// REAL sharp on purpose (failOn: "none"). stripArchivedPhotoMetadata has three callers
// (company photo, equipment photo, bulletin archive): this is the one behavior they share.
// Before failOn "none", sharp's default refused a JPEG missing only its two end-of-image
// bytes, or cut short by an interrupted transfer — files Cloudinary used to accept.

/** A noisy JPEG big enough for "cut at 98 %" to cut inside the scan data, not just the tail. */
async function realJpeg(): Promise<Buffer> {
  const width = 200;
  const height = 150;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

/**
 * A flat-colour JPEG: sharp's default refuses it once its last two bytes are gone. (On the
 * noisy fixture above the same cut happens to be tolerated by default — which is why the
 * "no EOI" case uses this one: the premise probe below must really fail with the default.)
 */
async function flatJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 100, channels: 3, background: "#cc3300" } }).jpeg().toBuffer();
}

describe("stripArchivedPhotoMetadata — a truncated JPEG is cleaned, a corrupted header is refused (real sharp)", () => {
  it("the fixture is a complete JPEG ending with the EOI marker (otherwise the cases below prove nothing)", async () => {
    const jpeg = await realJpeg();
    expect(jpeg.subarray(jpeg.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    // The complete file is accepted, as it always was.
    await expect(stripArchivedPhotoMetadata(jpeg, "image/jpeg")).resolves.toBeInstanceOf(Buffer);
  });

  it("accepts a JPEG without its EOI marker and returns a complete, decodable JPEG of the same size", async () => {
    const jpeg = await flatJpeg();
    expect(jpeg.subarray(jpeg.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    const noEoi = jpeg.subarray(0, jpeg.length - 2);
    // Probe of the premise: with sharp's default this very file is refused.
    await expect(sharp(noEoi).rotate().jpeg().toBuffer()).rejects.toThrow();

    const cleaned = await stripArchivedPhotoMetadata(noEoi, "image/jpeg");
    const meta = await sharp(cleaned).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
    expect(cleaned.subarray(cleaned.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it("accepts a JPEG cut at 98 %", async () => {
    const jpeg = await realJpeg();
    const cut = jpeg.subarray(0, Math.floor(jpeg.length * 0.98));
    await expect(sharp(cut).rotate().jpeg().toBuffer()).rejects.toThrow();

    const cleaned = await stripArchivedPhotoMetadata(cut, "image/jpeg");
    const meta = await sharp(cleaned).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
  });

  it("still refuses a really corrupted header, with the shared refusal shape (never a native error)", async () => {
    const corrupted = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await expect(stripArchivedPhotoMetadata(corrupted, "image/jpeg")).rejects.toEqual({
      type: "error",
      code: "corruptedImage",
    });
  });
});
