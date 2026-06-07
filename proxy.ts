import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Next.js 16 renamed the `middleware` file convention to `proxy`.
// We only need the edge-safe config here (no providers run in the proxy).
const { auth } = NextAuth(authConfig);

// Protects the matched routes (see `config.matcher`): any request without a
// session is redirected to the sign-in page.
export const proxy = auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return Response.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/clients/:path*"],
};
