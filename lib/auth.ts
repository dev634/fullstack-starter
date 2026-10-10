import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { authorizeCredentials } from "@/lib/authorizeCredentials";
import { keepLiveSessionToken } from "@/lib/sessionGate";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  // authConfig's own `jwt` only carries the role onto the token at sign-in —
  // it has to stay Edge-safe (no DB access), since the proxy runs on
  // authConfig alone. Node can go further: the session-liveness check
  // (lib/sessionGate.ts) belongs HERE, not in authConfig, because it needs
  // Prisma. Overriding `jwt` while spreading `...authConfig.callbacks` keeps
  // `session` (role propagation) unchanged.
  //
  // `params.user` is only present on a fresh sign-in (authorize() just ran,
  // the row was just read and the password just verified) — keepLiveSessionToken
  // is skipped there and runs on every OTHER call instead, i.e. every time an
  // existing cookie is re-read. When it returns `null`, next-auth voids the
  // session for this request: `auth()` resolves to `null` here in Node, and
  // lib/accessContext.ts treats that as DENIED. The proxy (Edge, authConfig
  // alone) still sees a structurally valid, correctly-signed cookie and lets
  // the request through regardless — it has no database to check against.
  // This Node layer is what actually closes the gap, because every guard
  // that matters (requireAppUser, getAccessContext, requireSession, …)
  // resolves its session through this `auth()`, not the proxy's.
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params);
      if (params.user) return token;
      return keepLiveSessionToken(token);
    },
  },
});
