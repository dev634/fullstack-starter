import { describe, it, expect, beforeAll } from "vitest";
import { v2 as cloudinary } from "cloudinary";
import { buildDeliveryUrl, type DeliveryAsset } from "@/lib/cloudinaryDelivery";

// buildDeliveryUrl signs locally (an HMAC over the transformation + public
// id) — no network call is made, so fixed, fake credentials are enough to
// make cloudinary.url() fully deterministic here, independent of whatever
// CLOUDINARY_URL happens to be set to in this environment.
beforeAll(() => {
  cloudinary.config({ cloud_name: "demo", api_key: "123456789", api_secret: "test-secret", secure: true });
});

describe("buildDeliveryUrl", () => {
  it("does not double the extension on a RAW asset — format stays NULL, publicId already carries it", () => {
    // No ProjectFile/ReservePhoto rows exist locally to prove this path —
    // this is the case the brief calls out explicitly.
    const asset: DeliveryAsset = {
      publicId: "projects/2/devis.pdf", // RAW public ids keep their extension
      resourceType: "RAW",
      format: null,
      version: "1699999999",
      deliveryType: "AUTHENTICATED",
    };

    const url = buildDeliveryUrl(asset);

    expect(url).toContain("/raw/authenticated/");
    expect(url).toMatch(/\/s--[\w-]+--\//); // signed
    expect(url.endsWith("projects/2/devis.pdf")).toBe(true);
    expect(url).not.toContain(".pdf.pdf");
  });

  it("appends the stored format on an IMAGE asset (extension stripped from publicId by Cloudinary)", () => {
    const asset: DeliveryAsset = {
      publicId: "clients/1/photo",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
      deliveryType: "AUTHENTICATED",
    };

    const url = buildDeliveryUrl(asset);

    expect(url).toContain("/image/authenticated/");
    expect(url).toMatch(/\/s--[\w-]+--\//);
    expect(url.endsWith("clients/1/photo.jpg")).toBe(true);
  });

  it("produces a working, UNSIGNED url for a legacy UPLOAD asset (not yet re-typed)", () => {
    const asset: DeliveryAsset = {
      publicId: "clients/1/photo",
      resourceType: "IMAGE",
      format: "jpg",
      version: "1700000000",
      deliveryType: "UPLOAD",
    };

    const url = buildDeliveryUrl(asset);

    expect(url).toContain("/image/upload/");
    expect(url).not.toMatch(/\/s--[\w-]+--\//);
    expect(url.endsWith("clients/1/photo.jpg")).toBe(true);
  });

  it("signs a rasterised plan page with the DELIVERED format, not the stored (source) one", () => {
    // A réserve plan: uploaded as an IMAGE resource even though the source is
    // a PDF (resourceType IMAGE lets Cloudinary rasterise it) — format "pdf"
    // describes that source, not what a given delivery actually returns.
    const plan: DeliveryAsset = {
      publicId: "projects/2/reserve-plans/plan",
      resourceType: "IMAGE",
      format: "pdf",
      version: "1700000001",
      deliveryType: "AUTHENTICATED",
    };

    const url = buildDeliveryUrl(plan, { page: 1, format: "jpg" });

    expect(url).toContain("pg_1");
    expect(url.endsWith("projects/2/reserve-plans/plan.jpg")).toBe(true);
    expect(url).not.toContain(".pdf");
  });

  it("never fabricates a version segment when none is stored", () => {
    const asset: DeliveryAsset = {
      publicId: "clients/1/photo",
      resourceType: "IMAGE",
      format: "jpg",
      version: null,
      deliveryType: "UPLOAD",
    };

    const url = buildDeliveryUrl(asset);

    expect(url).not.toMatch(/\/v\d+\//);
  });
});
