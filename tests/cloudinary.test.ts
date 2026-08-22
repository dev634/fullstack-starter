import { describe, it, expect, vi, beforeEach } from "vitest";

// The upload_stream callback below runs OUTSIDE the `new Promise((resolve,
// reject) => ...)` executor's own call stack (the Cloudinary SDK invokes it
// asynchronously, once its own HTTP round-trip completes) — a raw `throw`
// there would NOT reject the surrounding promise, it would become an
// uncaughtException. This mock reproduces that call shape (options,
// callback) => { end(buffer) } so the test below actually exercises the same
// asynchronous boundary the real SDK does, rather than something that only
// looks like a throw-vs-reject difference.
vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn((_options: unknown, callback: (error: unknown, result: unknown) => void) => ({
        end: () => {
          callback(null, {
            public_id: "projects/1/devis",
            // Not "image" | "video" | "raw" — fromCloudinaryResourceType
            // (lib/cloudinaryDelivery.ts) throws on this.
            resource_type: "unexpected",
            type: "authenticated",
            format: "pdf",
            version: 1700000000,
            secure_url: "https://res.cloudinary.com/demo/raw/authenticated/projects/1/devis.pdf",
            bytes: 1234,
          });
        },
      })),
      destroy: vi.fn(),
    },
  },
}));

import { v2 as cloudinarySdk } from "cloudinary";
import {
  publicIdFromUrl,
  optimizedClientPhoto,
  uploadProjectFile,
  uploadClientPhoto,
  uploadLogo,
  uploadReservePhoto,
  uploadReservePlan,
} from "@/lib/cloudinary";

const uploadStreamMock = vi.mocked(cloudinarySdk.uploader.upload_stream);

// Real magic-number prefixes — enough bytes for detectRasterImageMediaType
// (lib/fileSignature.ts) to recognize the format, no need for a fully valid,
// decodable image: these upload paths never run the buffer through sharp,
// unlike lib/deliveryNoteScan.ts's own fixtures.
const REAL_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const REAL_JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
// Real HEIC ftyp box — the iPhone default photo format. Passe 3b, point 0:
// this used to be silently rejected by these three "must be a real photo"
// paths once they started requiring a recognized signature instead of a
// label (lib/fileSignature.ts only knew JPEG/PNG/GIF/WEBP at the time).
const REAL_HEIC_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x69, 0x66,
  0x31, 0x68, 0x65, 0x69, 0x63,
]);
// A real SVG payload — text/XML, no binary magic number for any raster
// format — renamed to a ".png" filename and declared "image/png", the exact
// disguise the label-only checks this suite guards against used to miss.
const FAKE_SVG_AS_PNG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_AS_PDF_BYTES = new TextEncoder().encode("<html><body><script>alert(1)</script></body></html>");
const REAL_PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n");

const URL_WITH_VERSION =
  "https://res.cloudinary.com/demo/image/upload/v1699999999/clients/abcd1234.png";

describe("publicIdFromUrl", () => {
  it("extracts the public id when a version is present", () => {
    expect(publicIdFromUrl(URL_WITH_VERSION)).toBe("clients/abcd1234");
  });

  it("extracts the public id without a version segment", () => {
    expect(
      publicIdFromUrl("https://res.cloudinary.com/demo/image/upload/clients/abc.jpg")
    ).toBe("clients/abc");
  });

  it("returns null for a non-matching string", () => {
    expect(publicIdFromUrl("not a url")).toBeNull();
  });
});

describe("optimizedClientPhoto", () => {
  it("injects the transform right after /upload/", () => {
    expect(optimizedClientPhoto(URL_WITH_VERSION, 96)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_fill,g_face,w_96,h_96/v1699999999/clients/abcd1234.png"
    );
  });

  it("leaves non-Cloudinary urls unchanged", () => {
    expect(optimizedClientPhoto("https://example.com/x.png")).toBe("https://example.com/x.png");
  });
});

describe("uploadProjectFile — guarded upload response validation", () => {
  it("rejects the returned promise (never hangs / never throws synchronously) on an unexpected resource_type", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "devis.pdf", { type: "application/pdf" });

    // The bug this guards against: a raw throw from inside the upload_stream
    // callback doesn't reach here as a rejection at all — it kills the
    // process. Asserting the promise REJECTS (rather than wrapping the call
    // in try/catch and asserting it throws) is the whole point: it proves
    // the async boundary was crossed correctly.
    await expect(uploadProjectFile(file, 1)).rejects.toBeTruthy();
  });
});

// Passe 3a, point 1: the label-only checks (declared file.type / extension)
// never read a single byte. All four upload paths below must now reject a
// payload whose CONTENT doesn't match what it claims to be, not just one
// whose label is obviously wrong.
beforeEach(() => {
  uploadStreamMock.mockClear();
});

