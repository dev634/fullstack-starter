import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { stripArchivedPhotoMetadata, convertToStrippedJpeg } from "@/lib/imageMetadata";
import { STORAGE_IMAGE_LIMITS, STORAGE_MAX_IMAGE_PIXELS } from "@/lib/cloudinary";
import { freshOwner } from "@/tests/helpers/imageAccount";

// An image beyond the storage's pixel ceiling (Cloudinary plan: 25 Mpx, read from its administration API) is REDUCED
// to fit, proportions kept, never refused: an A4 scanned at 600 dpi is 34.8 Mpx, passed the scan and the LLM, and
// the application used to refuse it at every attempt. Real child, real sharp.

async function flat(width: number, height: number, format: "jpeg" | "png", orientation?: number): Promise<Buffer> {
  let pipeline = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 160 } } });
  if (orientation) pipeline = pipeline.withMetadata({ orientation });
  return format === "jpeg" ? pipeline.jpeg({ quality: 80 }).toBuffer() : pipeline.png().toBuffer();
}

describe("an image beyond the storage's pixel ceiling is reduced to fit, not refused", () => {
  it("an A4 scanned at 600 dpi (4960 x 7016 = 34.8 Mpx, JPEG) comes out under 25 Mpx, proportions kept, still a JPEG", async () => {
    const source = await flat(4960, 7016, "jpeg");
    const out = await stripArchivedPhotoMetadata(freshOwner(), source, "image/jpeg", STORAGE_IMAGE_LIMITS);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(STORAGE_MAX_IMAGE_PIXELS);
    expect(meta.width! * meta.height!).toBeGreaterThan(STORAGE_MAX_IMAGE_PIXELS * 0.99);
    expect(meta.width! / meta.height!).toBeCloseTo(4960 / 7016, 3);
    expect(out.length).toBeLessThanOrEqual(STORAGE_IMAGE_LIMITS.maxOutputBytes);
  }, 60_000);

  it("a PNG keeps its format, and a photo taken in portrait (EXIF orientation 6) is reduced AFTER being turned upright", async () => {
    const source = await flat(7000, 5000, "jpeg", 6); // 35 Mpx stored landscape, displayed portrait
    const out = await stripArchivedPhotoMetadata(freshOwner(), source, "image/jpeg", STORAGE_IMAGE_LIMITS);
    const meta = await sharp(out).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.height!).toBeGreaterThan(meta.width!);
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(STORAGE_MAX_IMAGE_PIXELS);
    const png = await stripArchivedPhotoMetadata(freshOwner(), await flat(6000, 5000, "png"), "image/png", STORAGE_IMAGE_LIMITS);
    const pngMeta = await sharp(png).metadata();
    expect(pngMeta.format).toBe("png");
    expect(pngMeta.width! * pngMeta.height!).toBeLessThanOrEqual(STORAGE_MAX_IMAGE_PIXELS);
  }, 60_000);

  it("the conversion path of the company photo (TIFF to JPEG) reduces too", async () => {
    const tiff = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).tiff().toBuffer();
    const out = await convertToStrippedJpeg(freshOwner(), tiff, STORAGE_IMAGE_LIMITS);
    const meta = await sharp(out).metadata();
    expect(meta.width! * meta.height!).toBeLessThanOrEqual(STORAGE_MAX_IMAGE_PIXELS);
  }, 60_000);

  it("an image already within the ceiling keeps its dimensions exactly", async () => {
    const out = await stripArchivedPhotoMetadata(freshOwner(), await flat(5000, 5000, "jpeg"), "image/jpeg", STORAGE_IMAGE_LIMITS);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([5000, 5000]);
  }, 60_000);
});
