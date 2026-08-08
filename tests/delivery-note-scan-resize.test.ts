import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const anthropicCreateMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreateMock };
  },
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: vi.fn() } };
  },
}));

import { extractDeliveryNoteItems } from "@/lib/deliveryNoteScan";
import { realJpegFile } from "@/tests/helpers/sharpFixtures";

const originalEnv = { ...process.env };

/** The base64 image data actually handed to the (mocked) Anthropic call — what reduceImageForModel produced. */
function base64SentToAnthropic(): string {
  const args = anthropicCreateMock.mock.calls[0]?.[0] as {
    messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }>;
  };
  const imageBlock = args.messages[0].content.find((block) => block.type === "image");
  if (!imageBlock?.source) throw new Error("no image block sent to the mocked Anthropic call");
  return imageBlock.source.data;
}

describe("reduceImageForModel (exercised through extractDeliveryNoteItems) — image sent to the model, not the archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: "sk-ant-test" };
    delete process.env.OCR_PROVIDER;
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", input: { items: [{ reference: "REF-1", quantity: 1 }] } }],
    });
  });

  it("resizes an oversized photo to at most 1568px on its long edge, and strips its EXIF metadata (GPS included)", async () => {
    const file = await realJpegFile({
      width: 3000,
      height: 2000,
      background: { r: 10, g: 20, b: 200 },
      // sharp's Exif type only exposes the IFD0-3 groups (GPS tags are
      // still plain string entries within one of those, not a separate
      // top-level key) — enough here to prove *some* EXIF, including
      // GPS-named fields, is present before reduction and gone after.
      exif: {
        IFD0: {
          Make: "TestPhoneCo",
          Model: "Pixel-Test",
          GPSLatitude: "48/1 51/1 24/1",
          GPSLongitude: "2/1 21/1 3/1",
        },
      },
    });

    await extractDeliveryNoteItems(file);

    const sentBuffer = Buffer.from(base64SentToAnthropic(), "base64");
    const meta = await sharp(sentBuffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1568);
    expect(meta.exif).toBeUndefined();
    expect(sentBuffer.length).toBeLessThan(file.size);

    // The media type declared to the provider must match what was actually
    // produced (always JPEG, regardless of the original upload's format).
    const args = anthropicCreateMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }>;
    };
    const imageBlock = args.messages[0].content.find((block) => block.type === "image");
    expect(imageBlock?.source?.media_type).toBe("image/jpeg");
  });

  it("does not upscale a photo already smaller than the 1568px bound", async () => {
    const file = await realJpegFile({ width: 200, height: 120, background: { r: 50, g: 60, b: 70 } });

    await extractDeliveryNoteItems(file);

    const sentBuffer = Buffer.from(base64SentToAnthropic(), "base64");
    const meta = await sharp(sentBuffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(120);
  });

  it("fails with a generic app error, without ever calling the provider, when the image buffer is corrupted", async () => {
    // Real JPEG signature — passes readAndValidateDeliveryNoteImage's
    // magic-byte check — but truncated right after, so sharp cannot decode
    // it as an actual image.
    const corrupted = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], "note.jpg", {
      type: "image/jpeg",
    });

    await expect(extractDeliveryNoteItems(corrupted)).rejects.toMatchObject({ type: "error", code: "corruptedImage" });
    // Must fail closed, not fall back to sending the untouched original.
    expect(anthropicCreateMock).not.toHaveBeenCalled();
  });
});
