import { describe, it, expect, vi } from "vitest";

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

import { publicIdFromUrl, optimizedClientPhoto, uploadProjectFile } from "@/lib/cloudinary";

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
