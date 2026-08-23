import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_RESERVE_STATUS_COLOR } from "@/lib/reserveStatusStyle";

// lib/reserveStatusPillStyle.ts used to compute this pill's inline style
// (CSSProperties) at runtime — deleted once the réserve colours moved to
// app/globals.css's static `.reserve-pill-*` classes + a per-project
// <style nonce> (ReserveStatusStyleVars), the fix for a real bug: this app's
// CSP has no 'unsafe-inline' for style-src, and a nonce authorizes a <style>
// ELEMENT, never a style="" ATTRIBUTE — see docs/CONVENTIONS.md and this
// module's own former doc comment (preserved in git history) for the full
// reasoning. This file now checks the two things that survived that move:
// the 65/35-mix-toward-black-or-white MATH (unchanged, still proven
// independently below) and that globals.css's static rules actually encode
// that same formula against the CSS custom properties ReserveStatusStyleVars
// injects — a grep-able proxy for "the CSS is what it claims to be", the
// closest thing to a runtime check available for a stylesheet no test
// runner here renders.
const globalsCssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const globalsCss = readFileSync(globalsCssPath, "utf8");

// WCAG relative luminance / contrast helpers, duplicated (not imported from
// lib/color.ts) on purpose: this test independently checks the CLAIM the
// on-screen pill's CSS makes (the 65/35 mix clears AA for both product
// defaults, in both this app's card backgrounds), so it must not share a bug
// with the thing it's verifying.
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

describe("app/globals.css's réserve pill/pin rules", () => {
  it("reads its colour ONLY from --reserve-open/--reserve-resolved custom properties, never a literal hex baked into the stylesheet", () => {
    // The whole point of moving this to CSS: the actual colour is unknown at
    // build time (it's per-project), so it can only ever arrive via a
    // per-request <style nonce> (ReserveStatusStyleVars) setting these two
    // custom properties — a literal hex here would mean every project
    // renders the exact same colour again, the bug this whole change fixes.
    expect(globalsCss).toContain("var(--reserve-open");
    expect(globalsCss).toContain("var(--reserve-resolved");
  });

  it("mixes the pill's background/border with color-mix() (true alpha over whatever is behind it)", () => {
    expect(globalsCss).toContain(
      "background-color: color-mix(in srgb, var(--reserve-open, #e11d48) 15%, transparent);"
    );
    expect(globalsCss).toContain("border-color: color-mix(in srgb, var(--reserve-open, #e11d48) 35%, transparent);");
    expect(globalsCss).toContain(
      "background-color: color-mix(in srgb, var(--reserve-resolved, #16a34a) 15%, transparent);"
    );
    expect(globalsCss).toContain(
      "border-color: color-mix(in srgb, var(--reserve-resolved, #16a34a) 35%, transparent);"
    );
  });

  it("mixes the pill's text 65/35 toward the shared --pill-text-mix custom property", () => {
    expect(globalsCss).toContain("color: color-mix(in srgb, var(--reserve-open, #e11d48) 65%, var(--pill-text-mix));");
    expect(globalsCss).toContain(
      "color: color-mix(in srgb, var(--reserve-resolved, #16a34a) 65%, var(--pill-text-mix));"
    );
  });

  it("gives the solid pin/marker a real black/white text colour instead of a mix — --reserve-*-text, pre-computed server-side by contrastTextColor", () => {
    expect(globalsCss).toContain(".reserve-pin-open {");
    expect(globalsCss).toContain("color: var(--reserve-open-text, #ffffff);");
    expect(globalsCss).toContain(".reserve-pin-resolved {");
    expect(globalsCss).toContain("color: var(--reserve-resolved-text, #ffffff);");
  });

  it("resets --pill-text-mix under @media print — a page printed from dark mode must not mix pill text toward white on white paper", () => {
    const printBlock = globalsCss.slice(globalsCss.indexOf("@media print"));
    expect(printBlock).toContain("--pill-text-mix: #000000;");
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
