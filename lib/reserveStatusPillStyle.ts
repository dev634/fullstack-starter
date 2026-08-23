import type { CSSProperties } from "react";

/**
 * Inline CSS for the réserve status "pill" (ReserveStatusBadge) from a
 * single configured colour. Before per-project colours existed, the pill had
 * SIX hand-picked Tailwind shades per status — border/background/text, each
 * doubled for light+dark mode (ReserveStatusBadge's old `STATUS_CLASSES`
 * table). Tailwind can't generate a class from a value only known at
 * request time (`dark:text-[${hex}]` is never scanned — the JIT engine reads
 * literal source text, not a runtime template), so this composes the same
 * look with `color-mix()` instead, and a project's one stored hex has to
 * stand in for all six.
 *
 * Two different mechanisms, deliberately:
 *
 * - **background / border: true alpha compositing**, mixing the colour with
 *   `transparent`. Painted over whatever is actually behind the pill, this
 *   reads as a pale wash on this app's light card background and a dim tint
 *   on its dark one — automatically, with nothing to branch on. It's the
 *   exact same trick the old dark-mode classes already relied on
 *   (`bg-rose-500/15`, `border-rose-500/30` ARE colour-at-alpha), just typed
 *   out instead of picked from Tailwind's fixed palette.
 *
 * - **text: NOT alpha compositing**, and that's the point to get right.
 *   Blending translucent text toward whatever's behind it moves the
 *   RENDERED colour toward that backdrop — the wrong direction for
 *   contrast: translucent red over a light card gets lighter/pinker, not
 *   darker, which is the opposite of what reading text on a pale background
 *   needs. Checked against this app's own two card backgrounds (`#f3f4f6`
 *   light / `#1f2937` dark) at full, opaque opacity, BOTH product defaults
 *   already miss WCAG AA (4.5:1) in at least one mode: the rose default
 *   (`#e11d48`) is ~4.27:1 on the light card, the green default
 *   (`#16a34a`) is ~3.0:1 on the light card and ~4.4:1 on the dark one — so
 *   plain alpha text was never going to clear the bar for either default,
 *   let alone an arbitrary admin-picked hue. Instead the text colour is
 *   mixed 65/35 toward `--pill-text-mix`, one CSS custom property flipped by
 *   the SAME `.dark` class that already flips `--background`/`--foreground`
 *   in app/globals.css (black in light mode, white in dark) — a single
 *   shared global declaration, not a `dark:` utility repeated at every
 *   badge. At 65/35 both defaults clear AA with margin in both modes
 *   (~8.1:1 / ~4.9:1 for rose light/dark, ~6.1:1 / ~6.8:1 for green
 *   light/dark — see this module's test for the numbers). A custom colour
 *   an admin picks isn't mathematically guaranteed to clear AA (no fixed
 *   mix ratio can promise that for every possible hue against a fixed
 *   backdrop), but the same 65/35 pull toward black/white pushes any hue
 *   toward the readable end rather than leaving it at full saturation.
 *
 * `hex` is assumed already validated to `#RRGGBB` (the shape every colour
 * this app stores is constrained to — schemas/reserve.ts's Zod schema and
 * the database CHECK underneath it, same assumption `contrastTextColor`
 * documents for itself in lib/color.ts) — not re-validated here.
 */
export function reserveStatusPillStyle(hex: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${hex} 35%, transparent)`,
    color: `color-mix(in srgb, ${hex} 65%, var(--pill-text-mix))`,
  };
}
