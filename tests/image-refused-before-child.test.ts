import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_GIF_FRAMES, MAX_WEBP_FRAMES } from "@/lib/imageFrameCount";
import { gifOfFrames, tiffOfPages, webpOfFrames } from "@/tests/helpers/imageFrameFixtures";
import { auditProgressiveJpeg } from "@/tests/helpers/progressiveJpegFixture";
import { tiffWithTags } from "@/tests/helpers/tiffFixture";

// The decode child is replaced by a spy that throws if a task is ever started: the point
// is that a file over a cap is refused BEFORE any child exists (metadata() has no timeout
// and walks every frame, the very cost the JS count exists to avoid).
const { runInChildSpy } = vi.hoisted(() => ({ runInChildSpy: vi.fn() }));

vi.mock("@/lib/imageDecodeBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageDecodeBridge")>()),
  runInChild: runInChildSpy,
}));

import { stripArchivedPhotoMetadata, convertToStrippedJpeg } from "@/lib/imageMetadata";

const REFUSED = { type: "error", code: "corruptedImage" };

beforeEach(() => {
  runInChildSpy.mockReset();
  runInChildSpy.mockRejectedValue(new Error("the child must not be started for this file"));
});

describe("a file over a cap never reaches the decode child", () => {
  it("the 690,000-frame GIF of the first audit (~10 MB) is refused in under a second", async () => {
    const bomb = gifOfFrames(690_000);
    const started = performance.now();
    await expect(stripArchivedPhotoMetadata(bomb, "image/gif")).rejects.toEqual(REFUSED);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(runInChildSpy).not.toHaveBeenCalled();
  });

  it("the progressive JPEG of the second audit (3,529 scans) is refused in under a second", async () => {
    const { buffer } = auditProgressiveJpeg();
    const started = performance.now();
    await expect(stripArchivedPhotoMetadata(buffer, "image/jpeg")).rejects.toEqual(REFUSED);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(runInChildSpy).not.toHaveBeenCalled();
  });

  it("the 100-page x 4,000-tag TIFF of the second audit is refused through the converter", async () => {
    await expect(convertToStrippedJpeg(tiffWithTags(100, 4_000))).rejects.toEqual(REFUSED);
    expect(runInChildSpy).not.toHaveBeenCalled();
  });

  it("a WebP, a GIF and a TIFF over their cap, a looping TIFF and HEIC / unknown bytes never reach it", async () => {
    await expect(stripArchivedPhotoMetadata(webpOfFrames(MAX_WEBP_FRAMES + 1), "image/webp")).rejects.toEqual(REFUSED);
    await expect(stripArchivedPhotoMetadata(gifOfFrames(MAX_GIF_FRAMES + 1), "image/gif")).rejects.toEqual(REFUSED);
    await expect(convertToStrippedJpeg(tiffOfPages(4, { lastNext: 8 }))).rejects.toEqual(REFUSED);
    await expect(convertToStrippedJpeg(Buffer.from("not an image at all"))).rejects.toEqual(REFUSED);
    expect(runInChildSpy).not.toHaveBeenCalled();
  }, 5_000);

  it("the spy is live: a file under every cap does start a task", async () => {
    await expect(stripArchivedPhotoMetadata(gifOfFrames(2), "image/gif")).rejects.toEqual(REFUSED);
    expect(runInChildSpy).toHaveBeenCalledTimes(1);
  });
});
