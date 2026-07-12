"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/actions/locale/locale";
import { useTranslation } from "@/components/LocaleProvider";
import type { Locale } from "@/lib/i18n/locale";

export default function LocaleToggle() {
  const { locale, t } = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale || isPending) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div
      className="flex h-10 items-center overflow-hidden rounded border border-white/30 text-xs font-medium"
      role="group"
      aria-label={t.nav.switchToFrench + " / " + t.nav.switchToEnglish}
    >
      <button
        type="button"
        onClick={() => switchTo("fr")}
        aria-pressed={locale === "fr"}
        aria-label={t.nav.switchToFrench}
        disabled={isPending}
        className={`h-full px-2.5 cursor-pointer ${
          locale === "fr" ? "bg-white/20" : "hover:bg-white/10"
        }`}
      >
        FR
      </button>
      <button
        type="button"
        onClick={() => switchTo("en")}
        aria-pressed={locale === "en"}
        aria-label={t.nav.switchToEnglish}
        disabled={isPending}
        className={`h-full px-2.5 cursor-pointer ${
          locale === "en" ? "bg-white/20" : "hover:bg-white/10"
        }`}
      >
        EN
      </button>
    </div>
  );
}
