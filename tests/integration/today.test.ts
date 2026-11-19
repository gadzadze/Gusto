import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { addresses } from "@/server/db/schema";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { lastOrderDates, listOpenBuyerOrders } from "@/server/domain/orders/queries";
import { submitOrder } from "@/server/domain/orders/submit";
import { getOrderValueSeries, getPendingPulse, getSetupProgress, getSupplierClock, listPendingQueue, listUpcomingDeliveries } from "@/server/domain/orders/today";
import { createPriceList } from "@/server/domain/pricing/price-lists";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

async function placeOrder(buyer: OrgCtx, supplier: SupplierCtx, lines: [string, number][]): Promise<string> {
  for (const [productId, qty] of lines) await setCartQuantity(buyer, supplier.orgId, productId, qty);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  const result = await submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
  if (result.status === "changed") throw new Error("unexpected change");
  return result.orderId;
}

describe("supplier home data", () => {
  it("lists pending orders oldest first, with their item count, for this company only", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    const water = await createTestProduct(supplier, categoryId, { name: "[TEST] Water", basePrice: "2" });
    const first = await placeOrder(buyer, supplier, [[wine, 1000], [water, 2000]]);
    const second = await placeOrder(buyer, supplier, [[wine, 3000]]);
    const queue = await listPendingQueue(supplier);
    expect(queue.map((o) => o.id)).toEqual([first, second]);
    expect(queue[0].itemCount).toBe(2);
    expect(queue[1].itemCount).toBe(1);
    expect(await listPendingQueue(other)).toEqual([]);
    // Once confirmed, an order leaves the queue.
    await confirmOrder(supplier, first, []);
    expect((await listPendingQueue(supplier)).map((o) => o.id)).toEqual([second]);
    await expect(listPendingQueue(buyer)).rejects.toThrow();
  });

  it("counts what a supplier has prepared for the get-started checklist, for this company only", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    expect(await getSetupProgress(supplier)).toEqual({ products: 0, priceLists: 0, customers: 0 });
    await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    await createTestProduct(other, categoryId, { name: "[TEST] Other", basePrice: "10" });
    // Helpers may create default price lists as a side effect, so compare against what each company had before.
    const otherBefore = await getSetupProgress(other);
    expect(otherBefore.products).toBe(1);
    expect(otherBefore.customers).toBe(0);
    await createPriceList(supplier, "[TEST] List");
    await connectBuyer(supplier, buyer);
    const prepared = await getSetupProgress(supplier);
    expect(prepared.products).toBe(1);
    expect(prepared.customers).toBe(1);
    expect(prepared.priceLists).toBeGreaterThanOrEqual(1);
    // Nothing the first company did shows up for the other one.
    expect(await getSetupProgress(other)).toEqual(otherBefore);
    await expect(getSetupProgress(buyer)).rejects.toThrow();
  });

  it("gives a pulse whose signature changes when the waiting queue changes, for this company only", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    const empty = await getPendingPulse(supplier);
    expect(empty.pending).toBe(0);
    const first = await placeOrder(buyer, supplier, [[wine, 1000]]);
    const one = await getPendingPulse(supplier);
    expect(one.pending).toBe(1);
    expect(one.signature).not.toBe(empty.signature);
    await placeOrder(buyer, supplier, [[wine, 2000]]);
    const two = await getPendingPulse(supplier);
    expect(two.pending).toBe(2);
    expect(two.signature).not.toBe(one.signature);
    await confirmOrder(supplier, first, []);
    const after = await getPendingPulse(supplier);
    expect(after.pending).toBe(1);
    expect(after.signature).not.toBe(two.signature);
    expect((await getPendingPulse(other)).pending).toBe(0);
    await expect(getPendingPulse(buyer)).rejects.toThrow();
  });

  it("groups confirmed orders by delivery day, earliest first, days not agreed last", async () => {
    const supplier = await createSupplier();
    const b1 = await createBuyer();
    const b2 = await createBuyer();
    await connectBuyer(supplier, b1);
    await connectBuyer(supplier, b2);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    const today = todayIn("Asia/Tbilisi");
    const d1 = addDays(today, 1);
    const d2 = addDays(today, 3);
    const a = await placeOrder(b1, supplier, [[wine, 1000]]);
    const b = await placeOrder(b2, supplier, [[wine, 1000]]);
    const c = await placeOrder(b1, supplier, [[wine, 1000]]);
    const d = await placeOrder(b1, supplier, [[wine, 1000]]);
    await confirmOrder(supplier, a, [], undefined, d2);
    await confirmOrder(supplier, b, [], undefined, d1);
    await confirmOrder(supplier, c, [], undefined, d1);
    await confirmOrder(supplier, d, []);
    const days = await listUpcomingDeliveries(supplier);
    expect(days).toEqual([
      { date: d1, orders: 2, customers: 2 },
      { date: d2, orders: 1, customers: 1 },
      { date: null, orders: 1, customers: 1 },
    ]);
  });

  it("returns a full 30-day value series ending today, counting only confirmed and delivered orders", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    const kept = await placeOrder(buyer, supplier, [[wine, 2000]]);
    await placeOrder(buyer, supplier, [[wine, 5000]]); // stays pending: not counted
    await confirmOrder(supplier, kept, []);
    const series = await getOrderValueSeries(supplier, 30);
    const clock = await getSupplierClock(supplier);
    expect(series).toHaveLength(30);
    expect(series[29].day).toBe(clock.today);
    expect(series.reduce((sum, s) => sum + s.valueMinor, 0)).toBe(2000);
    expect(series[29].valueMinor).toBe(2000);
  });

  it("tells a buyer when it last ordered from each supplier and what is in progress", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "10" });
    expect((await lastOrderDates(buyer)).has(supplier.orgId)).toBe(false);
    await placeOrder(buyer, supplier, [[wine, 1000]]);
    expect((await lastOrderDates(buyer)).get(supplier.orgId)).toBeInstanceOf(Date);
    const open = await listOpenBuyerOrders(buyer);
    expect(open).toHaveLength(1);
    expect(open[0]).toHaveProperty("deliveryDate");
    await expect(lastOrderDates(supplier)).rejects.toThrow();
  });
});
