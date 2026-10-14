import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";
import { productSchema } from "@/lib/validation/product";
import { supplierSettingsSchema } from "@/lib/validation/supplier-settings";
import { getDb } from "@/server/db/client";
import { addresses, carts, orders } from "@/server/db/schema";
import { setProductActive, updateProduct } from "@/server/domain/catalog/products";
import { updateSupplierSettings } from "@/server/domain/catalog/supplier-settings";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { setCustomerBlocked } from "@/server/domain/customers/customers";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { getCart, listCarts, setCartQuantity } from "@/server/domain/orders/cart";
import { getOrder, listBuyerOrders, listSupplierOrders, orderLinkTarget, reorder } from "@/server/domain/orders/queries";
import { submitOrder, type SubmitInput } from "@/server/domain/orders/submit";
import { cancelByBuyer, cancelBySupplier, confirmOrder, markDelivered, rejectOrder } from "@/server/domain/orders/transitions";
import { createPriceList, setPriceOverrides } from "@/server/domain/pricing/price-lists";
import { testDatabaseUrl } from "./test-database";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct, productInput } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

async function defaultAddressId(buyer: OrgCtx): Promise<string> {
  const [a] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  return a.id;
}

/** What the checkout page would send: the cart exactly as currently priced. */
async function reviewed(buyer: OrgCtx, supplier: SupplierCtx, overrides: Partial<SubmitInput> = {}): Promise<SubmitInput> {
  const cart = await getCart(buyer, supplier.orgId);
  return {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: await defaultAddressId(buyer),
    note: "Back door please",
    ...overrides,
  };
}

async function setup() {
  const supplier = await createSupplier();
  const buyer = await createBuyer();
  await connectBuyer(supplier, buyer);
  const cheese = await createTestProduct(supplier, categoryId, { name: "ყველი სულგუნი", sku: "SUL", unit: "kg", basePrice: "18,99", minQty: "0,5", qtyStep: "0,005" });
  const water = await createTestProduct(supplier, categoryId, { name: "წყალი", sku: "WAT", unit: "bottle", basePrice: "1,20", vatRate: "18" });
  return { supplier, buyer, cheese, water };
}

