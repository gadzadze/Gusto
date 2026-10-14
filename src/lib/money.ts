// Money is integer minor units (tetri for GEL) with an explicit currency.
// Never floats: amounts are parsed from text and multiplied as BigInt.
// Shared by server and client (form inputs, previews); see CLAUDE.md,
// "Conventions".

/** Largest amount accepted from a form, in minor units (10,000,000.00). */
export const MAX_MONEY_MINOR = 1_000_000_000;

/**
 * Parses a user-typed amount ("12", "12.5", "12,50", "1 250,00") into minor
 * units, or null if it isn't a non-negative amount with at most 2 decimals.
 */
export function parseMoneyInput(input: string): number | null {
  const normalized = input.trim().replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MONEY_MINOR) return null;
  return minor;
}

/**
 * Minor units → plain input text for form defaults (1250 → "12.50", or
 * "12,50" with a comma separator as Georgian writes it). parseMoneyInput
 * accepts either.
 */
export function minorToInput(minor: number, decimalSeparator: "." | "," = "."): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}${decimalSeparator}${String(abs % 100).padStart(2, "0")}`;
}

/** Formats minor units for display, e.g. 1250 GEL → "12,50 ₾" in ka-GE. */
export function formatMoney(minor: number, currency: string, locale = "ka-GE"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/** Integer division rounding halves away from zero (all inputs ≥ 0 here). */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) return -roundHalfUp(-numerator, denominator);
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Price of `qtyMilli` thousandths of a unit at `unitPriceMinor` per unit:
 * round_half_up(price × qty / 1000). The one place line totals are computed.
 */
export function lineTotalMinor(unitPriceMinor: number, qtyMilli: number): number {
  return Number(roundHalfUp(BigInt(unitPriceMinor) * BigInt(qtyMilli), 1000n));
}
