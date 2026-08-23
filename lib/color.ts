// General-purpose colour math, deliberately independent of any product
// concept (réserves, app settings, email...) so it can be shared by all of
// them without an odd import direction.

const HEX6 = /^#([0-9a-fA-F]{6})$/;

/** One sRGB channel (0-255) converted to linear light, per the WCAG formula. */
function linearizeChannel(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white) of a #RRGGBB colour. */
function relativeLuminance(hex6: string): number {
  const int = parseInt(hex6, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

// The background luminance at which black text (contrast ratio
// (Lbg+0.05)/0.05) and white text (contrast ratio 1.05/(Lbg+0.05)) reach
// exactly the same contrast ratio against it, per the WCAG 2.x formula.
// Solving (Lbg+0.05)/0.05 = 1.05/(Lbg+0.05) gives Lbg = sqrt(1.05*0.05)-0.05
// (~0.1791). Above it the background is light enough that black wins; below
// it, white does. Derived rather than hard-coded so the reasoning stays
// checkable at the call site instead of behind a bare magic number.
const EQUAL_CONTRAST_LUMINANCE = Math.sqrt(1.05 * 0.05) - 0.05;

/**
 * Which of pure white or pure black reads best on top of the given
 * background colour, by WCAG relative luminance. Pure (a two-way choice,
 * not a full contrast-ratio computation) because every caller today draws
 * plain white/black text — a réserve pill's number, an email button's
 * label — never an arbitrary third colour.
 *
 * `hex` must be a strict 6-digit `#RRGGBB` value (the shape every colour
 * stored by this app is validated to, in schemas/appSettings.ts's
 * `hexColor` and the database CHECKs on Project's reserve status columns).
 * Anything else — malformed input, or a shorthand/alpha CSS form this app
 * never itself produces — falls back to white, preserving the assumption
 * every caller hard-coded before this function existed.
 */
export function contrastTextColor(hex: string): "#ffffff" | "#000000" {
  const match = HEX6.exec(hex);
  if (!match) return "#ffffff";
  return relativeLuminance(match[1]) > EQUAL_CONTRAST_LUMINANCE ? "#000000" : "#ffffff";
}
