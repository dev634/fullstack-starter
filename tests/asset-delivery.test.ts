import { describe, it, expect } from "vitest";
import {
  assetKindSchema,
  assetIdSchema,
  assetQuerySchema,
  buildAssetTransformation,
  mimeFromFormat,
  contentDispositionHeader,
} from "@/lib/assetDelivery";
import { ALLOWED_WIDTHS } from "@/lib/assetPath";

describe("assetKindSchema / assetIdSchema", () => {
  it("accepts the three known kinds", () => {
    expect(assetKindSchema.safeParse("project-files").success).toBe(true);
    expect(assetKindSchema.safeParse("reserve-plans").success).toBe(true);
    expect(assetKindSchema.safeParse("reserve-photos").success).toBe(true);
  });

  it("rejects anything else", () => {
    expect(assetKindSchema.safeParse("clients").success).toBe(false);
    expect(assetKindSchema.safeParse("").success).toBe(false);
  });

  it("accepts a positive integer id, rejects zero/negative/non-numeric", () => {
    expect(assetIdSchema.safeParse("42").success).toBe(true);
    expect(assetIdSchema.safeParse("0").success).toBe(false);
    expect(assetIdSchema.safeParse("-1").success).toBe(false);
    expect(assetIdSchema.safeParse("abc").success).toBe(false);
    expect(assetIdSchema.safeParse("1.5").success).toBe(false);
  });

  // Past Postgres' int4 range, findById's underlying query throws — without
  // this bound, that reaches the route as an unhandled DB error instead of a
  // clean 400 (see the route's try/catch around row resolution).
  it("bounds the id to Postgres' int4 range", () => {
    expect(assetIdSchema.safeParse("2147483647").success).toBe(true);
    expect(assetIdSchema.safeParse("999999999999").success).toBe(false);
  });
});

describe("assetQuerySchema", () => {
  it("leaves page/width undefined when absent", () => {
    const parsed = assetQuerySchema.safeParse({ page: undefined, width: undefined });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({});
  });

  // A real chantier plan never runs to more than a handful of pages — 20 is
  // comfortably above any of them, and bounded (rather than 1000) so an
  // arbitrary integer can't be handed straight to Cloudinary as a distinct,
  // separately-billed page transform.
  it("bounds page to [1, 20]", () => {
    expect(assetQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(assetQuerySchema.safeParse({ page: "21" }).success).toBe(false);
    expect(assetQuerySchema.safeParse({ page: "20" }).success).toBe(true);
    expect(assetQuerySchema.safeParse({ page: "5" }).success).toBe(true);
  });

  // The whole point: an unbounded width would make this route a public,
  // billable image-transformation proxy — every allowed value must be an
  // exact whitelist member, not a range.
  it("only accepts a whitelisted width, never a free integer", () => {
    for (const width of ALLOWED_WIDTHS) {
      expect(assetQuerySchema.safeParse({ width: String(width) }).success, `${width} should be allowed`).toBe(true);
    }
    expect(assetQuerySchema.safeParse({ width: "500" }).success).toBe(false);
    expect(assetQuerySchema.safeParse({ width: "99999" }).success).toBe(false);
  });
});

describe("buildAssetTransformation", () => {
  it("requests no transformation for a plain RAW project file", () => {
    expect(buildAssetTransformation("project-files", { resourceType: "RAW" }, {})).toBeUndefined();
  });

  it("applies width/crop/quality to an IMAGE project file when asked", () => {
    expect(buildAssetTransformation("project-files", { resourceType: "IMAGE" }, { width: 1600 })).toEqual({
      width: 1600,
      crop: "limit",
      quality: "auto",
    });
  });

  it("always forces page 1 + jpg for a réserve plan, even with no query at all", () => {
    // A plan's source is a PDF stored as resourceType IMAGE purely so
    // Cloudinary can rasterise it — without this, the response would be the
    // raw PDF bytes instead of a displayable page.
    expect(buildAssetTransformation("reserve-plans", { resourceType: "IMAGE" }, {})).toEqual({
      page: 1,
      format: "jpg",
    });
  });

  it("composes an explicit page with a whitelisted width for a réserve plan", () => {
    expect(buildAssetTransformation("reserve-plans", { resourceType: "IMAGE" }, { page: 3, width: 1600 })).toEqual({
      page: 3,
      format: "jpg",
      width: 1600,
      crop: "limit",
      quality: "auto",
    });
  });

  it("applies width to a réserve photo", () => {
    expect(buildAssetTransformation("reserve-photos", { resourceType: "IMAGE" }, { width: 128 })).toEqual({
      width: 128,
      crop: "limit",
      quality: "auto",
    });
  });

  it("ignores width on a non-IMAGE asset regardless of kind", () => {
    expect(buildAssetTransformation("reserve-photos", { resourceType: "RAW" }, { width: 128 })).toBeUndefined();
  });
});

describe("mimeFromFormat", () => {
  it("maps known Cloudinary formats to their MIME type", () => {
    expect(mimeFromFormat("jpg")).toBe("image/jpeg");
    expect(mimeFromFormat("png")).toBe("image/png");
    expect(mimeFromFormat("pdf")).toBe("application/pdf");
  });

  it("is case-insensitive", () => {
    expect(mimeFromFormat("PDF")).toBe("application/pdf");
  });

  it("returns null for an unknown or absent format rather than guessing", () => {
    expect(mimeFromFormat("xyz")).toBeNull();
    expect(mimeFromFormat(null)).toBeNull();
    expect(mimeFromFormat(undefined)).toBeNull();
  });
});

describe("contentDispositionHeader", () => {
  it("returns a bare 'inline' regardless of any filename", () => {
    expect(contentDispositionHeader("inline", "plan.pdf")).toBe("inline");
    expect(contentDispositionHeader("inline", null)).toBe("inline");
  });

  it("returns a bare 'attachment' when there is no filename to carry", () => {
    expect(contentDispositionHeader("attachment", null)).toBe("attachment");
  });

  it("carries both an ASCII fallback and a UTF-8 (RFC 5987) filename*", () => {
    const header = contentDispositionHeader("attachment", "Devis Électricité.pdf");
    expect(header).toContain('filename="Devis _lectricit_.pdf"');
    const encoded = header.match(/filename\*=UTF-8''([^;]+)/)?.[1];
    expect(encoded).toBeTruthy();
    expect(decodeURIComponent(encoded!)).toBe("Devis Électricité.pdf");
  });

  // The stored name is the original upload filename — attacker-influenced,
  // exactly like the project name sanitized for the réserves report.
  it("strips anything that could break out of the header or inject a new one", () => {
    const nasty = 'evil"\r\nX-Injected: 1\r\n\r\n../../etc/passwd';
    const header = contentDispositionHeader("attachment", nasty);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain('"1\r');
    // No unescaped quote inside the quoted-string beyond the two delimiters.
    expect(header.match(/"/g)?.length).toBe(2);
  });

  it("falls back to a generic name when the filename is empty/whitespace-only", () => {
    expect(contentDispositionHeader("attachment", "   ")).toContain('filename="fichier"');
  });
});
