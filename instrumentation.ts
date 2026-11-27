import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Start the image decode child now (not awaited: it never delays the server and never
    // throws), so /api/health reports `imageDecoder` from the first minute.
    const { warmImageDecoder } = await import("./lib/imageDecodeBridge");
    void warmImageDecoder();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