describe("uploadClientPhoto — content-based image validation", () => {
  it("accepts a real PNG and resolves with the uploaded secure_url (unaffected by the new check)", async () => {
    const file = new File([REAL_PNG_BYTES], "photo.png", { type: "image/png" });
    await expect(uploadClientPhoto(file)).resolves.toBe(
      "https://res.cloudinary.com/demo/raw/authenticated/projects/1/devis.pdf"
    );
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an SVG payload renamed to .png and declared image/png — previously accepted on label alone", async () => {
    const file = new File([FAKE_SVG_AS_PNG_BYTES], "photo.png", { type: "image/png" });
    await expect(uploadClientPhoto(file)).rejects.toMatchObject({
      message: "The photo must be an image file.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  // Passe 3b, point 0: an iPhone's default photo format must not be rejected
  // by the content-sniffing check passe 3a introduced.
  it("accepts a real HEIC photo (the iPhone default) — the regression this fix closes", async () => {
    const file = new File([REAL_HEIC_BYTES], "photo.heic", { type: "image/heic" });
    await expect(uploadClientPhoto(file)).resolves.toBe(
      "https://res.cloudinary.com/demo/raw/authenticated/projects/1/devis.pdf"
    );
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
  });
});

describe("uploadLogo — content-based image validation", () => {
  it("accepts a real JPEG and resolves with the uploaded url/publicId", async () => {
    const file = new File([REAL_JPEG_BYTES], "logo.jpg", { type: "image/jpeg" });
    const result = await uploadLogo(file);
    expect(result.publicId).toBe("projects/1/devis");
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an SVG payload renamed to .png and declared image/png — previously accepted on label alone, and this asset is served from a PUBLIC url", async () => {
    const file = new File([FAKE_SVG_AS_PNG_BYTES], "logo.png", { type: "image/png" });
    await expect(uploadLogo(file)).rejects.toMatchObject({
      message: "The logo must be an image file.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });
});

describe("uploadReservePhoto — content-based image validation", () => {
  it("accepts a real PNG (still calls upload_stream; the shared mock's unexpected resource_type then rejects downstream, unrelated to this check)", async () => {
    const file = new File([REAL_PNG_BYTES], "photo.png", { type: "image/png" });
    await expect(uploadReservePhoto(file, 1)).rejects.toBeTruthy(); // guarded-fields rejection, not this check
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an SVG payload renamed to .png and declared image/png before ever calling Cloudinary", async () => {
    const file = new File([FAKE_SVG_AS_PNG_BYTES], "photo.png", { type: "image/png" });
    await expect(uploadReservePhoto(file, 1)).rejects.toMatchObject({
      message: "The photo must be an image file.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });
});

describe("uploadReservePlan — content-based PDF validation (adversarial pass, lot C1, #3)", () => {
  // Before this fix, `isPdf` checked only `file.type`/the `.pdf` extension —
  // never a byte. A file that merely CLAIMS to be a PDF (right label, right
  // extension) but isn't one used to reach Cloudinary unread, uploaded as
  // `resource_type: "image"` (so it can be rasterised), then served back
  // through the same signed delivery path a real plan is.
  it("accepts a real PDF (still calls upload_stream; the shared mock's unexpected resource_type then rejects downstream, unrelated to this check)", async () => {
    const file = new File([REAL_PDF_BYTES], "plan.pdf", { type: "application/pdf" });
    await expect(uploadReservePlan(file, 1)).rejects.toBeTruthy(); // guarded-fields rejection, not this check
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects HTML content disguised as a PDF (declared application/pdf, .pdf extension) before ever calling Cloudinary", async () => {
    const file = new File([HTML_AS_PDF_BYTES], "plan.pdf", { type: "application/pdf" });
    await expect(uploadReservePlan(file, 1)).rejects.toMatchObject({
      message: "The plan must be a PDF file.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  it("rejects an SVG payload disguised as a PDF (declared application/pdf, .pdf extension) before ever calling Cloudinary", async () => {
    const file = new File([FAKE_SVG_AS_PNG_BYTES], "plan.pdf", { type: "application/pdf" });
    await expect(uploadReservePlan(file, 1)).rejects.toMatchObject({
      message: "The plan must be a PDF file.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  it("still rejects on the label alone (not a PDF by type or extension) before ever reading the content", async () => {
    const file = new File([REAL_PNG_BYTES], "plan.png", { type: "image/png" });
    await expect(uploadReservePlan(file, 1)).rejects.toMatchObject({
      message: "The plan must be a PDF file.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });
});

describe("uploadProjectFile — content-based checks alongside the label-only denylist", () => {
  it("still accepts a real PDF (an open-ended document type this path does not content-validate beyond the markup sniff)", async () => {
    const file = new File([REAL_PDF_BYTES], "devis.pdf", { type: "application/pdf" });
    await expect(uploadProjectFile(file, 1)).rejects.toBeTruthy(); // guarded-fields rejection, not this check
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an SVG renamed to devis.png and declared image/png — the label-only denylist (isBlockedUpload) alone would have missed this", async () => {
    const file = new File([FAKE_SVG_AS_PNG_BYTES], "devis.png", { type: "image/png" });
    await expect(uploadProjectFile(file, 1)).rejects.toMatchObject({
      message: "This file type isn't allowed.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });

  it("rejects HTML content disguised as a PDF (declared application/pdf, .pdf extension) via content sniffing", async () => {
    const file = new File([HTML_AS_PDF_BYTES], "devis.pdf", { type: "application/pdf" });
    await expect(uploadProjectFile(file, 1)).rejects.toMatchObject({
      message: "This file type isn't allowed.",
    });
    expect(uploadStreamMock).not.toHaveBeenCalled();
  });
});
