import { headers } from "next/headers";
import { contrastTextColor, safeHex } from "@/lib/color";
import type { ResolvedReserveStatusStyle } from "@/lib/reserveStatusStyle";

/**
 * Emits one project's resolved OPEN/RESOLVED réserve colours as CSS custom
 * properties, inside a nonce-authorized <style> element — the ONLY thing
 * app/globals.css's `.reserve-pill-*`/`.reserve-pin-*` classes read their
 * colour from. Copies app/layout.tsx's --primary/--accent mechanism (a
 * per-request <style nonce>, never an inline style="" attribute — this app's
 * CSP has no 'unsafe-inline' for style-src, and only a <style> ELEMENT, never
 * a style ATTRIBUTE, is nonce-authorized), but scoped per-PROJECT instead of
 * global app settings: a project's chosen colours have no business in the
 * unconditional :root block app/layout.tsx already writes to.
 *
 * `:root` scope (not a wrapper class around the réserves tree) is safe here
 * because a page only ever renders ONE project's réserves at a time — the
 * project detail page and the client-portal project page each render exactly
 * one project — so there's never a second project's colours to collide with
 * on the same page.
 *
 * contrastTextColor is resolved here, server-side, rather than left to CSS:
 * picking pure black or white from a hex's WCAG relative luminance isn't
 * expressible in portable CSS without an extra dependency — it's the same
 * plain math lib/reservesReport.ts's PDF report already calls for the exact
 * same pins.
 */
export default async function ReserveStatusStyleVars({
  style,
}: {
  style: ResolvedReserveStatusStyle;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const openColor = safeHex(style.open.color, "#e11d48");
  const resolvedColor = safeHex(style.resolved.color, "#16a34a");
  const css =
    `:root{` +
    `--reserve-open:${openColor};` +
    `--reserve-resolved:${resolvedColor};` +
    `--reserve-open-text:${contrastTextColor(openColor)};` +
    `--reserve-resolved-text:${contrastTextColor(resolvedColor)}` +
    `}`;

  return (
    <style
      nonce={nonce}
      // Same expected SSR/client nonce mismatch as app/layout.tsx's own
      // branding <style> block — a fresh nonce is minted per request and
      // never exposed back via the DOM, so this isn't a real hydration bug.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
}
