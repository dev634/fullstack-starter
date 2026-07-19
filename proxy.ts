import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Next.js 16 renamed the `middleware` file convention to `proxy`.
// We only need the edge-safe config here (no providers run in the proxy).
const { auth } = NextAuth(authConfig);

// Same route set the auth-gate matcher covered before the CSP nonce was
// added below — kept as an explicit check (rather than narrowing
// config.matcher) because the matcher now has to run on every page for the
// nonce, but sign-in/reset/API routes must stay reachable while logged out.
const PROTECTED_PATHS = [/^\/$/, /^\/clients(\/.*)?$/, /^\/projects(\/.*)?$/, /^\/admin(\/.*)?$/];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some((re) => re.test(pathname));
}

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
  if (isProtectedPath(req.nextUrl.pathname) && !req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return Response.redirect(loginUrl);
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
