import { describe, it, expect } from "vitest";
import { detectRasterImageMediaType, looksLikeDangerousMarkup, looksLikePdf } from "@/lib/fileSignature";

// Passe 3b, point 0 — regression fix: detectRasterImageMediaType used to
// recognize only JPEG/PNG/GIF/WEBP. lib/cloudinary.ts's uploadClientPhoto/
// uploadLogo/uploadReservePhoto/uploadProjectFile now REQUIRE a recognized
// signature where they previously accepted anything merely labeled
// "image/*" — so a photo shot on an iPhone (HEIC by default) or a recent
// Android (AVIF) was being silently rejected, the single most common upload
// path on a chantier app used from a phone. Every fixture below is a real,
// structurally valid header for its format (not an invented byte string):
// the exact magic numbers/box layout a real encoder writes, trimmed to
// however many leading bytes the detector actually reads.

describe("detectRasterImageMediaType", () => {
  it("still recognizes a real JPEG (SOI marker)", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(detectRasterImageMediaType(jpeg)).toBe("image/jpeg");
  });

  it("still recognizes a real PNG (8-byte PNG signature)", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectRasterImageMediaType(png)).toBe("image/png");
  });

  it("still recognizes a real GIF (GIF87a/GIF89a header)", () => {
    const gif = Buffer.from("GIF89a", "ascii");
    expect(detectRasterImageMediaType(gif)).toBe("image/gif");
  });

  it("still recognizes a real WEBP (RIFF....WEBP)", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]), // chunk size, irrelevant to the sniff
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(detectRasterImageMediaType(webp)).toBe("image/webp");
  });

  it("recognizes a real HEIC (Apple's own ftyp brand — iPhone default photo format)", () => {
    // Real HEIC header layout: box size, "ftyp", major brand "heic", minor
    // version, compatible brand list ("mif1", "heic").
    const heic = Buffer.from([
      0x00, 0x00, 0x00, 0x18, // box size = 24
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      0x68, 0x65, 0x69, 0x63, // major brand "heic"
      0x00, 0x00, 0x00, 0x00, // minor version
      0x6d, 0x69, 0x66, 0x31, // compatible brand "mif1"
      0x68, 0x65, 0x69, 0x63, // compatible brand "heic"
    ]);
    expect(detectRasterImageMediaType(heic)).toBe("image/heic");
  });

  it("recognizes an mif1-branded HEIF (non-Apple encoder, e.g. some Android vendors)", () => {
    const heif = Buffer.from([
      0x00, 0x00, 0x00, 0x14, // box size = 20
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      0x6d, 0x69, 0x66, 0x31, // major brand "mif1"
      0x00, 0x00, 0x00, 0x00, // minor version
      0x6d, 0x69, 0x66, 0x31, // compatible brand "mif1"
    ]);
    expect(detectRasterImageMediaType(heif)).toBe("image/heic");
  });

  it("recognizes a real AVIF (increasingly the default on recent Android cameras)", () => {
    // Real AVIF header layout: box size, "ftyp", major brand "avif", minor
    // version, compatible brand list ("avif", "mif1").
    const avif = Buffer.from([
      0x00, 0x00, 0x00, 0x1c, // box size = 28
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      0x61, 0x76, 0x69, 0x66, // major brand "avif"
      0x00, 0x00, 0x00, 0x00, // minor version
      0x61, 0x76, 0x69, 0x66, // compatible brand "avif"
      0x6d, 0x69, 0x66, 0x31, // compatible brand "mif1"
    ]);
    expect(detectRasterImageMediaType(avif)).toBe("image/avif");
  });

  it("recognizes a real BMP (BITMAPFILEHEADER, file-size field matching the buffer's own length)", () => {
    // Real 14-byte BITMAPFILEHEADER: "BM", bfSize (LE u32) = 14 (this
    // fixture's own length), 2x2-byte reserved fields, bfOffBits (LE u32).
    const bmp = Buffer.from([
      0x42, 0x4d, // "BM"
      0x0e, 0x00, 0x00, 0x00, // bfSize = 14
      0x00, 0x00, // bfReserved1
      0x00, 0x00, // bfReserved2
      0x36, 0x00, 0x00, 0x00, // bfOffBits = 54 (the classic value, unchecked here)
    ]);
    expect(bmp.length).toBe(14);
    expect(detectRasterImageMediaType(bmp)).toBe("image/bmp");
  });

  it("recognizes a real little-endian TIFF (II*\\0 byte order marker)", () => {
    const tiffLE = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    expect(detectRasterImageMediaType(tiffLE)).toBe("image/tiff");
  });

  it("recognizes a real big-endian TIFF (MM\\0* byte order marker)", () => {
    const tiffBE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);
    expect(detectRasterImageMediaType(tiffBE)).toBe("image/tiff");
  });

  it("does not mistake an arbitrary 'BM'-prefixed non-BMP for a real BMP (declared file size must match)", () => {
    const fakeBmp = Buffer.from("BMP is not the same as this text", "ascii");
    expect(detectRasterImageMediaType(fakeBmp)).toBeNull();
  });

  it("still rejects a well-formed SVG (no binary magic number for any recognized format)", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");
    expect(detectRasterImageMediaType(svg)).toBeNull();
  });

  it("still rejects an empty buffer", () => {
    expect(detectRasterImageMediaType(Buffer.alloc(0))).toBeNull();
  });
});

describe("looksLikeDangerousMarkup (unaffected by the format-detection change above)", () => {
  it("flags an SVG payload", () => {
    expect(looksLikeDangerousMarkup(Buffer.from("<svg></svg>", "utf8"))).toBe(true);
  });

  it("does not flag a real JPEG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(looksLikeDangerousMarkup(jpeg)).toBe(false);
  });
});

// Adversarial pass, lot C1, #3: lib/cloudinary.ts::uploadReservePlan used to
// validate a "PDF" purely on `file.type`/the `.pdf` extension, never a byte —
// the fifth upload path, and the only one left unread when the other four
// were hardened. A plan is uploaded as `resource_type: "image"` so Cloudinary
// can rasterise it, which this check must not break.
describe("looksLikePdf", () => {
  it("recognizes a real PDF header at byte 0", () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n", "ascii");
    expect(looksLikePdf(pdf)).toBe(true);
  });

  it("tolerates a few bytes of leading padding before the header, within the spec's 1024-byte window", () => {
    const pdf = Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), Buffer.from("%PDF-1.7\n", "ascii")]);
    expect(looksLikePdf(pdf)).toBe(true);
  });

  it("rejects HTML content merely named/declared as a PDF", () => {
    const html = Buffer.from("<html><body><script>alert(1)</script></body></html>", "utf8");
    expect(looksLikePdf(html)).toBe(false);
  });

  it("rejects an SVG payload merely named/declared as a PDF", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");
    expect(looksLikePdf(svg)).toBe(false);
  });

  it("rejects an empty buffer", () => {
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });

  it("does not find the signature past the 1024-byte sniff window", () => {
    const padded = Buffer.concat([Buffer.alloc(1024, 0x20), Buffer.from("%PDF-1.4\n", "ascii")]);
    expect(looksLikePdf(padded)).toBe(false);
  });
});