describe("cart", () => {
  it("keeps one cart per supplier, enforces min/step and removes at 0", async () => {
    const { supplier, buyer, cheese, water } = await setup();
    const other = await createSupplier();
    await connectBuyer(other, buyer);
    const otherProduct = await createTestProduct(other, categoryId, { name: "[TEST] Other" });

    await setCartQuantity(buyer, supplier.orgId, cheese, 2345);
    await setCartQuantity(buyer, supplier.orgId, water, 6000);
    await setCartQuantity(buyer, other.orgId, otherProduct, 1000);
    await expect(setCartQuantity(buyer, supplier.orgId, cheese, 400)).rejects.toEqual(new StateError("invalid_quantity"));
    // A product from another supplier can't go into this supplier's cart.
    await expect(setCartQuantity(buyer, supplier.orgId, otherProduct, 1000)).rejects.toBeInstanceOf(NotFoundError);

    const cart = await getCart(buyer, supplier.orgId);
    expect(cart.lines.map((l) => [l.name, l.qtyMilli])).toEqual([["ყველი სულგუნი", 2345], ["წყალი", 6000]]);
    expect(cart.totals.totalMinor).toBe(4453 + 720);
    expect((await listCarts(buyer)).map((c) => c.itemCount).sort()).toEqual([1, 2]);

    await setCartQuantity(buyer, supplier.orgId, water, 0);
    expect((await getCart(buyer, supplier.orgId)).lines).toHaveLength(1);
  });

  it("only connected buyers can have a cart", async () => {
    const { supplier, cheese } = await setup();
    const stranger = await createBuyer();
    await expect(setCartQuantity(stranger, supplier.orgId, cheese, 1000)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("submitOrder", () => {
  it("persists the order with item snapshots, history, and clears the cart", async () => {
    const { supplier, buyer, cheese, water } = await setup();
    await setCartQuantity(buyer, supplier.orgId, cheese, 2345);
    await setCartQuantity(buyer, supplier.orgId, water, 3000);
    const result = await submitOrder(buyer, supplier.orgId, await reviewed(buyer, supplier));
    expect(result).toMatchObject({ status: "created", number: expect.any(Number) });
    if (result.status !== "created") return;
    expect(result.number).toBeGreaterThanOrEqual(1001);

    const { order, items, history } = await getOrder(buyer, result.orderId);
    expect(order).toMatchObject({
      status: "pending",
      currency: "GEL",
      pricesIncludeVat: true,
      totalMinor: 4453 + 360,
      note: "Back door please",
      deliveryAddress: "Somewhere 1",
    });
    expect(items.map((i) => [i.lineNo, i.name, i.sku, i.unit, i.unitPriceMinor, i.orderedQtyMilli, i.confirmedQtyMilli])).toEqual([
      [1, "ყველი სულგუნი", "SUL", "kg", 1899, 2345, null],
      [2, "წყალი", "WAT", "bottle", 120, 3000, null],
    ]);
    expect(history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: "pending", byBuyer: true })]);
    expect(await getDb().select().from(carts).where(eq(carts.buyerOrgId, buyer.orgId))).toEqual([]);

    // Later edits to the product don't touch the order.
    await updateProduct(supplier, cheese, productSchema.parse(productInput(categoryId, { name: "Renamed", sku: "X", basePrice: "99" })));
    const again = await getOrder(supplier, result.orderId);
    expect(again.items[0]).toMatchObject({ name: "ყველი სულგუნი", sku: "SUL", unitPriceMinor: 1899 });
    expect(again.order.totalMinor).toBe(4453 + 360);
  });

  it("snapshots the buyer's own price-list price", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const product = await createTestProduct(supplier, categoryId, { basePrice: "10" });
    const list = await createPriceList(supplier, "[TEST] VIP");
    await setPriceOverrides(supplier, list, [{ productId: product, priceMinor: 700 }]);
    await connectBuyer(supplier, buyer, list);
    await setCartQuantity(buyer, supplier.orgId, product, 2000);
    const result = await submitOrder(buyer, supplier.orgId, await reviewed(buyer, supplier));
    if (result.status !== "created") throw new Error("expected created");
    expect((await getOrder(buyer, result.orderId)).items[0].unitPriceMinor).toBe(700);
  });

  it("returns a diff and creates nothing when a price changed after review", async () => {
    const { supplier, buyer, cheese } = await setup();
    await setCartQuantity(buyer, supplier.orgId, cheese, 1000);
    const input = await reviewed(buyer, supplier);
    await updateProduct(supplier, cheese, productSchema.parse(productInput(categoryId, { name: "ყველი სულგუნი", unit: "kg", basePrice: "21", minQty: "0,5", qtyStep: "0,005" })));

    const result = await submitOrder(buyer, supplier.orgId, input);
    expect(result).toEqual({
      status: "changed",
      changes: [{ productId: cheese, name: "ყველი სულგუნი", kind: "price_changed", before: 1899, after: 2100 }],
    });
    expect((await listBuyerOrders(buyer)).total).toBe(0);
    expect((await getCart(buyer, supplier.orgId)).lines).toHaveLength(1);
    // Re-reviewing at the new price goes through.
    expect((await submitOrder(buyer, supplier.orgId, await reviewed(buyer, supplier))).status).toBe("created");
  });

  it("reports products that became unavailable", async () => {
    const { supplier, buyer, cheese, water } = await setup();
    await setCartQuantity(buyer, supplier.orgId, cheese, 1000);
    await setCartQuantity(buyer, supplier.orgId, water, 1000);
    const input = await reviewed(buyer, supplier);
    await setProductActive(supplier, water, false);
    const result = await submitOrder(buyer, supplier.orgId, input);
    expect(result).toEqual({ status: "changed", changes: [expect.objectContaining({ productId: water, kind: "unavailable" })] });
  });

  it("refuses an order below the supplier's minimum", async () => {
    const { supplier, buyer, water } = await setup();
    await updateSupplierSettings(
      supplier,
      supplierSettingsSchema.parse({ contactName: "G", phone: "599000000", minOrder: "50", pricesIncludeVat: true }),
    );
    await setCartQuantity(buyer, supplier.orgId, water, 2000);
    await expect(submitOrder(buyer, supplier.orgId, await reviewed(buyer, supplier))).rejects.toEqual(new StateError("below_minimum"));
    expect((await listBuyerOrders(buyer)).total).toBe(0);
  });

  it("creates exactly one order for a repeated or concurrent idempotency key", async () => {
    const { supplier, buyer, cheese } = await setup();
    await setCartQuantity(buyer, supplier.orgId, cheese, 1000);
    const input = await reviewed(buyer, supplier);
    const [a, b] = await Promise.all([submitOrder(buyer, supplier.orgId, input), submitOrder(buyer, supplier.orgId, input)]);
    const ids = [a, b].map((r) => (r.status === "created" || r.status === "existing" ? r.orderId : null));
    expect(ids[0]).toBe(ids[1]);
    expect([a.status, b.status].sort()).toEqual(["created", "existing"]);
    const again = await submitOrder(buyer, supplier.orgId, input);
    expect(again).toMatchObject({ status: "existing", orderId: ids[0] });
    expect((await listBuyerOrders(buyer)).total).toBe(1);
  });

  it("saves a new delivery address inline and refuses someone else's address", async () => {
    const { supplier, buyer, cheese } = await setup();
    const other = await createBuyer();
    await setCartQuantity(buyer, supplier.orgId, cheese, 1000);
    await expect(
      submitOrder(buyer, supplier.orgId, await reviewed(buyer, supplier, { addressId: await defaultAddressId(other) })),
    ).rejects.toEqual(new StateError("address_required"));
    const result = await submitOrder(
      buyer,
      supplier.orgId,
      await reviewed(buyer, supplier, { addressId: undefined, newAddress: { city: "Batumi", addressLine: "Seaside 5" } }),
    );
    if (result.status !== "created") throw new Error("expected created");
    expect((await getOrder(buyer, result.orderId)).order).toMatchObject({ deliveryCity: "Batumi", deliveryAddress: "Seaside 5" });
  });

  it("refuses when the buyer was blocked after filling the cart", async () => {
    const { supplier, buyer, cheese } = await setup();
    await setCartQuantity(buyer, supplier.orgId, cheese, 1000);
    const input = await reviewed(buyer, supplier);
    const [customer] = await getDb().execute<{ id: string }>(
      sql`select id from supplier_customers where supplier_org_id = ${supplier.orgId} and buyer_org_id = ${buyer.orgId}`,
    );
    await setCustomerBlocked(supplier, customer.id, true);
    await expect(submitOrder(buyer, supplier.orgId, input)).rejects.toEqual(new StateError("supplier_unavailable"));
  });
});

async function placedOrder() {
  const { supplier, buyer, cheese, water } = await setup();
  await setCartQuantity(buyer, supplier.orgId, cheese, 2000);
  await setCartQuantity(buyer, supplier.orgId, water, 10000);
  const result = await submitOrder(buyer, supplier.orgId, await reviewed(buyer, supplier));
  if (result.status !== "created") throw new Error("expected created");
  return { supplier, buyer, cheese, water, orderId: result.orderId, number: result.number };
}

describe("order lifecycle", () => {
  it("confirms with an adjusted quantity, recomputes totals, then delivers", async () => {
    const { supplier, buyer, orderId } = await placedOrder();
    const { items } = await getOrder(supplier, orderId);
    const water = items.find((i) => i.name === "წყალი")!;
    await confirmOrder(supplier, orderId, [{ itemId: water.id, confirmedQtyMilli: 8000 }], "Only 8 left");

    const after = await getOrder(buyer, orderId);
    expect(after.order.status).toBe("confirmed");
    expect(after.items.map((i) => [i.name, i.orderedQtyMilli, i.confirmedQtyMilli])).toEqual([
      ["ყველი სულგუნი", 2000, 2000],
      ["წყალი", 10000, 8000],
    ]);
    expect(after.order.totalMinor).toBe(3798 + 960);
    expect(after.history.at(-1)).toMatchObject({ fromStatus: "pending", toStatus: "confirmed", note: "Only 8 left", byBuyer: false });

    await markDelivered(supplier, orderId);
    expect((await getOrder(buyer, orderId)).order.status).toBe("delivered");
    await expect(markDelivered(supplier, orderId)).rejects.toEqual(new StateError("stale_status"));
  });

  it("lets exactly one of two concurrent confirmations win", async () => {
    const { supplier, orderId } = await placedOrder();
    const results = await Promise.allSettled([confirmOrder(supplier, orderId, []), confirmOrder(supplier, orderId, [])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: new StateError("stale_status") });
    const { history } = await getOrder(supplier, orderId);
    expect(history.filter((h) => h.toStatus === "confirmed")).toHaveLength(1);
  });

  it("requires a reason to reject or cancel as supplier, and at least one confirmed line", async () => {
    const { supplier, orderId } = await placedOrder();
    const { items } = await getOrder(supplier, orderId);
    await expect(rejectOrder(supplier, orderId, "")).rejects.toEqual(new StateError("reason_required"));
    await expect(
      confirmOrder(supplier, orderId, items.map((i) => ({ itemId: i.id, confirmedQtyMilli: 0 }))),
    ).rejects.toEqual(new StateError("nothing_confirmed"));
    expect((await getOrder(supplier, orderId)).order.status).toBe("pending");
    await rejectOrder(supplier, orderId, "Out of stock this week");
    expect((await getOrder(supplier, orderId)).order.status).toBe("rejected");

    const second = await placedOrder();
    await confirmOrder(second.supplier, second.orderId, []);
    await expect(cancelBySupplier(second.supplier, second.orderId, "x")).rejects.toEqual(new StateError("reason_required"));
    await cancelBySupplier(second.supplier, second.orderId, "Truck broke down");
    expect((await getOrder(second.buyer, second.orderId)).order.status).toBe("cancelled");
  });

  it("lets the buyer cancel only while pending", async () => {
    const { supplier, buyer, orderId } = await placedOrder();
    const other = await placedOrder();
    await cancelByBuyer(buyer, orderId);
    expect((await getOrder(supplier, orderId)).order.status).toBe("cancelled");
    await confirmOrder(other.supplier, other.orderId, []);
    await expect(cancelByBuyer(other.buyer, other.orderId)).rejects.toEqual(new StateError("stale_status"));
  });

  it("puts the products back in the cart at current prices on reorder, skipping unavailable ones", async () => {
    const { supplier, buyer, cheese, water, orderId } = await placedOrder();
    await setProductActive(supplier, water, false);
    await updateProduct(supplier, cheese, productSchema.parse(productInput(categoryId, { name: "ყველი სულგუნი", unit: "kg", basePrice: "20", minQty: "0,5", qtyStep: "0,005" })));
    const result = await reorder(buyer, orderId);
    expect(result).toEqual({ supplierOrgId: supplier.orgId, added: 1, skipped: ["წყალი"] });
    const cart = await getCart(buyer, supplier.orgId);
    expect(cart.lines.map((l) => [l.name, l.qtyMilli, l.unitPriceMinor])).toEqual([["ყველი სულგუნი", 2000, 2000]]);
  });
});

describe("order isolation", () => {
  it("other buyers and suppliers can't read, act on, or link to an order", async () => {
    const { orderId, number } = await placedOrder();
    const otherBuyer = await createBuyer();
    const otherSupplier = await createSupplier();
    await expect(getOrder(otherBuyer, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrder(otherSupplier, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelByBuyer(otherBuyer, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmOrder(otherSupplier, orderId, [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(rejectOrder(otherSupplier, orderId, "not mine")).rejects.toBeInstanceOf(NotFoundError);
    await expect(reorder(otherBuyer, orderId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await orderLinkTarget(otherBuyer, number)).toBeNull();
    expect(await orderLinkTarget(otherSupplier, number)).toBeNull();
    expect((await listSupplierOrders(otherSupplier, "new")).total).toBe(0);
  });

  it("the order link resolves to each side's own page", async () => {
    const { supplier, buyer, orderId, number } = await placedOrder();
    expect(await orderLinkTarget(buyer, number)).toBe(`/buyer/orders/${orderId}`);
    expect(await orderLinkTarget(supplier, number)).toBe(`/supplier/orders/${orderId}`);
  });

  it("a buyer can't move a supplier's transition and vice versa", async () => {
    const { supplier, buyer, orderId } = await placedOrder();
    await expect(confirmOrder(buyer, orderId, [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelByBuyer(supplier, orderId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("supplier tabs list only that supplier's orders in the right tab", async () => {
    const { supplier, orderId } = await placedOrder();
    expect((await listSupplierOrders(supplier, "new")).items.map((o) => o.id)).toEqual([orderId]);
    await confirmOrder(supplier, orderId, []);
    expect((await listSupplierOrders(supplier, "new")).total).toBe(0);
    expect((await listSupplierOrders(supplier, "confirmed")).items.map((o) => o.id)).toEqual([orderId]);
  });
});

describe("persistence", () => {
  it("an order and its history are read back intact over a brand-new connection", async () => {
    const { supplier, orderId } = await placedOrder();
    await confirmOrder(supplier, orderId, []);
    // A separate client, as a restarted app process would have.
    const fresh = postgres(testDatabaseUrl(), { max: 1 });
    try {
      const [order] = await fresh`select status, total_minor from orders where id = ${orderId}`;
      const history = await fresh`select from_status, to_status from order_status_history where order_id = ${orderId} order by created_at`;
      expect(order.status).toBe("confirmed");
      expect(Number(order.total_minor)).toBeGreaterThan(0);
      expect(history.map((h) => [h.from_status, h.to_status])).toEqual([[null, "pending"], ["pending", "confirmed"]]);
    } finally {
      await fresh.end();
    }
  });

  it("order numbers are unique and increasing", async () => {
    const a = await placedOrder();
    const b = await placedOrder();
    expect(b.number).toBeGreaterThan(a.number);
    const [row] = await getDb().select({ n: orders.number }).from(orders).where(eq(orders.id, a.orderId));
    expect(row.n).toBe(a.number);
  });
});
