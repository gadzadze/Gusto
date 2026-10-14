import { lineTotalMinor, roundHalfUp } from "@/lib/money";

// Order totals. The one place line totals and VAT are computed; used by the
// cart, checkout, submit and confirm so they can never disagree.
//
// VAT is computed per line (rounded half up) and summed, the way an invoice
// lists it. Prices either include VAT (it is taken out of the price) or
// exclude it (it is added on top) — a per-supplier setting.

export type TotalsLine = { unitPriceMinor: number; vatRateBp: number; qtyMilli: number };

export type Totals = {
  lines: { lineTotalMinor: number; vatMinor: number }[];
  /** Net amount (excluding VAT). */
  subtotalMinor: number;
  vatMinor: number;
  /** Amount payable (including VAT). */
  totalMinor: number;
  /** Sum of line totals as priced; what the supplier's minimum order is compared against. */
  goodsMinor: number;
};

export function computeTotals(lines: TotalsLine[], pricesIncludeVat: boolean): Totals {
  let goods = 0;
  let vat = 0;
  const out = lines.map((line) => {
    const lineTotal = lineTotalMinor(line.unitPriceMinor, line.qtyMilli);
    const lineVat = pricesIncludeVat
      ? Number(roundHalfUp(BigInt(lineTotal) * BigInt(line.vatRateBp), BigInt(10_000 + line.vatRateBp)))
      : Number(roundHalfUp(BigInt(lineTotal) * BigInt(line.vatRateBp), 10_000n));
    goods += lineTotal;
    vat += lineVat;
    return { lineTotalMinor: lineTotal, vatMinor: lineVat };
  });
  return pricesIncludeVat
    ? { lines: out, subtotalMinor: goods - vat, vatMinor: vat, totalMinor: goods, goodsMinor: goods }
    : { lines: out, subtotalMinor: goods, vatMinor: vat, totalMinor: goods + vat, goodsMinor: goods };
}

/** How much more (in the same terms as `goodsMinor`) is needed to reach the minimum; 0 if reached. */
export function minimumOrderShortfall(goodsMinor: number, minOrderMinor: number): number {
  return Math.max(0, minOrderMinor - goodsMinor);
}
