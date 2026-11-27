import { describe, expect, it } from "vitest";
import { dueProducts, typicalOrder, type HistoryOrder } from "@/lib/assistant/history";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 86_400_000);
const order = (n: number, lines: [string, number][]): HistoryOrder => ({ at: day(n), lines: lines.map(([productId, qtyMilli]) => ({ productId, qtyMilli })) });

describe("typicalOrder", () => {
  it("is nothing without orders and the latest order with fewer than three", () => {
    expect(typicalOrder([])).toEqual([]);
    expect(typicalOrder([order(9, [["a", 2000]]), order(2, [["b", 1000]])])).toEqual([{ productId: "a", qtyMilli: 2000 }]);
  });

  it("keeps what is in at least half of the orders, at its median quantity, and drops one-offs", () => {
    const orders = [order(20, [["a", 2000], ["b", 5000], ["x", 1000]]), order(13, [["a", 3000], ["b", 5000]]), order(6, [["a", 2000], ["c", 1000]]), order(0, [["a", 4000], ["b", 5000]])];
    expect(typicalOrder(orders).sort((p, q) => p.productId.localeCompare(q.productId))).toEqual([{ productId: "a", qtyMilli: 2500 }, { productId: "b", qtyMilli: 5000 }]);
  });

  it("falls back to the latest order when nothing repeats", () => {
    expect(typicalOrder([order(9, [["a", 1000]]), order(5, [["b", 1000]]), order(1, [["c", 1000]])])).toEqual([{ productId: "a", qtyMilli: 1000 }]);
  });
});

describe("dueProducts", () => {
  const orders = [order(21, [["milk", 6000], ["rare", 1000]]), order(14, [["milk", 6000]]), order(7, [["milk", 4000]]), order(0, [["milk", 6000], ["rare", 1000]])];

  it("lists a regular product once its usual gap has nearly passed", () => {
    expect(dueProducts(orders, day(27.5))).toEqual([{ productId: "milk", qtyMilli: 6000, everyDays: 7, daysSince: 7 }]);
  });

  it("does not list it too early, and ignores products ordered fewer than three times", () => {
    expect(dueProducts(orders, day(22))).toEqual([]);
    expect(dueProducts(orders, day(60)).map((d) => d.productId)).toEqual(["milk"]);
  });
});
