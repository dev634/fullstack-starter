import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: "ADMIN" | "VIEWER";
  }

  interface Session {
    user: {
      role?: "ADMIN" | "VIEWER";
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "ADMIN" | "VIEWER";
  }
}
