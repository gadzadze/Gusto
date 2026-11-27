import { milliToInput } from "@/lib/quantity";

// "The usual": the buyer's most recent order per supplier, written for the assistant so "same as last time" can be answered. Short ids
// and the catalogue's own unit only; no prices, dates or order numbers.

export type PreviousOrder = { supplierName: string; lines: { id: string; qtyMilli: number; unit: string }[] };

/** At most this many suppliers and lines go into the prompt. */
export const MAX_PREVIOUS_SUPPLIERS = 5;
export const MAX_PREVIOUS_LINES = 25;

export function previousOrdersText(orders: PreviousOrder[]): string {
  return orders
    .filter((o) => o.lines.length > 0)
    .slice(0, MAX_PREVIOUS_SUPPLIERS)
    .map((o) => `${o.supplierName}: ${o.lines.slice(0, MAX_PREVIOUS_LINES).map((l) => `${l.id} ${milliToInput(l.qtyMilli, ".")} ${l.unit}`).join("; ")}`)
    .join("\n");
}
