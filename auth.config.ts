import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration.
 *
 * This object is shared between the proxy (Edge runtime) and the full
 * `lib/auth.ts` instance (Node runtime). It must NOT import anything that
 * depends on Node APIs (Prisma, bcrypt, ...) — those live in `lib/auth.ts`.
 *
 * Route protection lives in `proxy.ts` (the matched routes are redirected
 * to the sign-in page when there is no session).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  // Edge-safe (no DB/bcrypt): carry the role from the authorize() payload into
  // the JWT and back onto the session. These MUST live here in the shared
  // config — the proxy runs on `authConfig` alone, so without them
  // `req.auth.user.role` is undefined in the proxy and the CLIENT-portal
  // boundary can never fire (a client would then reach the whole app).
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.role = user.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
