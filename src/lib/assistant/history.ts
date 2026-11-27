// What a buyer usually orders from one supplier, worked out from their own earlier orders. Pure: the server reads the orders, this
// decides what is "typical" and what is probably running low, so the rules are testable without a database.

export type HistoryOrder = { at: Date; lines: { productId: string; qtyMilli: number }[] };

/** The orders considered per supplier. */
export const HISTORY_ORDERS = 6;
/** With fewer orders than this, "the usual" is simply the latest order. */
const MIN_FOR_TYPICAL = 3;
const DAY_MS = 86_400_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The usual order: with enough history, every product in at least half of the orders (and at least two) at its median quantity;
 * otherwise the latest order. `orders` is newest first.
 */
export function typicalOrder(orders: HistoryOrder[]): { productId: string; qtyMilli: number }[] {
  if (orders.length === 0) return [];
  if (orders.length < MIN_FOR_TYPICAL) return orders[0].lines.filter((l) => l.qtyMilli > 0);
  const need = Math.max(2, Math.ceil(orders.length / 2));
  const seen = new Map<string, number[]>();
  for (const order of orders) for (const l of order.lines) if (l.qtyMilli > 0) seen.set(l.productId, [...(seen.get(l.productId) ?? []), l.qtyMilli]);
  const typical = [...seen.entries()].filter(([, q]) => q.length >= need).map(([productId, q]) => ({ productId, qtyMilli: median(q) }));
  // A buyer whose orders never overlap still gets something sensible: fall back to the latest order.
  return typical.length > 0 ? typical : orders[0].lines.filter((l) => l.qtyMilli > 0);
}

export type DueProduct = { productId: string; qtyMilli: number; everyDays: number; daysSince: number };

/**
 * Products this buyer reorders regularly (at least three orders) whose usual gap has nearly passed: probably running low.
 * `orders` is newest first.
 */
export function dueProducts(orders: HistoryOrder[], now: Date): DueProduct[] {
  const byProduct = new Map<string, { at: Date; qtyMilli: number }[]>();
  for (const order of orders) for (const l of order.lines) if (l.qtyMilli > 0) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), { at: order.at, qtyMilli: l.qtyMilli }]);
  const out: DueProduct[] = [];
  for (const [productId, entries] of byProduct) {
    if (entries.length < 3) continue;
    const times = entries.map((e) => e.at.getTime()).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS);
    const every = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (every < 1) continue;
    const since = (now.getTime() - times[times.length - 1]) / DAY_MS;
    if (since >= every * 0.8) out.push({ productId, qtyMilli: median(entries.map((e) => e.qtyMilli)), everyDays: Math.round(every), daysSince: Math.round(since) });
  }
  return out.sort((a, b) => b.daysSince / b.everyDays - a.daysSince / a.everyDays);
}
