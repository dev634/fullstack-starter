import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, localeFromAcceptLanguage, type Locale } from "./locale";

/**
 * Resolves the active locale for the current request: an explicit cookie
 * (set via the navbar toggle) wins, otherwise fall back to the browser's
 * Accept-Language header, defaulting to French.
 */
export async function getLocale(): Promise<Locale> {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieLocale)) return cookieLocale;

    const headerStore = await headers();
    return localeFromAcceptLanguage(headerStore.get("accept-language"));
}

export { DEFAULT_LOCALE };
