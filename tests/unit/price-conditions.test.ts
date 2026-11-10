import { describe, expect, it } from "vitest";
import { adjustmentBp, applyBp, conditionsFor, formatBp, tierBp, type PriceRule } from "@/lib/pricing/conditions";

const rule = (r: Partial<PriceRule> & Pick<PriceRule, "kind" | "adjustBp">): PriceRule => ({
  productId: null,
  method: null,
  intervalDays: null,
  minQtyMilli: null,
  ...r,
});

const list: PriceRule[] = [
  rule({ kind: "method", method: "cash", adjustBp: -300 }),
  rule({ kind: "method", method: "transfer", adjustBp: 0 }),
  rule({ kind: "interval", intervalDays: 0, adjustBp: 0 }),
  rule({ kind: "interval", intervalDays: 30, adjustBp: 200 }),
  rule({ kind: "qty", minQtyMilli: 10_000, adjustBp: -500 }),
  rule({ kind: "qty", minQtyMilli: 50_000, adjustBp: -1000 }),
];

describe("price conditions", () => {
  it("adds the payment method, interval and quantity tier", () => {
    expect(adjustmentBp(list, "p1", 1000, { method: null, intervalDays: null })).toBe(0);
    expect(adjustmentBp(list, "p1", 1000, { method: "cash", intervalDays: 0 })).toBe(-300);
    expect(adjustmentBp(list, "p1", 12_000, { method: "cash", intervalDays: 30 })).toBe(-300 + 200 - 500);
    expect(adjustmentBp(list, "p1", 60_000, { method: "transfer", intervalDays: 30 })).toBe(200 - 1000);
  });

  it("takes the highest tier a quantity reaches", () => {
    const c = conditionsFor(list, null);
    expect(tierBp(c, 9_999)).toBe(0);
    expect(tierBp(c, 10_000)).toBe(-500);
    expect(tierBp(c, 49_999)).toBe(-500);
    expect(tierBp(c, 50_000)).toBe(-1000);
  });

  it("lets a product's own rows replace the list's", () => {
    const rules = [
      ...list,
      rule({ productId: "p2", kind: "method", method: "cash", adjustBp: -800 }),
      rule({ productId: "p2", kind: "qty", minQtyMilli: 5_000, adjustBp: -200 }),
    ];
    // p2: own cash value, own tiers only (the list's tiers no longer apply); intervals still from the list.
    expect(adjustmentBp(rules, "p2", 12_000, { method: "cash", intervalDays: 30 })).toBe(-800 + 200 - 200);
    // p1 is untouched.
    expect(adjustmentBp(rules, "p1", 12_000, { method: "cash", intervalDays: 30 })).toBe(-300 + 200 - 500);
  });

  it("rounds half up in integer minor units and never goes below zero", () => {
    expect(applyBp(1000, -300)).toBe(970);
    expect(applyBp(1005, -500)).toBe(955); // 954.75
    expect(applyBp(1, -5000)).toBe(1); // 0.5 rounds up
    expect(applyBp(100, 0)).toBe(100);
    expect(applyBp(100, -9000)).toBe(10);
    expect(applyBp(0, 500)).toBe(0);
  });

  it("formats a change for display", () => {
    expect(formatBp(-300)).toBe("-3%");
    expect(formatBp(250)).toBe("+2.5%");
    expect(formatBp(0)).toBe("0%");
  });
});
