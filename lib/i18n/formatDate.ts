import type { Locale } from "./locale";

/** Intl locale tag to use with Date#toLocaleDateString/toLocaleString for the active app locale. */
export function localeTag(locale: Locale): string {
    return locale === "fr" ? "fr-FR" : "en-US";
}
