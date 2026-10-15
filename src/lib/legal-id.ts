// Georgian identification codes: 9 digits for a company (ს/კ), 11 for an
// individual entrepreneur. Only the shape can be checked here; whether the
// code belongs to this business is the admin's call (NAPR / RS.ge lookup).
export const LEGAL_ID_PATTERN = /^(\d{9}|\d{11})$/;

export function isValidLegalId(value: string): boolean {
  return LEGAL_ID_PATTERN.test(value);
}

/** Digits only: strips spaces and dashes people paste in. */
export function normalizeLegalId(value: string): string {
  return value.replace(/[\s-]/g, "");
}

// Personal mailboxes. A company address is a stronger signal than one of these,
// so the admin is warned (never blocked: many small businesses use them).
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "me.com", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "yandex.ru", "yandex.com", "proton.me",
  "protonmail.com", "aol.com", "gmx.com",
]);

export function isFreeMailAddress(email: string | null | undefined): boolean {
  const domain = email?.split("@")[1]?.trim().toLowerCase();
  return !!domain && FREE_MAIL_DOMAINS.has(domain);
}
