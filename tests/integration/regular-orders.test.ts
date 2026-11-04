import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, isoWeekdayIn, todayIn } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { addresses, notificationPreferences, regularOrders } from "@/server/db/schema";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import {
  createRegularOrderFromOrder,
  deleteRegularOrder,
  listRegularOrders,
  loadRegularOrderIntoCart,
  MAX_REGULAR_ORDERS,
  sendRegularOrderReminders,
} from "@/server/domain/orders/regular";
import { getOrder } from "@/server/domain/orders/queries";
import { getPickList } from "@/server/domain/orders/pick-list";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { submitOrder } from "@/server/domain/orders/submit";
import { setProductActive } from "@/server/domain/catalog/products";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
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

describe("regular orders", () => {
  it("saves a placed order, loads it into the cart, and skips what is no longer orderable", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] Kept", basePrice: "4" });
    const b = await createTestProduct(supplier, categoryId, { name: "[TEST] Dropped", basePrice: "6" });
    const orderId = await placeOrder(buyer, supplier, [[a, 3000], [b, 1000]]);

    const id = await createRegularOrderFromOrder(buyer, orderId, { name: "Weekly", weekday: 2 });
    const [view] = await listRegularOrders(buyer);
    expect(view).toMatchObject({ id, name: "Weekly", weekday: 2, supplierOrgId: supplier.orgId });
    expect(view.itemNames).toEqual(["[TEST] Dropped", "[TEST] Kept"]);

    await setProductActive(supplier, b, false);
    const loaded = await loadRegularOrderIntoCart(buyer, id);
    expect(loaded).toMatchObject({ supplierOrgId: supplier.orgId, added: 1, skipped: ["[TEST] Dropped"] });
    expect((await getCart(buyer, supplier.orgId)).lines.map((l) => [l.name, l.qtyMilli])).toEqual([["[TEST] Kept", 3000]]);
  });

  it("is private to the buyer organization and limited in number", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const other = await createBuyer();
    await connectBuyer(supplier, buyer);
    const p = await createTestProduct(supplier, categoryId, { name: "[TEST] P" });
    const orderId = await placeOrder(buyer, supplier, [[p, 1000]]);
    const id = await createRegularOrderFromOrder(buyer, orderId, { name: "One", weekday: 1 });

    await expect(deleteRegularOrder(other, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(loadRegularOrderIntoCart(other, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createRegularOrderFromOrder(other, orderId, { name: "Steal", weekday: 1 })).rejects.toBeInstanceOf(NotFoundError);
    expect(await listRegularOrders(other)).toEqual([]);

    for (let i = 1; i < MAX_REGULAR_ORDERS; i++) await createRegularOrderFromOrder(buyer, orderId, { name: `n${i}`, weekday: 3 });
    await expect(createRegularOrderFromOrder(buyer, orderId, { name: "one too many", weekday: 3 })).rejects.toEqual(new StateError("limit_reached"));
    await deleteRegularOrder(buyer, id);
    expect(await listRegularOrders(buyer)).toHaveLength(MAX_REGULAR_ORDERS - 1);
  });

  it("reminds once per due day, from 08:00 local, only members who want emails", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const p = await createTestProduct(supplier, categoryId, { name: "[TEST] R" });
    const orderId = await placeOrder(buyer, supplier, [[p, 1000]]);
    // Monday in Tbilisi (the test org timezone), 2026-11-09.
    const monday10 = new Date("2026-11-09T06:00:00Z"); // 10:00 Tbilisi
    expect(isoWeekdayIn("Asia/Tbilisi", monday10)).toBe(1);
    const id = await createRegularOrderFromOrder(buyer, orderId, { name: "Mondays", weekday: 1 });
    await createRegularOrderFromOrder(buyer, orderId, { name: "Fridays", weekday: 5 });

    const sent: { to: string; names: string[] }[] = [];
    const send = async (to: string, names: string[]) => void sent.push({ to, names });

    // 07:00 local: too early.
    expect((await sendRegularOrderReminders(send, new Date("2026-11-09T03:00:00Z"))).claimed).toBe(0);
    // 10:00 local on Monday: one reminder for this organization, listing only Mondays.
    const first = await sendRegularOrderReminders(send, monday10);
    expect(first.claimed).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((s) => s.names.includes("Mondays"));
    expect(mine).toHaveLength(1);
    expect(mine[0].names).toEqual(["Mondays"]);
    // A second pass the same day sends nothing for it.
    const before = sent.length;
    await sendRegularOrderReminders(send, new Date("2026-11-09T09:00:00Z"));
    expect(sent.filter((s) => s.names.includes("Mondays"))).toHaveLength(1);
    expect(sent.length).toBeGreaterThanOrEqual(before);
    // Next Monday it is due again.
    await sendRegularOrderReminders(send, new Date("2026-11-16T06:00:00Z"));
    expect(sent.filter((s) => s.names.includes("Mondays"))).toHaveLength(2);

    // Opting out of order-update emails silences the reminder.
    await getDb().insert(notificationPreferences).values({ userId: buyer.userId, emailOrderUpdates: false }).onConflictDoUpdate({ target: notificationPreferences.userId, set: { emailOrderUpdates: false } });
    await getDb().update(regularOrders).set({ lastRemindedOn: null }).where(eq(regularOrders.id, id));
    await sendRegularOrderReminders(send, monday10);
    expect(sent.filter((s) => s.names.includes("Mondays"))).toHaveLength(2);
  });
});

describe("pick list", () => {
  it("totals confirmed quantities per product for one delivery day, only for this supplier", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const b1 = await createBuyer();
    const b2 = await createBuyer();
    await connectBuyer(supplier, b1);
    await connectBuyer(supplier, b2);
    const cheese = await createTestProduct(supplier, categoryId, { name: "[TEST] Cheese", basePrice: "10" });
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "20" });
    const day = addDays(todayIn("Asia/Tbilisi"), 2);

    const o1 = await placeOrder(b1, supplier, [[cheese, 2000], [wine, 1000]]);
    const o2 = await placeOrder(b2, supplier, [[cheese, 3000]]);
    const o3 = await placeOrder(b2, supplier, [[wine, 5000]]); // stays pending: not on the list
    await confirmOrder(supplier, o1, [], undefined, day);
    await confirmOrder(supplier, o2, [{ itemId: (await getOrder(supplier, o2)).items[0].id, confirmedQtyMilli: 2500 }], undefined, day);

    const list = await getPickList(supplier, day);
    expect(list.orders.map((o) => o.id).sort()).toEqual([o1, o2].sort());
    const rows = list.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.name === "[TEST] Cheese")).toMatchObject({ qtyMilli: 4500, orderCount: 2 });
    expect(rows.find((r) => r.name === "[TEST] Wine")).toMatchObject({ qtyMilli: 1000, orderCount: 1 });
    expect(o3).toBeTruthy();

    expect((await getPickList(supplier, addDays(day, 1))).orders).toEqual([]);
    expect((await getPickList(other, day)).orders).toEqual([]);
    expect((await getPickList(supplier, "garbage")).orders).toEqual([]);
    // Confirmed without a day shows up under "none".
    const o4 = await placeOrder(b1, supplier, [[cheese, 1000]]);
    await confirmOrder(supplier, o4, []);
    expect((await getPickList(supplier, "none")).orders.map((o) => o.id)).toContain(o4);
  });
});
