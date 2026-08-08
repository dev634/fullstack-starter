import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyDeliveryScanSchema,
  scannedDeliveryNoteSchema,
  MAX_SCAN_ITEMS,
  MAX_SCAN_STRING_LENGTH,
  MAX_SCAN_QUANTITY,
} from "@/schemas/deliveryNoteScan";

describe("applyDeliveryScanSchema bounds", () => {
  const base = { projectId: "2" };

  it("accepts an items array at the max size", () => {
    const items = Array.from({ length: MAX_SCAN_ITEMS }, (_, i) => ({ name: `Item ${i}`, quantity: 1 }));
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("rejects an items array one over the max size", () => {
    const items = Array.from({ length: MAX_SCAN_ITEMS + 1 }, (_, i) => ({ name: `Item ${i}`, quantity: 1 }));
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than MAX_SCAN_STRING_LENGTH", () => {
    const items = [{ name: "x".repeat(MAX_SCAN_STRING_LENGTH + 1), quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);
  });

  it("accepts a name at exactly MAX_SCAN_STRING_LENGTH", () => {
    const items = [{ name: "x".repeat(MAX_SCAN_STRING_LENGTH), quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("rejects an oversized unit/reference/supplier string", () => {
    const tooLong = "x".repeat(MAX_SCAN_STRING_LENGTH + 1);
    const items = [{ name: "Panneau", quantity: 1, unit: tooLong }];
    expect(applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) }).success).toBe(false);
    const itemsRef = [{ name: "Panneau", quantity: 1, reference: tooLong }];
    expect(applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(itemsRef) }).success).toBe(false);
    const items2 = [{ name: "Panneau", quantity: 1 }];
    expect(
      applyDeliveryScanSchema.safeParse({ ...base, supplier: tooLong, items: JSON.stringify(items2) }).success
    ).toBe(false);
  });

  it("rejects a quantity over MAX_SCAN_QUANTITY (guards the Float `increment` column from an absurd value like 1e308)", () => {
    const items = [{ name: "Panneau", quantity: MAX_SCAN_QUANTITY + 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);

    const itemsHuge = [{ name: "Panneau", quantity: 1e308 }];
    expect(applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(itemsHuge) }).success).toBe(false);
  });

  it("accepts a quantity at exactly MAX_SCAN_QUANTITY", () => {
    const items = [{ name: "Panneau", quantity: MAX_SCAN_QUANTITY }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("no longer accepts clientId as an input field (resolved server-side from projectId instead)", () => {
    const items = [{ name: "Panneau", quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, clientId: "999", items: JSON.stringify(items) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("clientId");
    }
  });
});

describe("scannedDeliveryNoteSchema bounds (the LLM's raw tool-call output)", () => {
  it("rejects an items array over MAX_SCAN_ITEMS", () => {
    const items = Array.from({ length: MAX_SCAN_ITEMS + 1 }, (_, i) => ({ name: `Item ${i}`, quantity: 1 }));
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(false);
  });

  it("rejects an item name over MAX_SCAN_STRING_LENGTH", () => {
    const items = [{ name: "x".repeat(MAX_SCAN_STRING_LENGTH + 1), quantity: 1 }];
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(false);
  });

  it("rejects an absurd quantity", () => {
    const items = [{ name: "Panneau", quantity: 1e308 }];
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(false);
  });

  it("defaults items to [] when the model omits the field entirely", () => {
    const result = scannedDeliveryNoteSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
    }
  });

  it("rejects a non-object payload (e.g. the model returning something unexpected)", () => {
    expect(scannedDeliveryNoteSchema.safeParse("not an object").success).toBe(false);
    expect(scannedDeliveryNoteSchema.safeParse(null).success).toBe(false);
    expect(scannedDeliveryNoteSchema.safeParse([1, 2, 3]).success).toBe(false);
  });
});

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

describe("readAndValidateDeliveryNoteImage (magic bytes, cross-checked against the file extension)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: "sk-ant-test" };
  });

  it("accepts a real JPEG signature with a matching extension", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "note.jpg", { type: "image/jpeg" });
    const { mediaType } = await readAndValidateDeliveryNoteImage(file);
    expect(mediaType).toBe("image/jpeg");
  });

  it("accepts a real PNG signature with a matching extension", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "note.png", {
      type: "image/png",
    });
    const { mediaType } = await readAndValidateDeliveryNoteImage(file);
    expect(mediaType).toBe("image/png");
  });

  it("rejects a JPEG-signature file whose name claims a different extension (declared type is never trusted)", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    // Real JPEG bytes, but the file is named/declared as a PNG — the
    // extension cross-check must still reject it.
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "note.png", { type: "image/png" });
    await expect(readAndValidateDeliveryNoteImage(file)).rejects.toMatchObject({
      message: expect.stringContaining("JPEG, PNG, WEBP or GIF"),
    });
  });

  it("rejects a file with a JPEG extension but non-image content (declared file.type is never trusted either)", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    const file = new File([new TextEncoder().encode("<script>alert(1)</script>")], "note.jpg", {
      type: "image/jpeg",
    });
    await expect(readAndValidateDeliveryNoteImage(file)).rejects.toMatchObject({
      message: expect.stringContaining("JPEG, PNG, WEBP or GIF"),
    });
  });

  it("rejects a file over the 10 MB size cap before ever reading its bytes for the magic-byte check", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "note.jpg", { type: "image/jpeg" });
    await expect(readAndValidateDeliveryNoteImage(big)).rejects.toMatchObject({
      message: expect.stringContaining("10 MB"),
    });
  });
});

