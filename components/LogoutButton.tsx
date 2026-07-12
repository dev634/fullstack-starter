"use client";

import { logout } from "@/actions/auth/auth";
import { useTranslation } from "@/components/LocaleProvider";

export default function LogoutButton() {
  const { t } = useTranslation();
  return (
    <form action={logout}>
      <button type="submit" className="hover:text-gray-600 dark:hover:text-gray-400 cursor-pointer">
        {t.nav.logout}
      </button>
    </form>
  );
}
