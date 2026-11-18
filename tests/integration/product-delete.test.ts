import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { addresses, cartItems, orderItems, organizations, priceListItems, products, regularOrders } from "@/server/db/schema";
import { deleteProduct, getProductsUsage, getProductUsage, getSupplierProduct } from "@/server/domain/catalog/products";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { getPickList } from "@/server/domain/orders/pick-list";
import { getOrder } from "@/server/domain/orders/queries";
import { createRegularOrderFromOrder } from "@/server/domain/orders/regular";
import { submitOrder } from "@/server/domain/orders/submit";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { createPriceList, setListItems } from "@/server/domain/pricing/price-lists";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct, memoryStorage } from "./helpers";

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

describe("deleting a product", () => {
  it("removes it everywhere it is offered, keeps what orders recorded, and deletes the photo", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "20" });
    const water = await createTestProduct(supplier, categoryId, { name: "[TEST] Water", basePrice: "2" });
    await getDb().update(products).set({ imagePath: `${supplier.orgId}/${wine}/abc` }).where(eq(products.id, wine));
    const listId = await createPriceList(supplier, "[TEST] List");
    await setListItems(supplier, listId, [{ productId: wine, included: true, priceMinor: null }, { productId: water, included: true, priceMinor: null }]);

    // A confirmed order (history + loading sheet) and one still pending.
    const confirmed = await placeOrder(buyer, supplier, [[wine, 3000], [water, 1000]]);
    await confirmOrder(supplier, confirmed, [], undefined, undefined);
    const pending = await placeOrder(buyer, supplier, [[wine, 1000]]);
    // Saved regular orders: one with only the wine, one with both.
    const onlyWine = await createRegularOrderFromOrder(buyer, pending, { name: "Only wine", weekday: 1 });
    const both = await createRegularOrderFromOrder(buyer, confirmed, { name: "Both", weekday: 2 });
    // Wine sits in the buyer's cart.
    await setCartQuantity(buyer, supplier.orgId, wine, 2000);

    expect(await getProductUsage(supplier, wine)).toEqual({ openOrders: 2, orderLines: 2 });
    const batch = await getProductsUsage(supplier, [wine, water]);
    expect(batch.get(wine)).toEqual({ openOrders: 2, orderLines: 2 });
    expect(batch.get(water)).toEqual({ openOrders: 1, orderLines: 1 });
    expect((await getProductsUsage(await createSupplier(), [wine, water])).size).toBe(0);
    expect((await getProductsUsage(supplier, [])).size).toBe(0);

    const storage = memoryStorage();
    await deleteProduct(supplier, wine, storage);

    await expect(getSupplierProduct(supplier, wine)).rejects.toBeInstanceOf(NotFoundError);
    expect(await getDb().select().from(priceListItems).where(eq(priceListItems.productId, wine))).toEqual([]);
    expect(await getDb().select().from(cartItems).where(eq(cartItems.productId, wine))).toEqual([]);
    expect(await getDb().select({ id: regularOrders.id }).from(regularOrders).where(eq(regularOrders.id, onlyWine))).toEqual([]);
    expect(await getDb().select({ id: regularOrders.id }).from(regularOrders).where(eq(regularOrders.id, both))).toHaveLength(1);
    expect(storage.removed.length).toBeGreaterThan(0);
    // The water is untouched.
    expect((await getSupplierProduct(supplier, water)).name).toBe("[TEST] Water");

    // Orders keep their own copy of the line; only the link to the product is cleared.
    const history = await getOrder(supplier, confirmed);
    const line = history.items.find((i) => i.name === "[TEST] Wine")!;
    expect(line).toMatchObject({ productId: null, orderedQtyMilli: 3000, unitPriceMinor: 2000 });
    const rows = await getDb().select().from(orderItems).where(eq(orderItems.orderId, pending));
    expect(rows[0]).toMatchObject({ name: "[TEST] Wine", productId: null });
    // The loading sheet and an open order still work.
    const sheet = await getPickList(supplier, "none");
    expect(sheet.groups.flatMap((g) => g.rows).map((r) => r.name)).toContain("[TEST] Wine");
    await confirmOrder(supplier, pending, []);
  });

  it("refuses another company's product and a suspended company", async () => {
    const supplier = await createSupplier();
    const stranger = await createSupplier();
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Mine" });
    await expect(deleteProduct(stranger, product, memoryStorage())).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProductUsage(stranger, product)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getSupplierProduct(supplier, product)).id).toBe(product);

    await getDb().update(organizations).set({ status: "suspended" }).where(eq(organizations.id, supplier.orgId));
    await expect(deleteProduct({ ...supplier, orgStatus: "suspended" }, product, memoryStorage())).rejects.toEqual(new StateError("suspended"));
    expect((await getSupplierProduct(supplier, product)).id).toBe(product);
  });
});
