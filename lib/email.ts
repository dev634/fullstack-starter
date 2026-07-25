/**
 * Minimal pluggable email sender. Uses Resend's REST API (no SDK dependency
 * needed — a single fetch call) when RESEND_API_KEY is set; otherwise logs
 * the message to the server console so local dev and a fresh production
 * deploy (before the key is configured) can still exercise the full flow.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<void> {
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
    console.log(`[email:dev-fallback] To: ${to} | Subject: ${subject}\n${html}`);
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("sendEmail failed:", res.status, body);
    throw { type: "error", message: "Failed to send the email. Please try again." };
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Réinitialise ton mot de passe",
    html: `
      <p>Tu as demandé à réinitialiser ton mot de passe.</p>
      <p><a href="${resetUrl}">Clique ici pour choisir un nouveau mot de passe</a>.</p>
      <p>Ce lien expire dans 1 heure. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
    `,
  });
}
