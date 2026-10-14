import { describe, expect, it } from "vitest";
import { computeTotals, minimumOrderShortfall } from "@/lib/orders/totals";
import { availableActions, canTransition, TRANSITIONS, type ActorRole } from "@/lib/orders/transitions";
import { stepDown, stepUp } from "@/lib/quantity";
import type { OrderStatus } from "@/server/db/schema";

const STATUSES: OrderStatus[] = ["pending", "confirmed", "delivered", "rejected", "cancelled"];
const ACTORS: ActorRole[] = ["buyer", "supplier"];

describe("computeTotals", () => {
  it("prices excluding VAT: VAT is added on top, per line", () => {
    const t = computeTotals(
      [
        { unitPriceMinor: 1000, vatRateBp: 1800, qtyMilli: 3000 }, // 30.00 + 5.40
        { unitPriceMinor: 250, vatRateBp: 0, qtyMilli: 4000 }, // 10.00, exempt
      ],
      false,
    );
    expect(t.lines).toEqual([
      { lineTotalMinor: 3000, vatMinor: 540 },
      { lineTotalMinor: 1000, vatMinor: 0 },
    ]);
    expect(t).toMatchObject({ subtotalMinor: 4000, vatMinor: 540, totalMinor: 4540, goodsMinor: 4000 });
  });

  it("prices including VAT: VAT is taken out of the price", () => {
    const t = computeTotals([{ unitPriceMinor: 1180, vatRateBp: 1800, qtyMilli: 1000 }], true);
    expect(t).toMatchObject({ subtotalMinor: 1000, vatMinor: 180, totalMinor: 1180, goodsMinor: 1180 });
  });

  it("mixes VAT rates and weighed quantities with half-up rounding", () => {
    // 2.345 kg × 18.99 = 44.53155 → 4453; VAT 18% inclusive: 4453 × 1800 / 11800 = 679.27 → 679
    // 3 × 2.40 = 7.20; VAT 5.5% inclusive: 720 × 550 / 10550 = 37.53 → 38
    const t = computeTotals(
      [
        { unitPriceMinor: 1899, vatRateBp: 1800, qtyMilli: 2345 },
        { unitPriceMinor: 240, vatRateBp: 550, qtyMilli: 3000 },
      ],
      true,
    );
    expect(t.lines).toEqual([
      { lineTotalMinor: 4453, vatMinor: 679 },
      { lineTotalMinor: 720, vatMinor: 38 },
    ]);
    expect(t).toMatchObject({ totalMinor: 5173, vatMinor: 717, subtotalMinor: 4456 });
  });

  it("handles an empty cart and zero-quantity (unavailable) lines", () => {
    expect(computeTotals([], true)).toMatchObject({ subtotalMinor: 0, vatMinor: 0, totalMinor: 0 });
    expect(computeTotals([{ unitPriceMinor: 999, vatRateBp: 1800, qtyMilli: 0 }], false).totalMinor).toBe(0);
  });

  it("reports the shortfall to the minimum order", () => {
    expect(minimumOrderShortfall(4000, 10000)).toBe(6000);
    expect(minimumOrderShortfall(12000, 10000)).toBe(0);
    expect(minimumOrderShortfall(500, 0)).toBe(0);
  });
});

describe("order transitions", () => {
  const allowed = new Set([
    "pending→confirmed:supplier",
    "pending→rejected:supplier",
    "pending→cancelled:buyer",
    "confirmed→delivered:supplier",
    "confirmed→cancelled:supplier",
  ]);

  it("allows exactly the documented transitions, for every status pair and actor", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const actor of ACTORS) {
          expect(canTransition(from, to, actor), `${from}→${to}:${actor}`).toBe(allowed.has(`${from}→${to}:${actor}`));
        }
      }
    }
  });

  it("has no way out of terminal statuses", () => {
    for (const from of ["delivered", "rejected", "cancelled"] as const) {
      for (const actor of ACTORS) expect(availableActions(from, actor)).toEqual([]);
    }
  });

  it("offers the right buttons", () => {
    expect(availableActions("pending", "supplier").sort()).toEqual(["confirm", "reject"]);
    expect(availableActions("pending", "buyer")).toEqual(["buyer_cancel"]);
    expect(availableActions("confirmed", "supplier").sort()).toEqual(["deliver", "supplier_cancel"]);
    expect(availableActions("confirmed", "buyer")).toEqual([]);
  });

  it("requires reasons for reject and supplier cancel only", () => {
    expect(Object.entries(TRANSITIONS).filter(([, r]) => r.reasonRequired).map(([a]) => a).sort()).toEqual([
      "reject",
      "supplier_cancel",
    ]);
  });
});

describe("quantity stepper", () => {
  it("goes to the minimum first, then by step", () => {
    expect(stepUp(0, 2000, 1000)).toBe(2000);
    expect(stepUp(2000, 2000, 1000)).toBe(3000);
    expect(stepUp(0, 500, 500)).toBe(500);
  });

  it("drops to zero below the minimum", () => {
    expect(stepDown(3000, 2000, 1000)).toBe(2000);
    expect(stepDown(2000, 2000, 1000)).toBe(0);
    expect(stepDown(500, 500, 500)).toBe(0);
  });
});
