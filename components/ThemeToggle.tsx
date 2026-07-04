"use client";

import { SunIcon, MoonIcon } from "@heroicons/react/24/outline";

export default function ThemeToggle() {
  function toggle() {
    const isDark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", isDark ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Basculer le thème clair/sombre"
      className="flex h-10 w-10 items-center justify-center rounded border border-white/30 hover:bg-white/10 cursor-pointer"
    >
      {/* CSS picks the icon from the current .dark class — no state, no FOUC. */}
      <SunIcon className="hidden h-5 w-5 dark:block" />
      <MoonIcon className="block h-5 w-5 dark:hidden" />
    </button>
  );
}
