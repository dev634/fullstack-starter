import sharp from "sharp";
import type { Exif } from "sharp";

type JpegFixtureOptions = {
  /** Long-edge-relevant dimension, defaults to a tiny 20x15 — enough to be a valid JPEG without costing real time to encode. */
  width?: number;
  height?: number;
  background?: { r: number; g: number; b: number };
  name?: string;
  /**
   * Passed straight through to sharp's `.withMetadata({ exif })` when set —
   * lets a test attach EXIF (e.g. GPS tags) to a fixture, to prove it gets
   * stripped by reduceImageForModel (lib/deliveryNoteScan.ts). Omitted by
   * default: sharp strips metadata on its own unless `.withMetadata()` is
   * called, so a fixture with no `exif` here carries none to begin with.
   */
  exif?: Exif;
};

/**
 * A real, valid JPEG `File` built with sharp rather than committed as a
 * binary fixture. Needed everywhere a test's buffer flows through
 * extractDeliveryNoteItems (lib/deliveryNoteScan.ts): that function runs the
 * buffer through sharp itself (reduceImageForModel) before it ever reaches
 * the (mocked) vision provider, and a bare magic-byte array is not a decodable
 * image — sharp would reject it as corrupt, failing the test at the resize
 * step instead of exercising what it's meant to.
 *
 * Was duplicated near-identically across delivery-note-scan-bounds.test.ts
 * and delivery-note-scan-provider.test.ts, plus a differently-parameterized
 * version in delivery-note-scan-resize.test.ts — extracted here once three
 * files needed it, past this project's two-occurrence DRY threshold.
 */
export async function realJpegFile(options: JpegFixtureOptions = {}): Promise<File> {
  const { width = 20, height = 15, background = { r: 120, g: 130, b: 140 }, name = "note.jpg", exif } = options;
  let image = sharp({ create: { width, height, channels: 3, background } });
  if (exif) image = image.withMetadata({ exif });
  const buffer = await image.jpeg().toBuffer();
  return new File([buffer], name, { type: "image/jpeg" });
}
