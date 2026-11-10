// Price conditions: how a list price changes with the payment method, the payment interval and the
// ordered quantity. Pure and shared by the server (which decides prices) and the forms (which preview).
//
// A change is in basis points (100 = 1%, negative = cheaper). The three parts are added up, then applied
// to the list price once. A product's own rows replace the whole list's rows for that product.

export const PAYMENT_METHODS = ["cash", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Payment intervals offered as ready rows (days after delivery; 0 = on delivery). Others can be added. */
export const INTERVAL_PRESETS = [0, 7, 14, 30] as const;

export type PriceRule = {
  /** null = the whole price list. */
  productId: string | null;
  kind: "method" | "interval" | "qty";
  method: PaymentMethod | null;
  intervalDays: number | null;
  minQtyMilli: number | null;
  adjustBp: number;
};

export type Terms = { method: PaymentMethod | null; intervalDays: number | null };
export const NO_TERMS: Terms = { method: null, intervalDays: null };

export type Conditions = {
  methods: Map<PaymentMethod, number>;
  intervals: Map<number, number>;
  /** Sorted by quantity, ascending. */
  tiers: { minQtyMilli: number; adjustBp: number }[];
};

/** The rules in force for one product: its own rows win over the list's, per method, interval and (as a set) tiers. */
export function conditionsFor(rules: readonly PriceRule[], productId: string | null): Conditions {
  const methods = new Map<PaymentMethod, number>();
  const intervals = new Map<number, number>();
  const tiers = new Map<number, number>();
  for (const scope of [null, productId]) {
    if (scope !== null && productId === null) continue;
    const mine = rules.filter((r) => r.productId === scope);
    for (const r of mine) {
      if (r.kind === "method" && r.method) methods.set(r.method, r.adjustBp);
      if (r.kind === "interval" && r.intervalDays !== null) intervals.set(r.intervalDays, r.adjustBp);
    }
    if (scope !== null && mine.some((r) => r.kind === "qty")) tiers.clear(); // own tiers replace the list's
    for (const r of mine) if (r.kind === "qty" && r.minQtyMilli !== null) tiers.set(r.minQtyMilli, r.adjustBp);
  }
  return {
    methods,
    intervals,
    tiers: [...tiers].map(([minQtyMilli, adjustBp]) => ({ minQtyMilli, adjustBp })).sort((a, b) => a.minQtyMilli - b.minQtyMilli),
  };
}

/** The tier a quantity reaches (the highest one at or below it), or 0 when none. */
export function tierBp(conditions: Conditions, qtyMilli: number): number {
  let bp = 0;
  for (const tier of conditions.tiers) if (qtyMilli >= tier.minQtyMilli) bp = tier.adjustBp;
  return bp;
}

/** Method + interval change for these terms; a choice with no row counts as 0. */
export function termsBp(conditions: Conditions, terms: Terms): number {
  const method = terms.method ? (conditions.methods.get(terms.method) ?? 0) : 0;
  const interval = terms.intervalDays !== null ? (conditions.intervals.get(terms.intervalDays) ?? 0) : 0;
  return method + interval;
}

/** Total change for a product line: payment terms plus the quantity tier. */
export function adjustmentBp(rules: readonly PriceRule[], productId: string, qtyMilli: number, terms: Terms): number {
  const conditions = conditionsFor(rules, productId);
  return termsBp(conditions, terms) + tierBp(conditions, qtyMilli);
}

/** price × (1 + bp/10000), rounded half up, never below 0. Integer maths only. */
export function applyBp(priceMinor: number, bp: number): number {
  if (bp === 0) return priceMinor;
  return Math.max(0, Math.floor((priceMinor * (10000 + bp) * 2 + 10000) / 20000));
}

/** "-3%", "+2.5%", "0%": for showing a change. */
export function formatBp(bp: number): string {
  const percent = bp / 100;
  const text = Number.isInteger(percent) ? String(Math.abs(percent)) : Math.abs(percent).toFixed(2).replace(/0$/, "");
  return bp > 0 ? `+${text}%` : bp < 0 ? `-${text}%` : "0%";
}

export const MIN_BP = -9000;
export const MAX_BP = 5000;

/** "-3", "+2,5", "0": a percentage typed by a person, as basis points; null when it isn't one or is out of range. */
export function parsePercentInput(input: string): number | null {
  const text = input.trim().replace(",", ".").replace(/%$/, "").trim();
  if (!/^[+-]?\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const bp = Math.round(Number(text) * 100);
  return bp >= MIN_BP && bp <= MAX_BP ? bp : null;
}

/** Basis points as the text a person types back ("-3", "2.5", "0"). */
export function bpToInput(bp: number): string {
  return String(bp / 100);
}
