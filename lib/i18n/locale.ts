export type Locale = "fr" | "en";

export const LOCALES: Locale[] = ["fr", "en"];
export const DEFAULT_LOCALE: Locale = "fr";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined | null): value is Locale {
    return value === "fr" || value === "en";
}

/** Picks "en" if the browser's Accept-Language prefers English over French, otherwise "fr". */
export function localeFromAcceptLanguage(acceptLanguage: string | null | undefined): Locale {
    if (!acceptLanguage) return DEFAULT_LOCALE;
    const tags = acceptLanguage
        .split(",")
        .map((part) => {
            const [tag, qPart] = part.trim().split(";q=");
            return { tag: tag.toLowerCase(), q: qPart ? parseFloat(qPart) : 1 };
        })
        .sort((a, b) => b.q - a.q);

    for (const { tag } of tags) {
        if (tag.startsWith("fr")) return "fr";
        if (tag.startsWith("en")) return "en";
    }
    return DEFAULT_LOCALE;
}
