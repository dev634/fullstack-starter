import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: "SUPERADMIN" | "ADMIN" | "EDITOR" | "VIEWER";
  }

  interface Session {
    user: {
      role?: "SUPERADMIN" | "ADMIN" | "EDITOR" | "VIEWER";
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "SUPERADMIN" | "ADMIN" | "EDITOR" | "VIEWER";
  }
}
