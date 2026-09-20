import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";
import {
  MAX_CLIENT_PHOTO_BYTES,
  MAX_LOGO_BYTES,
  MAX_PROJECT_FILE_BYTES,
  MAX_RESERVE_PLAN_BYTES,
  MAX_RESERVE_PHOTO_BYTES,
  MAX_EQUIPMENT_PHOTO_BYTES,
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

  // Point 9 (revue "Prêts"): MAX_EQUIPMENT_PHOTO_BYTES stopped being its own
  // independently calibrated number and now reuses MAX_RESERVE_PHOTO_BYTES
  // (same "photo attached to something" use case, already calibrated) — this
  // asserts that sharing stays true, honestly, rather than the two silently
  // drifting apart again behind two names.
  it("shares its ceiling with réserve photo — not a second, independently calibrated number", () => {
    expect(MAX_EQUIPMENT_PHOTO_BYTES).toBe(MAX_RESERVE_PHOTO_BYTES);
  });

  it.each([
    ["client photo", MAX_CLIENT_PHOTO_BYTES],
    ["logo", MAX_LOGO_BYTES],
    ["project file", MAX_PROJECT_FILE_BYTES],
    ["réserve plan", MAX_RESERVE_PLAN_BYTES],
    ["réserve photo", MAX_RESERVE_PHOTO_BYTES],
    ["delivery-note scan", MAX_DELIVERY_SCAN_BYTES],
    ["equipment photo", MAX_EQUIPMENT_PHOTO_BYTES],
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
      MAX_DELIVERY_SCAN_BYTES,
      MAX_EQUIPMENT_PHOTO_BYTES
    );
    expect(bodySizeLimit).toBe(largest);
  });
});
