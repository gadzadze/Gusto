import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { addresses, orders, type OrderStatus } from "@/server/db/schema";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { getPilotMetrics } from "@/server/domain/metrics/pilot";
import { getSupplierMetrics } from "@/server/domain/metrics/supplier";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

type Line = { productId: string; qty: number };

/** Submits a real order, then moves it to the given time and status (confirmed qty = ordered qty). */
async function order(
  supplier: SupplierCtx,
  buyer: OrgCtx,
  lines: Line[],
  at: Date,
  status: OrderStatus,
): Promise<string> {
  for (const l of lines) await setCartQuantity(buyer, supplier.orgId, l.productId, l.qty * 1000);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  const result = await submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
  if (result.status !== "created") throw new Error("order not created");
  const db = getDb();
  await db.update(orders).set({ createdAt: at, status }).where(eq(orders.id, result.orderId));
  if (status === "confirmed" || status === "delivered") {
    await db.execute(sql`update order_items set confirmed_qty_milli = ordered_qty_milli where order_id = ${result.orderId}`);
  }
  return result.orderId;
}

describe("supplier dashboard metrics", () => {
  it("equals the hand-computed values for a known fixture", async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const supplier = await createSupplier();
    const [a, b, c] = [await createBuyer(), await createBuyer(), await createBuyer()];
    for (const buyer of [a, b, c]) await connectBuyer(supplier, buyer);
    const p1 = await createTestProduct(supplier, categoryId, { name: "[TEST] P1", basePrice: "10" });
    const p2 = await createTestProduct(supplier, categoryId, { name: "[TEST] P2", basePrice: "5" });

    await order(supplier, a, [{ productId: p1, qty: 2 }], ago(1), "confirmed"); //             2000
    await order(supplier, a, [{ productId: p1, qty: 3 }, { productId: p2, qty: 4 }], ago(3), "delivered"); // 5000
    await order(supplier, b, [{ productId: p2, qty: 10 }], ago(10), "confirmed"); //            5000
    await order(supplier, b, [{ productId: p1, qty: 1 }], ago(2), "pending"); //                1000
    await order(supplier, c, [{ productId: p1, qty: 5 }], ago(20), "rejected"); //              5000, not counted
    await order(supplier, a, [{ productId: p2, qty: 1 }], ago(40), "delivered"); //              outside 30 days

    const m = await getSupplierMetrics(supplier, now);
    expect(m).toEqual({
      currency: "GEL",
      pendingOrders: 1,
      ordersThisWeek: 3, //   1d, 2d, 3d
      ordersLastWeek: 1, //   10d
      orderValue30dMinor: 2000 + 5000 + 5000,
      topProducts: [
        { name: "[TEST] P2", unit: "piece", confirmedQtyMilli: 14_000 }, // 4 + 10
        { name: "[TEST] P1", unit: "piece", confirmedQtyMilli: 5_000 }, //  2 + 3
      ],
      repeatBuyers30d: 2, //  a (1d, 3d) and b (10d, 2d); c ordered once, a's 40d order is outside
    });
  });

  it("returns zeros, not errors, for a supplier with no orders", async () => {
    const supplier = await createSupplier();
    expect(await getSupplierMetrics(supplier)).toEqual({
      currency: "GEL",
      pendingOrders: 0,
      ordersThisWeek: 0,
      ordersLastWeek: 0,
      orderValue30dMinor: 0,
      topProducts: [],
      repeatBuyers30d: 0,
    });
  });

  it("never mixes in another supplier's orders, and is for suppliers only", async () => {
    const mine = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(other, buyer);
    const p = await createTestProduct(other, categoryId, { basePrice: "10" });
    await order(other, buyer, [{ productId: p, qty: 1 }], new Date(), "pending");
    expect((await getSupplierMetrics(mine)).pendingOrders).toBe(0);
    expect((await getSupplierMetrics(other)).pendingOrders).toBe(1);
    await expect(getSupplierMetrics(buyer)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("pilot metrics (admin)", () => {
  it("equals the hand-computed values; windows are isolated by using a far-future 'now'", async () => {
    // Other tests' orders are all in the real past, so a 'now' in 2100 sees only this fixture.
    const now = new Date("2100-06-15T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const before = await getPilotMetrics(admin, now);
    expect(before.ordersByStatus30d).toEqual({ pending: 0, confirmed: 0, delivered: 0, rejected: 0, cancelled: 0 });
    expect(before.reorder).toEqual({ earlierWeekBuyers: 0, bothWeeksBuyers: 0, rate: null });
    expect([before.activeSuppliers, before.activeBuyers]).toEqual([0, 0]);

    const s1 = await createSupplier();
    const s2 = await createSupplier();
    const [a, b, c, d] = [await createBuyer(), await createBuyer(), await createBuyer(), await createBuyer()];
    for (const buyer of [a, b, c]) await connectBuyer(s1, buyer);
    await connectBuyer(s2, d);
    const p1 = await createTestProduct(s1, categoryId, { basePrice: "10" });
    const p2 = await createTestProduct(s2, categoryId, { basePrice: "10" });

    await order(s1, a, [{ productId: p1, qty: 1 }], ago(2), "confirmed"); //  week 0
    await order(s1, a, [{ productId: p1, qty: 1 }], ago(9), "delivered"); //  week 1
    await order(s1, b, [{ productId: p1, qty: 1 }], ago(3), "pending"); //    week 0
    await order(s1, c, [{ productId: p1, qty: 1 }], ago(10), "rejected"); //  week 1
    await order(s2, d, [{ productId: p2, qty: 1 }], ago(20), "cancelled"); //  neither week, inside 30 days

    const m = await getPilotMetrics(admin, now);
    expect(m.ordersByStatus30d).toEqual({ pending: 1, confirmed: 1, delivered: 1, rejected: 1, cancelled: 1 });
    expect(m.activeSuppliers).toBe(2); //   s1 and s2 received orders
    expect(m.activeBuyers).toBe(3); //      a, b, c ordered in 14 days; d did not
    // Earlier week (7-14d): a, c. Latest week: a, b. In both: a. 1 / 2.
    expect(m.reorder).toEqual({ earlierWeekBuyers: 2, bothWeeksBuyers: 1, rate: 0.5 });
    // 5 orders in 28 days / 4 weeks / every approved supplier on the platform.
    expect(m.ordersPerSupplierPerWeek).toBeCloseTo(5 / 4 / m.suppliersByStatus.active, 10);
    // Unwindowed counts include everything created so far.
    expect(m.suppliersByStatus.active).toBeGreaterThanOrEqual(2);
    expect(m.buyerOrgs).toBeGreaterThanOrEqual(4);
    expect(m.activeProducts).toBeGreaterThanOrEqual(2);
  });

  it("reports an empty window as zeros and nulls, and is admin-only", async () => {
    const m = await getPilotMetrics(admin, new Date("2200-01-01T00:00:00Z"));
    expect(m.ordersByStatus30d).toEqual({ pending: 0, confirmed: 0, delivered: 0, rejected: 0, cancelled: 0 });
    expect(m.activeSuppliers).toBe(0);
    expect(m.activeBuyers).toBe(0);
    expect(m.reorder.rate).toBeNull();
    await expect(getPilotMetrics({ userId: randomUUID(), isPlatformAdmin: false } as unknown as AdminCtx)).rejects.toBeInstanceOf(NotFoundError);
  });
});
