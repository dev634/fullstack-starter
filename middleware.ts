import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// The middleware only needs the edge-safe config (no providers run here);
// the `authorized` callback decides which routes require a session.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/clients/:path*"],
};
