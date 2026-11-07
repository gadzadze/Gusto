import "server-only";
import { getLocale } from "next-intl/server";
import { intlLocaleFor, type Locale } from "@/i18n/locales";
import { formatMoney } from "@/lib/money";
import { formatQuantityNumber, milliToInput } from "@/lib/quantity";

/**
 * Money and quantities written the way the visitor's language does it ("12,50 ₾" / "₾12.50",
 * "2,5" / "2.5"). Formatting happens on the server (CLAUDE.md, "Conventions"), so pages ask
 * for these once per render.
 */
export async function getFormats() {
  const locale = (await getLocale()) as Locale;
  const intl = intlLocaleFor(locale);
  const separator = locale === "en" ? "." : ",";
  return {
    locale,
    money: (minor: number, currency: string) => formatMoney(minor, currency, intl),
    qty: (milli: number) => formatQuantityNumber(milli, intl),
    /** A quantity as plain text for display or a form field's starting value. */
    input: (milli: number) => milliToInput(milli, separator),
  };
}
