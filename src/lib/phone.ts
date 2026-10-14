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

/** E.164 → readable international format ("+995 599 00 00 00"); unchanged if unparseable. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
