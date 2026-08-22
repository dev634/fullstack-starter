import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";
import {
  MAX_CLIENT_PHOTO_BYTES,
  MAX_LOGO_BYTES,
  MAX_PROJECT_FILE_BYTES,
  MAX_RESERVE_PLAN_BYTES,
  MAX_RESERVE_PHOTO_BYTES,
} from "@/lib/cloudinary";
import { MAX_BYTES as MAX_DELIVERY_SCAN_BYTES } from "@/lib/deliveryNoteScan";

// fix/blocked-legitimate-input, point 4: Server Actions cap request bodies
// well below this app's own per-feature upload ceilings, so a file the app
// itself declares acceptable (e.g. a 22 MB réserve plan, under the 25 MB the
// upload form advertises) was rejected by Next before uploadReservePlan's
// own check ever ran — a framework-level error, never the localized message.
// This guards the fix by construction: it fails if bodySizeLimit is ever
// lowered below the largest declared ceiling again, or if a new, larger
// ceiling is added to lib/cloudinary.ts without raising bodySizeLimit too.
describe("next.config bodySizeLimit vs. this app's own upload ceilings", () => {
  const bodySizeLimit = nextConfig.experimental?.serverActions?.bodySizeLimit;

  it("is a number", () => {
    expect(typeof bodySizeLimit).toBe("number");
  });

  it.each([
    ["client photo", MAX_CLIENT_PHOTO_BYTES],
    ["logo", MAX_LOGO_BYTES],
    ["project file", MAX_PROJECT_FILE_BYTES],
    ["réserve plan", MAX_RESERVE_PLAN_BYTES],
    ["réserve photo", MAX_RESERVE_PHOTO_BYTES],
    ["delivery-note scan", MAX_DELIVERY_SCAN_BYTES],
  ])("fits under bodySizeLimit: %s", (_label, ceiling) => {
    expect(bodySizeLimit as number).toBeGreaterThanOrEqual(ceiling);
  });

  it("is exactly the largest declared ceiling (réserve plan, 25 MB) — not raised further than needed", () => {
    const largest = Math.max(
      MAX_CLIENT_PHOTO_BYTES,
      MAX_LOGO_BYTES,
      MAX_PROJECT_FILE_BYTES,
      MAX_RESERVE_PLAN_BYTES,
      MAX_RESERVE_PHOTO_BYTES,
      MAX_DELIVERY_SCAN_BYTES
    );
    expect(bodySizeLimit).toBe(largest);
  });
});
