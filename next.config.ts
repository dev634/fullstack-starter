import type { NextConfig } from "next";

// Content-Security-Policy is set per-request in middleware.ts instead of
// here, because it carries a fresh nonce on every response (a static header
// can't do that) — that's what lets script-src/style-src drop
// 'unsafe-inline'. The headers below are static and apply to every response
// as a baseline defense-in-depth layer.
const securityHeaders = [
  // Clickjacking: forbid the app being framed by other sites.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers MIME-sniffing responses into an unexpected content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which may carry tokens) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down powerful browser features. `geolocation=(self)` — not `()` —
  // because the réserves module reads the device position to stamp a snag with
  // GPS coordinates (see captureLocation in components/ReservesSection.tsx).
  // Denying it outright silently broke that button in production: the browser
  // rejects the call before the permission prompt ever appears.
  // camera/microphone stay fully denied: nothing here opens a media stream —
  // the delivery-note scan is a plain file input, not getUserMedia.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // Sever the window.opener link with cross-origin popups, and stop other
  // origins embedding our responses as subresources.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Force HTTPS for a year (the app is served behind TLS in production).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version to make fingerprinting harder.
  poweredByHeader: false,
  // pdfkit (réserves PDF export) reads its built-in font metrics from .afm
  // files inside its own package at runtime. Bundling it breaks those reads,
  // so keep it external and let Node require it from node_modules.
  serverExternalPackages: ["pdfkit"],
  experimental: {
    serverActions: {
      // Server Actions cap request bodies at 1 MB by default — well under a
      // typical phone photo, so every delivery-note scan
      // (lib/deliveryNoteScan.ts's MAX_BYTES) was rejected by Next itself
      // before the action's own 10 MB check ever ran. Must stay equal to
      // MAX_BYTES; if that constant changes, change this too.
      bodySizeLimit: 10 * 1024 * 1024,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
