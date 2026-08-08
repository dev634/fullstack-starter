import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readAndValidateDeliveryNoteImage, stripArchivedPhotoMetadata } from "@/lib/deliveryNoteScan";
import { realJpegFile } from "@/tests/helpers/sharpFixtures";

describe("stripArchivedPhotoMetadata — the archived (full-resolution) copy of the bulletin, not the model copy", () => {
  it("strips EXIF (GPS included) from a JPEG without resizing it or changing its format", async () => {
    const file = await realJpegFile({
      // Larger than MODEL_MAX_LONG_EDGE (1568, lib/deliveryNoteScan.ts) so a
      // regression that accidentally reused reduceImageForModel's resize
      // would be caught here, not just leave the model copy small.
      width: 3000,
      height: 2000,
      background: { r: 10, g: 20, b: 200 },
      exif: {
        IFD0: {
          Make: "TestPhoneCo",
          Model: "Pixel-Test",
          GPSLatitude: "48/1 51/1 24/1",
          GPSLongitude: "2/1 21/1 3/1",
        },
      },
    });

    const { buffer, mediaType } = await readAndValidateDeliveryNoteImage(file);
    const cleaned = await stripArchivedPhotoMetadata(buffer, mediaType);
    const meta = await sharp(cleaned).metadata();

    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(3000);
    expect(meta.height).toBe(2000);
    expect(meta.format).toBe("jpeg");
  });

  it("does not shrink a photo already smaller than the model's bound either — this copy is never resized, in either direction", async () => {
    const file = await realJpegFile({ width: 200, height: 120 });

    const { buffer, mediaType } = await readAndValidateDeliveryNoteImage(file);
    const cleaned = await stripArchivedPhotoMetadata(buffer, mediaType);
    const meta = await sharp(cleaned).metadata();

    expect(meta.width).toBe(200);
    expect(meta.height).toBe(120);
  });

  it("bakes the EXIF orientation into the pixels before dropping it, rather than archiving a sideways photo", async () => {
    // A 200x120 image tagged "rotate 90°" (orientation 6): once EXIF is
    // stripped without applying it first, a viewer has no tag left to
    // correct it, so the pixels themselves must already be upright — the
    // width/height swap here is exactly what `.rotate()` produces.
    const buffer = await sharp({ create: { width: 200, height: 120, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const file = new File([buffer], "note.jpg", { type: "image/jpeg" });

    const { buffer: validated, mediaType } = await readAndValidateDeliveryNoteImage(file);
    const cleaned = await stripArchivedPhotoMetadata(validated, mediaType);
    const meta = await sharp(cleaned).metadata();

    expect(meta.orientation).toBeUndefined();
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(200);
  });

  it("keeps a PNG a PNG, with its metadata stripped and dimensions unchanged", async () => {
    const buffer = await sharp({ create: { width: 50, height: 40, channels: 4, background: { r: 5, g: 6, b: 7, alpha: 1 } } })
      .withMetadata({ exif: { IFD0: { Make: "TestPhoneCo" } } })
      .png()
      .toBuffer();
    const file = new File([buffer], "note.png", { type: "image/png" });

    const { buffer: validated, mediaType } = await readAndValidateDeliveryNoteImage(file);
    const cleaned = await stripArchivedPhotoMetadata(validated, mediaType);
    const meta = await sharp(cleaned).metadata();

    expect(meta.format).toBe("png");
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(40);
  });

  it("fails with the app's own corruptedImage code, never a native error, when sharp can't decode the buffer", async () => {
    // Real JPEG signature — passes readAndValidateDeliveryNoteImage's
    // magic-byte check — but truncated right after, so sharp cannot decode
    // it as an actual image.
    const corrupted = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await expect(stripArchivedPhotoMetadata(corrupted, "image/jpeg")).rejects.toMatchObject({
      type: "error",
      code: "corruptedImage",
    });
  });
});
