import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Normalizes a user-typed phone number to E.164 (e.g. "+995555123456"), or
 * returns null if it isn't a valid number. Numbers without a country code are
 * read in `defaultCountry`.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = "GE"): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}
