import type { NextConfig } from "next";

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
];

const nextConfig: NextConfig = {
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
