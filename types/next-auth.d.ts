import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: "SUPERADMIN" | "ADMIN" | "VIEWER";
  }

  interface Session {
    user: {
      role?: "SUPERADMIN" | "ADMIN" | "VIEWER";
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "SUPERADMIN" | "ADMIN" | "VIEWER";
  }
}
