'use client'
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/components/LocaleProvider";

// Tab navigation between the SUPERADMIN settings sub-pages (Theme / Section
// order). Client component so it can highlight the active tab via the path.
export default function AdminSettingsNav() {
  const { t } = useTranslation();
  const pathname = usePathname();

  const tabs = [
    { href: "/admin/settings", label: t.appSettings.tabs.theme },
    { href: "/admin/settings/sections", label: t.appSettings.tabs.sections },
  ];

  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-300 dark:border-gray-700">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium no-underline ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
