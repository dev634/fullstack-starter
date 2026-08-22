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
      // typical phone photo. This must stay >= the LARGEST of this app's own
      // per-feature upload ceilings (lib/cloudinary.ts, lib/deliveryNoteScan.ts),
      // or a file the app itself tells the user it accepts is rejected by
      // Next before that feature's own check ever runs — the user sees a
      // framework-level failure, never the localized message, on a file
      // that's actually within the announced limit. Proven reachable
      // (fix/blocked-legitimate-input, point 4): with this at 10 MB, a
      // réserve plan between 10 MB and MAX_RESERVE_PLAN_BYTES (25 MB, the
      // largest ceiling in the app — client photo 5 MB, logo 2 MB, project
      // file 20 MB, réserve photo 10 MB, delivery-note scan 10 MB all fit
      // under it) could never be uploaded at all, despite the plan-upload
      // form and its server action both advertising 25 MB. Raised to match
      // the highest declared ceiling rather than lowering it: none of those
      // per-feature limits were wrong on their own, and a large architectural
      // plan as a scanned PDF is a real, expected file for this field.
      // Bump this if a ceiling above 25 MB is ever introduced.
      bodySizeLimit: 25 * 1024 * 1024,
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
