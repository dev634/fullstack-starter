import { describe, it, expect } from "vitest";
import { reserveStatusPillStyle } from "@/lib/reserveStatusPillStyle";
import { DEFAULT_RESERVE_STATUS_COLOR } from "@/lib/reserveStatusStyle";

// WCAG relative luminance / contrast helpers, duplicated (not imported from
// lib/color.ts) on purpose: this test independently checks the CLAIM made in
// reserveStatusPillStyle's own doc comment (the 65/35 mix clears AA for both
// product defaults, in both this app's card backgrounds), so it must not
// share a bug with the thing it's verifying.
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex6: string): number {
  const int = parseInt(hex6.slice(1), 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}
function contrast(hexA: string, hexB: string): number {
  const [l1, l2] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** `color-mix(in srgb, hex W%, anchor (100-W)%)`, computed by hand in plain sRGB. */
function mix(hex: string, weight: number, anchor: "#000000" | "#ffffff"): string {
  const int = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
  const a = anchor === "#ffffff" ? 255 : 0;
  const mixed = [r, g, b].map((c) => Math.round(c * weight + a * (1 - weight)));
  return "#" + mixed.map((c) => c.toString(16).padStart(2, "0")).join("");
}

const CARD_LIGHT = "#f3f4f6";
const CARD_DARK = "#1f2937";
const AA_NORMAL_TEXT = 4.5;

describe("reserveStatusPillStyle", () => {
  it("returns a colour-mix() background/border (true alpha over whatever is behind the pill)", () => {
    const style = reserveStatusPillStyle("#e11d48");
    expect(style.backgroundColor).toBe("color-mix(in srgb, #e11d48 15%, transparent)");
    expect(style.borderColor).toBe("color-mix(in srgb, #e11d48 35%, transparent)");
  });

  it("mixes text 65/35 toward the shared --pill-text-mix custom property", () => {
    const style = reserveStatusPillStyle("#16a34a");
    expect(style.color).toBe("color-mix(in srgb, #16a34a 65%, var(--pill-text-mix))");
  });

  it.each([
    ["OPEN default (rose)", DEFAULT_RESERVE_STATUS_COLOR.OPEN],
    ["RESOLVED default (green)", DEFAULT_RESERVE_STATUS_COLOR.RESOLVED],
  ])("the 65/35 mix clears WCAG AA (4.5:1) for %s against both card backgrounds", (_label, hex) => {
    const lightModeText = mix(hex, 0.65, "#000000"); // --pill-text-mix in light mode
    const darkModeText = mix(hex, 0.65, "#ffffff"); // --pill-text-mix in dark mode
    expect(contrast(lightModeText, CARD_LIGHT)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrast(darkModeText, CARD_DARK)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("plain full-opacity hex text (the alternative this module rejected) actually fails AA for at least one default/mode", () => {
    // Documents WHY the mix exists: this would be the naive approach (reuse
    // the configured hex as-is for text), and it's provably not good enough.
    expect(contrast(DEFAULT_RESERVE_STATUS_COLOR.OPEN, CARD_LIGHT)).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrast(DEFAULT_RESERVE_STATUS_COLOR.RESOLVED, CARD_LIGHT)).toBeLessThan(AA_NORMAL_TEXT);
  });
});