describe("extractDeliveryNoteItems sanitizes the model's returned strings", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: "sk-ant-test" };
    delete process.env.OCR_PROVIDER;
  });

  it("strips control and bidi-override characters from names/supplier before returning them to the client", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    // U+202E (RIGHT-TO-LEFT OVERRIDE) hidden inside an otherwise-plausible
    // name — well within MAX_SCAN_STRING_LENGTH raw, so it passes schema
    // validation on its own; sanitizeScannedString must still strip it
    // before the value is ever sent to the client. Real truncation to
    // MAX_SCAN_STRING_LENGTH also happens in that same function — not
    // separately exercisable here, since the schema already rejects any
    // raw string over that bound before sanitizing ever runs (see point 2);
    // the slice() there is defense-in-depth, kept independent of the
    // schema bound in case either changes on its own.
    const bidiOverride = String.fromCharCode(0x202e);
    const name = `Panneau${bidiOverride}solaire 400W`;
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            supplier: `Rexel${bidiOverride}`,
            items: [{ name, quantity: 5 }],
          },
        },
      ],
    });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "note.jpg", { type: "image/jpeg" });
    const note = await extractDeliveryNoteItems(file);

    expect(note.supplier).toBe("Rexel");
    expect(note.items[0].name).toBe("Panneausolaire 400W");
    expect(note.items[0].name).not.toContain(bidiOverride);
  });

  it("drops a line whose name is made up entirely of control/bidi characters after sanitizing", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    const bidiOverride = String.fromCharCode(0x202e);
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            items: [
              { name: bidiOverride, quantity: 1 },
              { name: "Onduleur", quantity: 2 },
            ],
          },
        },
      ],
    });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "note.jpg", { type: "image/jpeg" });
    const note = await extractDeliveryNoteItems(file);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].name).toBe("Onduleur");
  });

  it("fails cleanly (generic app error) when the model's tool call doesn't match the expected shape", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", input: { items: [{ name: "Panneau", quantity: "not-a-number-and-not-coercible" }] } }],
    });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "note.jpg", { type: "image/jpeg" });
    await expect(extractDeliveryNoteItems(file)).rejects.toMatchObject({ type: "error" });
  });
});
