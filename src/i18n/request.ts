import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import en from "../../messages/en.json";
import ka from "../../messages/ka.json";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";

const MESSAGES = { ka, en } satisfies Record<Locale, typeof ka>;

// The language is the visitor's choice, stored in a cookie. Reading it is request-time work, so
// everything that translates sits under the root layout's Suspense boundary.
export default getRequestConfig(async () => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(chosen) ? chosen : DEFAULT_LOCALE;
  return {
    locale,
    messages: MESSAGES[locale],
    // Fallback for formatting only. Org-specific dates pass the org's own
    // timezone explicitly (see CLAUDE.md, "Conventions").
    timeZone: "Asia/Tbilisi",
  };
});
