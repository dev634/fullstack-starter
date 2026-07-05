import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { verifyCredentials } from "@/service/auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const user = await verifyCredentials({
          email: String(credentials?.email ?? ""),
          password: String(credentials?.password ?? ""),
        });

        // Returning null tells Auth.js the credentials are invalid.
        return user ?? null;
      },
    }),
  ],
  callbacks: {
    // Carry the role from the authorize() payload into the JWT, then into
    // the session, so server code can read session.user.role.
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
      }
      return session;
    },
  },
});
