"use client";

import { logout } from "@/actions/auth/auth";

export default function LogoutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer">
        Logout
      </button>
    </form>
  );
}
