// The languages the platform ships. The choice is a cookie (no URL prefix), so every address
// stays the same in both languages; Georgian is the default.
export const LOCALES = ["ka", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ka";
export const LOCALE_COOKIE = "gusto-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The Intl locale behind each language (number, currency and date formats). */
export function intlLocaleFor(locale: Locale): string {
  return locale === "en" ? "en-GB" : "ka-GE";
}
