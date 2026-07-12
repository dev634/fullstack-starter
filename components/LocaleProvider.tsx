"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

type LocaleContextValue = {
  locale: Locale;
  t: Dictionary;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: getDictionary(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Client-side translation dictionary access — mirrors getLocale()/getDictionary() used in Server Components. */
export function useTranslation(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useTranslation must be used within a LocaleProvider");
  return ctx;
}
