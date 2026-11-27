import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

// /_next/image is reachable without authentication (proxy.ts excludes it). With a remote
// pattern it fetches and decodes what the URL designates, outside the sharp queue of
// lib/imageMetadata.ts; a "res.cloudinary.com" pattern without pathname admitted ANY
// Cloudinary account. The optimizer stays closed to remote URLs: components/ClientAvatar.tsx,
// its only user, renders Cloudinary's own transformation `unoptimized`.
describe("next.config images — the optimizer is off, and closed to remote URLs anyway", () => {
  // next-server must never load sharp through /_next/image: that decode would run outside
  // the decode child (deadline, memory bound, queue).
  it("is switched off", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it("opens no remotePattern", () => {
    expect(nextConfig.images?.remotePatterns ?? []).toEqual([]);
  });

  it("opens no legacy `domains` allowlist either", () => {
    expect(nextConfig.images?.domains ?? []).toEqual([]);
  });

  it("does not enable dangerouslyAllowSVG", () => {
    expect(nextConfig.images?.dangerouslyAllowSVG ?? false).toBe(false);
  });

  // Left at Next's default (`**`), the optimizer fetches any path of this
  // origin without the caller's session. Only the build's static media.
  it("restricts same-origin sources to the build's static media", () => {
    expect(nextConfig.images?.localPatterns).toEqual([{ pathname: "/_next/static/media/**" }]);
  });
});
