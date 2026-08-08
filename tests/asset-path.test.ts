import { describe, it, expect } from "vitest";
import { assetPath, ASSET_KINDS, ALLOWED_WIDTHS } from "@/lib/assetPath";

describe("assetPath", () => {
  it("builds a bare kind/id path with no query when no option is given", () => {
    expect(assetPath("project-files", 42)).toBe("/api/assets/project-files/42");
  });

  it("builds the same bare path for every known kind", () => {
    for (const kind of ASSET_KINDS) {
      expect(assetPath(kind, 7)).toBe(`/api/assets/${kind}/7`);
    }
  });

  it("appends width when given", () => {
    expect(assetPath("reserve-photos", 5, { width: 128 })).toBe("/api/assets/reserve-photos/5?width=128");
  });

  it("appends page when given (réserve plan pagination)", () => {
    expect(assetPath("reserve-plans", 9, { page: 3 })).toBe("/api/assets/reserve-plans/9?page=3");
  });

  it("composes page and width together", () => {
    expect(assetPath("reserve-plans", 9, { page: 3, width: 1600 })).toBe(
      "/api/assets/reserve-plans/9?page=3&width=1600"
    );
  });

  it("accepts every ALLOWED_WIDTHS member — the type is the whitelist, not a runtime check here", () => {
    for (const width of ALLOWED_WIDTHS) {
      expect(assetPath("reserve-photos", 1, { width })).toBe(`/api/assets/reserve-photos/1?width=${width}`);
    }
  });

  it("never produces a trailing '?' when options is an empty object", () => {
    expect(assetPath("project-files", 1, {})).toBe("/api/assets/project-files/1");
  });
});
