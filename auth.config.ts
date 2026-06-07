import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration.
 *
 * This object is shared between the middleware (Edge runtime) and the full
 * `lib/auth.ts` instance (Node runtime). It must NOT import anything that
 * depends on Node APIs (Prisma, bcrypt, ...) — those live in `lib/auth.ts`.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    /**
     * Runs in the middleware for every matched request. Protects `/clients`:
     * unauthenticated users are redirected to the sign-in page.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtected = nextUrl.pathname.startsWith("/clients");

      if (isProtected) {
        return isLoggedIn;
      }

      return true;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
