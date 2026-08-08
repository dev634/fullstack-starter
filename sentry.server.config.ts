import * as Sentry from "@sentry/nextjs";

// A no-op when SENTRY_DSN is unset (local dev, or before the key is
// configured in production) — same graceful-degradation pattern as
// Cloudinary/Resend.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  // @sentry/nextjs v10 auto-instruments the Anthropic and OpenAI SDKs
  // (lib/deliveryNoteScan.ts) as part of its default integrations, and by
  // default that instrumentation records prompt/response content on spans
  // when tracing is active. `tracesSampleRate: 0` above means no spans are
  // sent today, but that's not a substitute for this: raising the sample
  // rate later (a one-line change, easy to make without re-reading this
  // file) would start sending delivery-note photos' transcribed contents to
  // Sentry — a third party the data-handling policy for this feature never
  // accounted for. Pinning `recordInputs`/`recordOutputs` to false here
  // makes that choice explicit and independent of the sampling rate.
  integrations: [
    Sentry.anthropicAIIntegration({ recordInputs: false, recordOutputs: false }),
    Sentry.openAIIntegration({ recordInputs: false, recordOutputs: false }),
  ],
});
