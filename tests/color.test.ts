import { describe, it, expect } from "vitest";
import { contrastTextColor } from "@/lib/color";

describe("contrastTextColor", () => {
  it("picks black text on a white background", () => {
    expect(contrastTextColor("#ffffff")).toBe("#000000");
  });

  it("picks white text on a black background", () => {
    expect(contrastTextColor("#000000")).toBe("#ffffff");
  });

  it("picks white text on the darkest side of the crossover luminance", () => {
    // #757575's WCAG relative luminance (~0.1779) sits just BELOW the
    // threshold where black and white reach equal contrast (~0.1791) — one
    // shade darker than the pair below.
    expect(contrastTextColor("#757575")).toBe("#ffffff");
  });

  it("picks black text on the lightest side of the crossover luminance", () => {
    // #767676's luminance (~0.1812) sits just ABOVE the same threshold — one
    // shade lighter than the pair above, adjacent gray values either side of
    // the crossover.
    expect(contrastTextColor("#767676")).toBe("#000000");
  });

  it("is case-insensitive on the hex digits", () => {
    expect(contrastTextColor("#FFFFFF")).toBe("#000000");
    expect(contrastTextColor("#000000")).toBe("#ffffff");
  });

  it("falls back to white for anything that isn't a strict 6-digit #RRGGBB value", () => {
    // Preserves the assumption every caller hard-coded before this function
    // existed, for a shape this app never itself writes (shorthand, alpha,
    // missing hash, garbage).
    expect(contrastTextColor("#fff")).toBe("#ffffff");
    expect(contrastTextColor("fff000")).toBe("#ffffff");
    expect(contrastTextColor("not-a-color")).toBe("#ffffff");
    expect(contrastTextColor("")).toBe("#ffffff");
  });

  it("picks a readable colour for the app's réserve status defaults", () => {
    // #e11d48 (open, rose) is dark enough for white text; #16a34a (resolved,
    // green) is light enough that black actually reads better on it — the
    // exact defect this function exists to catch, since every call site
    // before it hard-coded white regardless.
    expect(contrastTextColor("#e11d48")).toBe("#ffffff");
    expect(contrastTextColor("#16a34a")).toBe("#000000");
  });
});
