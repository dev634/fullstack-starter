import * as Sentry from "@sentry/nextjs";

// A no-op when SENTRY_DSN is unset (local dev, or before the key is
// configured in production) — same graceful-degradation pattern as
// Cloudinary/Resend.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
});
