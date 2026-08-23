import { describe, it, expect } from "vitest";
import { contrastTextColor, mixTowardBlack } from "@/lib/color";

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

describe("mixTowardBlack", () => {
  it("multiplies every channel by the weight (65% of each toward black, by default)", () => {
    // #ff8800 -> (255, 136, 0); 65% of each, rounded: (166, 88, 0) = #a65800.
    expect(mixTowardBlack("#ff8800")).toBe("#a65800");
  });

  it("leaves black exactly black and lightens white only down to the weight's own grey", () => {
    expect(mixTowardBlack("#000000")).toBe("#000000");
    // 255 * 0.65 = 165.75, rounds to 166 = 0xa6, on every channel.
    expect(mixTowardBlack("#ffffff")).toBe("#a6a6a6");
  });

  it("accepts a custom weight", () => {
    expect(mixTowardBlack("#ffffff", 0.5)).toBe("#808080");
  });

  it("falls back to black for anything that isn't a strict 6-digit #RRGGBB value — never an unmixed passthrough", () => {
    expect(mixTowardBlack("#fff")).toBe("#000000");
    expect(mixTowardBlack("not-a-color")).toBe("#000000");
    expect(mixTowardBlack("")).toBe("#000000");
  });

  it("darkens a pale colour enough to clear WCAG AA on white paper — the defect it exists to fix (lib/reservesReport.ts drawing a status label/tile number straight on the page)", () => {
    function linearize(channel: number): number {
      const s = channel / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    function luminance(hex6: string): number {
      const int = parseInt(hex6.slice(1), 16);
      return (
        0.2126 * linearize((int >> 16) & 0xff) +
        0.7152 * linearize((int >> 8) & 0xff) +
        0.0722 * linearize(int & 0xff)
      );
    }
    function contrastOnWhite(hex: string): number {
      return (1.0 + 0.05) / (luminance(hex) + 0.05);
    }
    const orange = "#ff8800";
    // The raw colour reads poorly on white paper...
    expect(contrastOnWhite(orange)).toBeLessThan(4.5);
    // ...mixed toward black, it clears AA.
    expect(contrastOnWhite(mixTowardBlack(orange))).toBeGreaterThanOrEqual(4.5);
  });

  it("is NOT a guarantee for every possible hue — an extreme pale yellow still misses AA even mixed, same caveat the on-screen pill's own math documents", () => {
    // Undocumented would be worse than admitted: no fixed mix ratio can
    // promise AA against a fixed backdrop for every input colour. This pins
    // that limit down instead of silently relying on it.
    function linearize(channel: number): number {
      const s = channel / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    function luminance(hex6: string): number {
      const int = parseInt(hex6.slice(1), 16);
      return (
        0.2126 * linearize((int >> 16) & 0xff) +
        0.7152 * linearize((int >> 8) & 0xff) +
        0.0722 * linearize(int & 0xff)
      );
    }
    function contrastOnWhite(hex: string): number {
      return (1.0 + 0.05) / (luminance(hex) + 0.05);
    }
    const paleYellow = "#fde047";
    expect(contrastOnWhite(mixTowardBlack(paleYellow))).toBeLessThan(4.5);
    // Still a real improvement over the raw, unmixed colour.
    expect(contrastOnWhite(mixTowardBlack(paleYellow))).toBeGreaterThan(contrastOnWhite(paleYellow) * 2);
  });
});
