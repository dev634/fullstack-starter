import type { DefaultSession } from "next-auth";
import type { Role } from "@/app/generated/prisma/client";

declare module "next-auth" {
  interface User {
    role?: Role;
    sessionVersion?: number;
  }

  interface Session {
    user: {
      role?: Role;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    /** User.sessionVersion at sign-in; absent on cookies issued before it existed (read as 0). */
    sessionVersion?: number;
  }
}
