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
} satisfies NextAuthConfig;
