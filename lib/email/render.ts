/**
 * Shared rendering for transactional emails.
 *
 * Email is not the web: stylesheets are stripped, flexbox and grid are
 * unreliable, and several clients still lay out with a Word engine. So the
 * layout is a fixed-width table with inline styles — deliberately dated HTML,
 * because it is what actually renders everywhere.
 *
 * Every template goes through `renderEmail`, which produces the HTML **and**
 * the plain-text alternative from the same content. Writing the two by hand is
 * how they drift, and the text part is not optional: clients that show it
 * (and spam filters that read it) treat a missing text/plain as a bad signal.
 */

import { contrastTextColor } from "@/lib/color";

/** Escape a value destined for HTML. Templates interpolate user data — a
 * réserve description, a project name — so this is the default, not an option. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape a URL for an href. Anything that isn't http(s) is dropped: a template
 * must never be able to emit `javascript:` into a link.
 */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "#";
    return escapeHtml(parsed.toString());
  } catch {
    return "#";
  }
}

export type EmailBrand = {
  /** Shown as the wordmark and in the footer — the app's configured name. */
  name: string;
  /** Button and accent colour, from the app settings. */
  primaryColor: string;
  /** Absolute https URL, or null to fall back to the wordmark. */
  logoUrl?: string | null;
};

export type EmailContent = {
  /** The grey preview line inboxes show next to the subject. */
  preview: string;
  heading: string;
  /** Body paragraphs, as plain text — escaped at render time. */
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** Small print under the button (expiry notice, "ignore this email", …). */
  footnote?: string;
};

const TEXT = "#111827";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const CANVAS = "#f3f4f6";
// Must be repeated on every text element: mail clients don't inherit reliably,
// and without it they fall back to their own default — usually a serif.
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Render one email into the HTML and plain-text bodies Resend expects. */
export function renderEmail(brand: EmailBrand, content: EmailContent): { html: string; text: string } {
  const name = escapeHtml(brand.name);
  const color = /^#[0-9a-f]{3,8}$/i.test(brand.primaryColor) ? brand.primaryColor : "#3b82f6";
  // The button's own text used to be hard-coded #ffffff regardless of the
  // background: a pale configured primaryColor already renders every
  // transactional email's call-to-action unreadable today. contrastTextColor
  // only understands a strict 6-digit #RRGGBB (the shape every colour this
  // app itself ever writes is validated to) — a shorthand/alpha form the
  // regex above tolerates but this app never produces falls back to white,
  // same as before this function existed.
  const ctaTextColor = contrastTextColor(color);

  const header = brand.logoUrl
    ? `<img src="${safeUrl(brand.logoUrl)}" alt="${name}" height="32" style="display:block;height:32px;width:auto;border:0;">`
    : `<span style="font-family:${FONT};font-size:18px;font-weight:700;color:${TEXT};">${name}</span>`;

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">${escapeHtml(p)}</p>`
    )
    .join("");

  // Table-wrapped so the padding survives clients that ignore it on <a>.
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
         <tr><td style="border-radius:6px;background-color:${color};">
           <a href="${safeUrl(content.cta.url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:${ctaTextColor};text-decoration:none;border-radius:6px;">${escapeHtml(content.cta.label)}</a>
         </td></tr>
       </table>`
    : "";

  const footnote = content.footnote
    ? `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${escapeHtml(content.footnote)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CANVAS};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${BORDER};border-radius:12px;">
      <tr><td style="padding:24px 32px;border-bottom:1px solid ${BORDER};">${header}</td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:20px;line-height:1.3;color:${TEXT};">${escapeHtml(content.heading)}</h1>
        ${paragraphs}
        ${cta}
        ${footnote}
      </td></tr>
      <tr><td style="padding:16px 32px 24px;border-top:1px solid ${BORDER};">
        <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};">${name}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Same content, no markup — never hand-written separately, so it can't drift.
  const text = [
    content.heading,
    "",
    ...content.paragraphs,
    ...(content.cta ? ["", `${content.cta.label} : ${content.cta.url}`] : []),
    ...(content.footnote ? ["", content.footnote] : []),
    "",
    "—",
    brand.name,
  ].join("\n");

  return { html, text };
}
