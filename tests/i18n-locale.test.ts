import { describe, it, expect } from "vitest";
import { localeFromAcceptLanguage, isLocale } from "@/lib/i18n/locale";

describe("localeFromAcceptLanguage", () => {
  it("defaults to French when there is no header", () => {
    expect(localeFromAcceptLanguage(null)).toBe("fr");
    expect(localeFromAcceptLanguage(undefined)).toBe("fr");
    expect(localeFromAcceptLanguage("")).toBe("fr");
  });

  it("picks English when the browser prefers it", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("picks French when the browser prefers it", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
  });

  it("respects q-value ordering even when English is listed first", () => {
    expect(localeFromAcceptLanguage("en;q=0.5,fr;q=0.9")).toBe("fr");
  });

  it("falls back to French for unsupported languages", () => {
    expect(localeFromAcceptLanguage("de-DE,de;q=0.9")).toBe("fr");
  });
});

describe("isLocale", () => {
  it("accepts fr and en", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
