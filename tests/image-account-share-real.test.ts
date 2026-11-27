import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { encodeOriented, MAX_ENCODED_OUTPUT_BYTES, DECODE_BUDGET_MS, stripArchivedPhotoMetadata } from "@/lib/imageMetadata";
import { freshOwner } from "@/tests/helpers/imageAccount";

// THE LEGITIMATE SIDE of the share of an account (docs/CONVENTIONS.md): the real decode child, real sharp,
// real wall-clock time. A limit is judged on what it refuses of normal use, and the diff of a limit never
// shows that: an inventory of 40 tools photographed with a phone, and a session of 20 bulletin scans, must
// pass WITHOUT a single refusal and leave most of the 300 s budget. The photo is a 12 Mpx JPEG (4032 x 3024,
// the size of a phone camera), the real cost of a decode being the pixels, not the content.
//
// What it does NOT prove: the speed of the production VPS (two shared cores). The wall-clock sum is
// logged, and the assertion is the budget itself, so a machine that is too slow turns it red instead of
// letting a limit through that its own workload would hit.

const STORAGE_LIMITS = { maxOutputBytes: 10_485_760, fitInPixels: 25_000_000 };
const MODEL_RECIPE = { maxLongEdge: 1568, maxOutputBytes: MAX_ENCODED_OUTPUT_BYTES, fitInPixels: null } as const;

async function phonePhoto(): Promise<Buffer> {
  const width = 4032;
  const height = 3024;
  const raw = Buffer.alloc(width * height * 3);
  // A gradient with a mild texture: smooth like a sky, not all-black, and compressible like a real photo.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x >> 4) & 0xff;
      raw[i + 1] = (y >> 4) & 0xff;
      raw[i + 2] = ((x ^ y) >> 3) & 0xff;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

/** What the account has spent in the decoder over the hour, in ms: read off the process-wide state. */
function spentMs(owner: string): number {
  const accounts: unknown = Reflect.get(globalThis, Symbol.for("fullstack-starter.imageMetadata.accounts"));
  if (!(accounts instanceof Object) || !("spent" in accounts) || !(accounts.spent instanceof Map)) return 0;
  const spans: unknown = accounts.spent.get(owner);
  if (!Array.isArray(spans)) return 0;
  return spans.reduce((sum: number, span: { ms: number }) => sum + span.ms, 0);
}

describe("the legitimate workloads pass without a refusal, and leave most of the budget", () => {
  it("an inventory of 40 tools photographed in a row (equipment photos at the storage's limits)", async () => {
    const photo = await phonePhoto();
    const owner = freshOwner();
    expect(photo.length).toBeLessThan(10 * 1024 * 1024);
    for (let i = 0; i < 40; i++) {
      const out = await stripArchivedPhotoMetadata(owner, photo, "image/jpeg", STORAGE_LIMITS);
      expect(out.length).toBeGreaterThan(0);
    }
    const spent = spentMs(owner);
    console.log(`[image-account-share-real] 40 equipment photos of 12 Mpx: ${Math.round(spent)} ms of ${DECODE_BUDGET_MS} ms`);
    expect(spent).toBeLessThan(DECODE_BUDGET_MS);
  }, 280_000);

  it("a session of 20 bulletin scans: for each, the image for the model THEN the archive (40 decodes), one after the other", async () => {
    const photo = await phonePhoto();
    const owner = freshOwner();
    for (let i = 0; i < 20; i++) {
      const forModel = await encodeOriented("model", owner, photo, { format: "jpeg", quality: 85 }, MODEL_RECIPE);
      expect(forModel.length).toBeGreaterThan(0);
      const archive = await stripArchivedPhotoMetadata(owner, photo, "image/jpeg", STORAGE_LIMITS);
      expect(archive.length).toBeGreaterThan(0);
    }
    const spent = spentMs(owner);
    console.log(`[image-account-share-real] 20 bulletin scans (model + archive) of 12 Mpx: ${Math.round(spent)} ms of ${DECODE_BUDGET_MS} ms`);
    expect(spent).toBeLessThan(DECODE_BUDGET_MS);
  }, 280_000);
});
