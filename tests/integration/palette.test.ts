import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { addresses, orders } from "@/server/db/schema";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { searchPalette } from "@/server/domain/search/palette";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

describe("command palette search", () => {
  it("finds a supplier's own products and customers and an order by number, and nothing of another company", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const word = `Zephyrcheese${randomUUID().slice(0, 6)}`;
    const product = await createTestProduct(supplier, categoryId, { name: `[TEST] ${word}`, basePrice: "10" });
    await createTestProduct(other, categoryId, { name: `[TEST] ${word} theirs`, basePrice: "10" });

    await setCartQuantity(buyer, supplier.orgId, product, 1000);
    const cart = await getCart(buyer, supplier.orgId);
    const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
    const placed = await submitOrder(buyer, supplier.orgId, {
      idempotencyKey: randomUUID(),
      expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
      addressId: address.id,
    });
    if (placed.status === "changed") throw new Error("unexpected change");
    const [order] = await getDb().select({ number: orders.number }).from(orders).where(eq(orders.id, placed.orderId));

    const byName = await searchPalette(supplier, word.toLowerCase());
    expect(byName.map((r) => [r.kind, r.id])).toEqual([["product", product]]);
    expect(byName[0].href).toBe(`/supplier/products/${product}`);

    const byNumber = await searchPalette(supplier, `GST-${order.number}`);
    expect(byNumber).toEqual([{ kind: "order", id: String(order.number), label: `GST-${order.number}`, hint: "", href: `/supplier/orders/${placed.orderId}` }]);
    // The other supplier cannot reach this order or this product.
    expect(await searchPalette(other, `GST-${order.number}`)).toEqual([]);
    expect((await searchPalette(other, word.toLowerCase())).map((r) => r.id)).not.toContain(product);
    expect(await searchPalette(supplier, "x")).toEqual([]);
  });

  it("shows a buyer only the suppliers it is connected to", async () => {
    const supplier = await createSupplier();
    const stranger = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const found = await searchPalette(buyer, "[TEST]");
    expect(found.every((r) => r.kind === "supplier")).toBe(true);
    expect(found.map((r) => r.id)).toContain(supplier.orgId);
    expect(found.map((r) => r.id)).not.toContain(stranger.orgId);
  });
});
