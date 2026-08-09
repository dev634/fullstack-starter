import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyDeliveryScanSchema,
  scannedDeliveryNoteSchema,
  MAX_SCAN_ITEMS,
  MAX_SCAN_STRING_LENGTH,
  MAX_SCAN_QUANTITY,
} from "@/schemas/deliveryNoteScan";
import { realJpegFile } from "@/tests/helpers/sharpFixtures";

describe("applyDeliveryScanSchema bounds", () => {
  const base = { projectId: "2" };

  it("accepts an items array at the max size", () => {
    const items = Array.from({ length: MAX_SCAN_ITEMS }, (_, i) => ({ reference: `REF-${i}`, quantity: 1 }));
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("rejects an items array one over the max size", () => {
    const items = Array.from({ length: MAX_SCAN_ITEMS + 1 }, (_, i) => ({ reference: `REF-${i}`, quantity: 1 }));
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);
  });

  it("rejects a reference longer than MAX_SCAN_STRING_LENGTH", () => {
    const items = [{ reference: "x".repeat(MAX_SCAN_STRING_LENGTH + 1), quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);
  });

  it("accepts a reference at exactly MAX_SCAN_STRING_LENGTH", () => {
    const items = [{ reference: "x".repeat(MAX_SCAN_STRING_LENGTH), quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("rejects an oversized brand/reference/supplier string", () => {
    const tooLong = "x".repeat(MAX_SCAN_STRING_LENGTH + 1);
    const itemsBrand = [{ brand: tooLong, reference: "REF-1", quantity: 1 }];
    expect(applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(itemsBrand) }).success).toBe(false);
    const itemsRef = [{ brand: "Nexans", reference: tooLong, quantity: 1 }];
    expect(applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(itemsRef) }).success).toBe(false);
    const items2 = [{ brand: "Nexans", quantity: 1 }];
    expect(
      applyDeliveryScanSchema.safeParse({ ...base, supplier: tooLong, items: JSON.stringify(items2) }).success
    ).toBe(false);
  });

  it("rejects a quantity over MAX_SCAN_QUANTITY (guards the Float `increment` column from an absurd value like 1e308)", () => {
    const items = [{ reference: "REF-1", quantity: MAX_SCAN_QUANTITY + 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);

    const itemsHuge = [{ reference: "REF-1", quantity: 1e308 }];
    expect(applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(itemsHuge) }).success).toBe(false);
  });

  it("accepts a quantity at exactly MAX_SCAN_QUANTITY", () => {
    const items = [{ reference: "REF-1", quantity: MAX_SCAN_QUANTITY }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  // Unlike scannedDeliveryNoteSchema (the model's raw output, tested below),
  // this is the write path: applying a delivery of zero to stock is
  // meaningless, so it keeps requiring a strictly positive quantity even
  // though a reliquat line reported by the model is tolerated upstream.
  it("rejects a zero quantity (only the model-output schema tolerates a reliquat line)", () => {
    const items = [{ reference: "REF-1", quantity: 0 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);
  });

  it("no longer accepts clientId as an input field (resolved server-side from projectId instead)", () => {
    const items = [{ reference: "REF-1", quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, clientId: "999", items: JSON.stringify(items) });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("clientId");
    }
  });

  it("rejects a new item (no materialId) with neither brand nor reference", () => {
    const items = [{ quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(false);
  });

  it("accepts a new item with only a brand", () => {
    const items = [{ brand: "Nexans", quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("accepts a new item with only a reference", () => {
    const items = [{ reference: "REF-1", quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });

  it("accepts a merge item (materialId set) with neither brand nor reference — the existing material's own name is kept", () => {
    const items = [{ materialId: 7, quantity: 1 }];
    const result = applyDeliveryScanSchema.safeParse({ ...base, items: JSON.stringify(items) });
    expect(result.success).toBe(true);
  });
});

describe("scannedDeliveryNoteSchema bounds (the LLM's raw tool-call output)", () => {
  // Adversarial pass 2, point 3: this schema reads the model's own output and
  // must DEGRADE rather than REJECT on a value that's merely out of range —
  // only extractDeliveryNoteItems (lib/deliveryNoteScan.ts) still enforces
  // these, one line at a time, never by failing the whole bulletin. The
  // three tests below used to assert the opposite (a `.max()` here rejecting
  // the WHOLE array over one out-of-range line) — they locked in exactly the
  // defect this schema's own comments describe fixing for a missing
  // brand/reference and a zero-quantity line; flipped rather than restored.

  it("truncates an items array over MAX_SCAN_ITEMS to the first MAX_SCAN_ITEMS, rather than rejecting the whole note", () => {
    const items = Array.from({ length: MAX_SCAN_ITEMS + 1 }, (_, i) => ({ reference: `REF-${i}`, quantity: 1 }));
    const result = scannedDeliveryNoteSchema.safeParse({ items });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items).toHaveLength(MAX_SCAN_ITEMS);
    expect(result.data.items[0].reference).toBe("REF-0");
  });

  it("accepts (at the schema level) an item reference over MAX_SCAN_STRING_LENGTH — truncated downstream by sanitizeScannedString, not rejected here", () => {
    const items = [{ reference: "x".repeat(MAX_SCAN_STRING_LENGTH + 1), quantity: 1 }];
    const result = scannedDeliveryNoteSchema.safeParse({ items });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items[0].reference).toHaveLength(MAX_SCAN_STRING_LENGTH + 1);
  });

  it("accepts (at the schema level) an absurd quantity — dropped downstream (extractDeliveryNoteItems), not rejected here", () => {
    const items = [{ reference: "Panneau", quantity: 1e308 }];
    const result = scannedDeliveryNoteSchema.safeParse({ items });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.items[0].quantity).toBe(1e308);
  });

  // Unlike applyDeliveryScanSchema (the write path, tested above), this
  // schema deliberately has NO .refine() requiring a brand or a reference —
  // see scannedModelItemSchema's comment in schemas/deliveryNoteScan.ts.
  // Wrapping a per-item .refine() in z.array(...) used to make Zod reject
  // the WHOLE array the moment a single line was missing both, even though
  // the model is explicitly told to omit rather than invent one. Enforcement
  // moved downstream, to extractDeliveryNoteItems (lib/deliveryNoteScan.ts),
  // which drops just that one line instead — see delivery-note-scan.test.ts's
  // "extractDeliveryNoteItems sanitizes the model's returned strings" tests.
  it("accepts an item with neither brand nor reference (rejecting the whole array used to fail an entire real bulletin over one unremarkable line)", () => {
    const items = [{ quantity: 1 }];
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(true);
  });

  it("accepts an item with only a brand", () => {
    const items = [{ brand: "Nexans", quantity: 1 }];
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(true);
  });

  it("accepts an item with only a reference", () => {
    const items = [{ reference: "REF-1", quantity: 1 }];
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(true);
  });

  // Same reasoning as the brand/reference case above: a reliquat line
  // (delivered quantity zero, back-ordered) is common on a real bulletin,
  // and must not fail the whole array either. Dropped downstream instead —
  // see the same extractDeliveryNoteItems tests referenced above.
  it("accepts a zero quantity (a reliquat line) — only applyDeliveryScanSchema, the write path, requires a positive quantity", () => {
    const items = [{ reference: "REF-1", quantity: 0 }];
    expect(scannedDeliveryNoteSchema.safeParse({ items }).success).toBe(true);
  });

  it("still rejects a negative quantity", () => {
    const items = [{ reference: "REF-1", quantity: -1 }];
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
      code: "invalidFileType",
    });
  });

  it("rejects a file with a JPEG extension but non-image content (declared file.type is never trusted either)", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    const file = new File([new TextEncoder().encode("<script>alert(1)</script>")], "note.jpg", {
      type: "image/jpeg",
    });
    await expect(readAndValidateDeliveryNoteImage(file)).rejects.toMatchObject({
      code: "invalidFileType",
    });
  });

  it("rejects a file over the 10 MB size cap before ever reading its bytes for the magic-byte check", async () => {
    const { readAndValidateDeliveryNoteImage } = await import("@/lib/deliveryNoteScan");
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "note.jpg", { type: "image/jpeg" });
    await expect(readAndValidateDeliveryNoteImage(big)).rejects.toMatchObject({
      code: "fileTooLarge",
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

  it("strips control and bidi-override characters from brand/supplier before composing the returned name", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    // U+202E (RIGHT-TO-LEFT OVERRIDE) hidden inside an otherwise-plausible
    // brand — well within MAX_SCAN_STRING_LENGTH raw, so it passes schema
    // validation on its own either way; sanitizeScannedString must still
    // strip it before the value is composed into the returned name. Real
    // truncation to MAX_SCAN_STRING_LENGTH also happens in that same
    // function — exercised separately below now that the schema itself no
    // longer bounds the raw string (adversarial pass 2, point 3): sanitizing
    // is the only place that bound is enforced any more, not defense-in-depth
    // behind a schema-level one.
    const bidiOverride = String.fromCharCode(0x202e);
    const brand = `Panneau${bidiOverride}solaire`;
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            supplier: `Rexel${bidiOverride}`,
            items: [{ brand, reference: "400W", quantity: 5 }],
          },
        },
      ],
    });
    const file = await realJpegFile();
    const note = await extractDeliveryNoteItems(file);

    expect(note.supplier).toBe("Rexel");
    expect(note.items[0].brand).toBe("Panneausolaire");
    expect(note.items[0].name).toBe("Panneausolaire — 400W");
    expect(note.items[0].name).not.toContain(bidiOverride);
  });

  it("drops a line whose brand/reference are made up entirely of control/bidi characters after sanitizing", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    // A single bidi-override character is still a non-empty (truthy) string
    // at the raw-schema stage — scannedModelItemSchema no longer even has a
    // `.refine()` requiring one, but this shows the character is still
    // sanitized away regardless — it only sanitizes down to "" once
    // composeMaterialName runs, which is the case this drops (see the
    // comment in extractDeliveryNoteItems).
    const bidiOverride = String.fromCharCode(0x202e);
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            items: [
              { brand: bidiOverride, quantity: 1 },
              { brand: "Nexans", reference: "REF-9", quantity: 2 },
            ],
          },
        },
      ],
    });
    const file = await realJpegFile();
    const note = await extractDeliveryNoteItems(file);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].name).toBe("Nexans — REF-9");
  });

  // The regression test for the most severe point of the audit: a `.refine()`
  // wrapped in `z.array(...)` used to make Zod reject the ENTIRE bulletin the
  // moment a single line was missing both brand and reference — e.g. a
  // "Frais de port" line, or one the model genuinely couldn't read either
  // field on. A real bulletin routinely has at least one such line. The fix
  // degrades instead of rejects: that one line is dropped, the rest of the
  // bulletin is still returned successfully.
  it("keeps the rest of the bulletin when one line has neither brand nor reference — that line is dropped, the whole scan does not fail", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            items: [
              { quantity: 1 }, // e.g. "Frais de port" — no brand, no reference
              { brand: "Nexans", reference: "REF-9", quantity: 2 },
            ],
          },
        },
      ],
    });
    const file = await realJpegFile();
    const note = await extractDeliveryNoteItems(file);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].name).toBe("Nexans — REF-9");
  });

  // Same class of panne, same fix: a reliquat line (delivered quantity zero)
  // must not fail the whole bulletin either.
  it("keeps the rest of the bulletin when one line has a zero quantity (a reliquat) — dropped, not rejected", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            items: [
              { brand: "Nexans", reference: "REF-0", quantity: 0 },
              { brand: "Nexans", reference: "REF-9", quantity: 2 },
            ],
          },
        },
      ],
    });
    const file = await realJpegFile();
    const note = await extractDeliveryNoteItems(file);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].reference).toBe("REF-9");
  });

  // Adversarial pass 2, point 3: an over-length brand/reference/supplier no
  // longer fails the whole scan at the schema stage — it must actually be
  // truncated somewhere, not just silently accepted at full length.
  it("truncates a brand longer than MAX_SCAN_STRING_LENGTH instead of failing the scan", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    const longBrand = "x".repeat(MAX_SCAN_STRING_LENGTH + 50);
    anthropicCreateMock.mockResolvedValue({
      content: [
        { type: "tool_use", input: { items: [{ brand: longBrand, reference: "REF-9", quantity: 2 }] } },
      ],
    });
    const file = await realJpegFile();
    const note = await extractDeliveryNoteItems(file);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].brand).toHaveLength(MAX_SCAN_STRING_LENGTH);
  });

  // Same class of fix as the zero-quantity/missing-name cases above, for the
  // other end of the range: a line the model misread as an absurd quantity
  // (e.g. a garbled OCR digit) is dropped, not the whole bulletin.
  it("keeps the rest of the bulletin when one line's quantity exceeds MAX_SCAN_QUANTITY — dropped, not rejected", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          input: {
            items: [
              { brand: "Nexans", reference: "REF-0", quantity: MAX_SCAN_QUANTITY + 1 },
              { brand: "Nexans", reference: "REF-9", quantity: 2 },
            ],
          },
        },
      ],
    });
    const file = await realJpegFile();
    const note = await extractDeliveryNoteItems(file);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].reference).toBe("REF-9");
  });

  it("fails cleanly (generic app error) when the model's tool call doesn't match the expected shape", async () => {
    const { extractDeliveryNoteItems } = await import("@/lib/deliveryNoteScan");
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", input: { items: [{ reference: "REF-1", quantity: "not-a-number-and-not-coercible" }] } }],
    });
    const file = await realJpegFile();
    await expect(extractDeliveryNoteItems(file)).rejects.toMatchObject({ type: "error", code: "unreadableNote" });
  });
});

describe("composeMaterialName", () => {
  it("joins brand and reference with an em dash when both are present", async () => {
    const { composeMaterialName } = await import("@/lib/materialName");
    expect(composeMaterialName("Nexans", "REF-123")).toBe("Nexans — REF-123");
  });

  it("uses the brand alone when there is no reference", async () => {
    const { composeMaterialName } = await import("@/lib/materialName");
    expect(composeMaterialName("Nexans", null)).toBe("Nexans");
  });

  it("uses the reference alone when there is no brand", async () => {
    const { composeMaterialName } = await import("@/lib/materialName");
    expect(composeMaterialName(null, "REF-123")).toBe("REF-123");
  });

  it("returns an empty string when neither is present — a caller creating a new material must reject this itself (enforced in actions/deliveryNoteScan/deliveryNoteScan.ts, on the COMPOSED name)", async () => {
    const { composeMaterialName } = await import("@/lib/materialName");
    expect(composeMaterialName(null, null)).toBe("");
  });
});
