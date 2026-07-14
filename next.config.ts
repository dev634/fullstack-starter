import type { NextConfig } from "next";

// Defense-in-depth against XSS: scripts/styles/connections restricted to
// same-origin. 'unsafe-inline' is needed for the no-FOUC theme script in
// app/layout.tsx and the inline style={{}} colors in the chart components
// (recharts/SVG fills can't be set from an external stylesheet) — this still
// blocks the common XSS payload shape of loading a remote script or
// exfiltrating data to a remote origin.
// 'unsafe-eval' is added only in dev: React's dev-mode debugging (stack
// reconstruction, Fast Refresh) uses eval() but never does in production —
// see the console warning this avoids: "React will never use eval() in
// production mode".
const scriptSrc = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://res.cloudinary.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Applied to every response as a baseline defense-in-depth layer.
const securityHeaders = [
  // Clickjacking: forbid the app being framed by other sites.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers MIME-sniffing responses into an unexpected content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which may carry tokens) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down powerful browser features we don't use.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Force HTTPS for a year (the app is served behind TLS in production).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version to make fingerprinting harder.
  poweredByHeader: false,
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
