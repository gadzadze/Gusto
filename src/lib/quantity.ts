// Quantities are integer thousandths of the product's unit (`*_milli`):
// 2.5 kg = 2500, 3 boxes = 3000. See CLAUDE.md, "Conventions".

export const MILLI = 1000;
/** Largest quantity accepted from a form (1,000,000 units). */
export const MAX_QTY_MILLI = 1_000_000_000;

/**
 * Parses "2", "2.5" or "2,5" into milli-units. Returns null for negatives,
 * more than 3 decimals or non-numbers. Zero parses to 0; callers decide
 * whether zero is allowed.
 */
export function parseQuantityInput(input: string): number | null {
  const normalized = input.trim().replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const milli = Number(whole) * MILLI + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(milli) || milli > MAX_QTY_MILLI) return null;
  return milli;
}

/** Milli-units → plain input text (2500 → "2.5", or "2,5" with a comma separator). */
export function milliToInput(milli: number, decimalSeparator: "." | "," = "."): string {
  const whole = Math.floor(milli / MILLI);
  const fraction = String(milli % MILLI).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}${decimalSeparator}${fraction}` : String(whole);
}

/** Milli-units → localized number text (2500 → "2,5" in ka-GE). */
export function formatQuantityNumber(milli: number, locale = "ka-GE"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(milli / MILLI);
}

/**
 * A quantity can be ordered if it is at least the minimum and lands on a step
 * counted from that minimum (min 2, step 1 → 2, 3, 4…; min 0.5, step 0.5 →
 * 0.5, 1, 1.5…).
 */
export function isOrderableQuantity(qtyMilli: number, minMilli: number, stepMilli: number): boolean {
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli < minMilli || stepMilli <= 0) return false;
  return (qtyMilli - minMilli) % stepMilli === 0;
}
