import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { isProtectedPath, isPortalPath } from "@/lib/routeGuard";

// Next.js 16 renamed the `middleware` file convention to `proxy`.
// We only need the edge-safe config here (no providers run in the proxy).
const { auth } = NextAuth(authConfig);

// Per-request nonce so script-src/style-src can drop 'unsafe-inline' (a
// static CSP, e.g. in next.config.ts, can't carry a per-request value —
// hence this lives here). Exposed to Server Components via the x-nonce
// request header (read in app/layout.tsx) and is the only thing that
// authorizes the two inline tags the app actually needs: the no-FOUC theme
// <script> and the branding-color <style> block.
function buildCsp(nonce: string): string {
  const scriptSrc = process.env.NODE_ENV === "production"
    ? `script-src 'self' 'nonce-${nonce}'`
    : `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`;

  return [
    "default-src 'self'",
    scriptSrc,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https://res.cloudinary.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Protects the routes matched by isProtectedPath: any request without a
// session is redirected to the sign-in page. Every request that reaches
// this proxy (see `config.matcher`) also gets a fresh CSP nonce.
export const proxy = auth((req) => {
  const { pathname, origin } = req.nextUrl;

  if (isProtectedPath(pathname) && !req.auth) {
    return Response.redirect(new URL("/login", origin));
  }

  // Client-portal boundary. A CLIENT login may only ever reach /portail — any
  // other protected app page bounces it back there, so it can never load the
  // unscoped company/project/admin pages. Conversely the portal is CLIENT-only.
  if (req.auth) {
    const role = req.auth.user?.role;
    const onPortal = isPortalPath(pathname);
    if (role === "CLIENT") {
      if (isProtectedPath(pathname) && !onPortal) {
        return Response.redirect(new URL("/portail", origin));
      }
    } else if (onPortal) {
      return Response.redirect(new URL("/", origin));
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
});

export const config = {
  matcher: [
    // Everything except static assets, which don't need a nonce and don't
    // execute inline scripts/styles.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
