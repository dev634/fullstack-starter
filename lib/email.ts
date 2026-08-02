/**
 * Minimal pluggable email sender. Uses Resend's REST API (no SDK dependency
 * needed — a single fetch call) when RESEND_API_KEY is set; otherwise logs
 * the message to the server console so local dev and a fresh production
 * deploy (before the key is configured) can still exercise the full flow.
 */

import { renderEmail, type EmailBrand } from "@/lib/email/render";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always send one: clients that prefer text render
   * it, and its absence is a spam signal. `renderEmail` produces both. */
  text?: string;
};

export async function sendEmail({ to, subject, html, text }: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // Never log the email body in production — it may carry a live
      // password-reset link/token, and anyone with log access could use it
      // to take over the account. Fail loudly instead of a silent "sent".
      console.error("sendEmail skipped: RESEND_API_KEY is not set in production.");
      throw { type: "error", message: "Failed to send the email. Please try again." };
    }
    console.log(`[email:dev-fallback] To: ${to} | Subject: ${subject}\n${text ?? html}`);
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, ...(text ? { text } : {}) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("sendEmail failed:", res.status, body);
    throw { type: "error", message: "Failed to send the email. Please try again." };
  }
}

/**
 * Password-reset email, rendered through the shared layout so it picks up the
 * app's configured name, logo and primary colour.
 *
 * The strings arrive already localised: the caller is a server action that has
 * resolved the request's dictionary, and this module stays presentational so it
 * can be rendered (and tested) without a request context.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  options: { brand: EmailBrand; strings: PasswordResetStrings }
): Promise<void> {
  const { brand, strings } = options;
  const { html, text } = renderEmail(brand, {
    preview: strings.preview,
    heading: strings.heading,
    paragraphs: [strings.intro],
    cta: { label: strings.cta, url: resetUrl },
    footnote: strings.footnote,
  });

  await sendEmail({ to, subject: strings.subject, html, text });
}

export type PasswordResetStrings = {
  subject: string;
  preview: string;
  heading: string;
  intro: string;
  cta: string;
  footnote: string;
};
