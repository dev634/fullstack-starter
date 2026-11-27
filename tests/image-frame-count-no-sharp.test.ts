import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_IMAGE_FRAMES } from "@/lib/imageFrameCount";
import { gifOfFrames, tiffOfPages, webpOfFrames } from "@/tests/helpers/imageFrameFixtures";

// sharp is replaced by a spy that throws if it is ever constructed: the point is that a file over
// the frame cap is refused BEFORE libvips is called at all (metadata() has no timeout and walks
// every frame, the very cost the count exists to avoid).
const { sharpSpy } = vi.hoisted(() => ({ sharpSpy: vi.fn() }));

vi.mock("sharp", () => {
  const fake = Object.assign(sharpSpy, { cache: vi.fn() });
  return { default: fake };
});

import { stripArchivedPhotoMetadata, convertToStrippedJpeg } from "@/lib/imageMetadata";

const REFUSED = { type: "error", code: "corruptedImage" };

beforeEach(() => {
  sharpSpy.mockReset();
  sharpSpy.mockImplementation(() => {
    throw new Error("sharp must not be called for this file");
  });
});

describe("a file over the frame cap never reaches sharp", () => {
  it("the 690,000-frame GIF of the audit (~10 MB) is refused in under 100 ms, sharp untouched", async () => {
    const bomb = gifOfFrames(690_000);
    const started = performance.now();
    await expect(stripArchivedPhotoMetadata(bomb, "image/gif")).rejects.toEqual(REFUSED);
    expect(performance.now() - started).toBeLessThan(100);
    expect(sharpSpy).not.toHaveBeenCalled();
  });

  it("same through the AVIF / TIFF converter", async () => {
    await expect(convertToStrippedJpeg(gifOfFrames(690_000))).rejects.toEqual(REFUSED);
    expect(sharpSpy).not.toHaveBeenCalled();
  });


  it("a WebP over the cap, a TIFF over the cap, a looping TIFF and a TIFF with an offset outside the file never reach sharp", async () => {
    await expect(stripArchivedPhotoMetadata(webpOfFrames(MAX_IMAGE_FRAMES + 1), "image/webp")).rejects.toEqual(REFUSED);
    await expect(convertToStrippedJpeg(tiffOfPages(MAX_IMAGE_FRAMES + 1))).rejects.toEqual(REFUSED);
    await expect(convertToStrippedJpeg(tiffOfPages(4, { lastNext: 8 }))).rejects.toEqual(REFUSED);
    await expect(convertToStrippedJpeg(tiffOfPages(3, { lastNext: 9_999_999 }))).rejects.toEqual(REFUSED);
    expect(sharpSpy).not.toHaveBeenCalled();
  }, 2_000);

  it("the spy is live: a file under the cap does reach sharp", async () => {
    await expect(stripArchivedPhotoMetadata(gifOfFrames(2), "image/gif")).rejects.toEqual(REFUSED);
    expect(sharpSpy).toHaveBeenCalled();
  });
});
