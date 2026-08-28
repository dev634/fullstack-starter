// General-purpose colour math, deliberately independent of any product
// concept (réserves, app settings, email...) so it can be shared by all of
// them without an odd import direction.

const HEX6 = /^#([0-9a-fA-F]{6})$/;

/**
 * Belt-and-suspenders re-validation of a stored colour before it is
 * interpolated raw into markup — a nonce-authorized <style> element's text,
 * or an email's inline style attribute. Every colour this app stores is
 * already validated on write (schemas/appSettings.ts's hexColor,
 * schemas/reserve.ts, plus the database CHECK on Project's reserve status
 * columns), but a value edited directly in the database should never be
 * trusted at an injection sink.
 *
 * Deliberately the SAME strict #RRGGBB shape contrastTextColor and
 * mixTowardBlack accept. A caller that validates a colour one way and then
 * derives a text colour from it another way gets the two disagreeing about
 * what a colour is: a shorthand #fff accepted here would paint a white
 * background and then, rejected there, a white label on top of it.
 */
export function safeHex(value: string, fallback: string): string {
  return HEX6.test(value) ? value : fallback;
}

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

/**
 * Mix a colour 65% toward black — the same ratio app/globals.css's
 * `.reserve-pill-*` classes use for the on-screen pill's text
 * (`color-mix(in srgb, var(--reserve-open) 65%, var(--pill-text-mix))`),
 * always toward black here rather than reading `--pill-text-mix`: a PDF page
 * has no dark mode, it's always white paper. Shared by lib/reservesReport.ts
 * so a réserve's status label and a cover tile's count read the same way
 * printed as they do on screen — a pale, admin-picked colour (a bright
 * yellow, say) stays legible on paper instead of vanishing into it, the way
 * drawing the raw, unmixed hex directly on white did before.
 *
 * Not a hard WCAG AA guarantee for every possible input hue (no fixed mix
 * ratio can promise that against a fixed backdrop — same caveat the on-screen
 * pill's own math documents, see its test) — just the same pull toward the
 * readable end every other reading of a configured colour in this app gets.
 *
 * `hex` is assumed already validated to `#RRGGBB` (schemas/reserve.ts's Zod
 * schema and the database CHECK underneath it) — malformed input falls back
 * to black outright, never an unmixed passthrough.
 */
export function mixTowardBlack(hex: string, weight = 0.65): string {
  const match = HEX6.exec(hex);
  if (!match) return "#000000";
  const int = parseInt(match[1], 16);
  const mix = (shift: number) => Math.round(((int >> shift) & 0xff) * weight);
  return (
    "#" +
    [mix(16), mix(8), mix(0)].map((c) => c.toString(16).padStart(2, "0")).join("")
  );
}
