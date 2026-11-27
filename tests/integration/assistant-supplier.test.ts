import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ProposalView } from "@/lib/assistant/snapshots";
import { getDb } from "@/server/db/client";
import { addresses, orders, products } from "@/server/db/schema";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  getFormatter: async () => ({ dateTime: (d: Date) => d.toISOString().slice(0, 10) }),
}));

const { runSupplierTool } = await import("@/server/assistant/supplier-tools");
const { applySupplierAction } = await import("@/server/assistant/supplier-actions");

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

async function place(supplier: SupplierCtx, buyer: OrgCtx, productId: string, qty = 2) {
  await setCartQuantity(buyer, supplier.orgId, productId, qty * 1000);
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  const result = await submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
  if (result.status !== "created") throw new Error("order not created");
  return result;
}

const statusOf = async (id: string) => (await getDb().select({ s: orders.status }).from(orders).where(eq(orders.id, id)))[0].s;
function proposal(result: Awaited<ReturnType<typeof runSupplierTool>>): ProposalView {
  if (!result.ok || result.view?.kind !== "proposal") throw new Error(`no proposal: ${JSON.stringify(result)}`);
  return result.view;
}

describe("supplier assistant", () => {
  it("rejects bad arguments, unknown tools and a buyer's context", async () => {
    const supplier = await createSupplier();
    expect(await runSupplierTool(supplier, "propose_set_price", { product_id: "x", price: 1 })).toEqual({ ok: false, error: "invalid_arguments" });
    expect(await runSupplierTool(supplier, "drop_database", {})).toEqual({ ok: false, error: "unknown_tool" });
    await expect(runSupplierTool(await createBuyer(), "list_pending_orders", {})).rejects.toThrow();
  });

  it("lists only its own pending orders and cannot read another supplier's order", async () => {
    const mine = await createSupplier();
    const theirs = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(mine, buyer);
    await connectBuyer(theirs, buyer);
    const p1 = await createTestProduct(mine, categoryId, { name: "[TEST] Sup A" });
    const p2 = await createTestProduct(theirs, categoryId, { name: "[TEST] Sup B" });
    const o1 = await place(mine, buyer, p1);
    const o2 = await place(theirs, buyer, p2);
    const pending = await runSupplierTool(mine, "list_pending_orders", {});
    if (!pending.ok) throw new Error("failed");
    expect((pending.forModel as { orders: { number: string }[] }).orders.map((o) => o.number)).toEqual([`GST-${o1.number}`]);
    expect(await runSupplierTool(mine, "get_order", { number: o2.number })).toEqual({ ok: false, error: "not_found" });
  });

  it("a confirm proposal changes nothing until applied, then confirms only what is still pending", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Confirm me" });
    const a = await place(supplier, buyer, product);
    const b = await place(supplier, buyer, product, 3);
    const card = proposal(await runSupplierTool(supplier, "propose_confirm_orders", { numbers: [a.number, b.number] }));
    expect(card.rows).toHaveLength(2);
    expect(await statusOf(a.orderId)).toBe("pending");
    // Someone answers one of them by hand in the meantime.
    const { rejectOrder } = await import("@/server/domain/orders/transitions");
    await rejectOrder(supplier, b.orderId, "no stock today");
    const applied = await applySupplierAction(supplier, card.action);
    expect(applied.ok).toBe(true);
    expect(await statusOf(a.orderId)).toBe("confirmed");
    expect(await statusOf(b.orderId)).toBe("rejected");
  });

  it("reject needs a reason, delivering needs a confirmed order, and another supplier's order cannot be touched", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Reject me" });
    const o = await place(supplier, buyer, product);
    expect(await runSupplierTool(supplier, "propose_reject_order", { number: o.number, reason: "x" })).toEqual({ ok: false, error: "invalid_arguments" });
    expect(await runSupplierTool(supplier, "propose_mark_delivered", { numbers: [o.number] })).toMatchObject({ ok: false });
    const card = proposal(await runSupplierTool(supplier, "propose_reject_order", { number: o.number, reason: "Out of season" }));
    expect(card.danger).toBe(true);
    // Another company applying the same action finds nothing.
    expect(await applySupplierAction(other, card.action)).toEqual({ ok: false, error: "not_found" });
    expect(await statusOf(o.orderId)).toBe("pending");
    expect((await applySupplierAction(supplier, card.action)).ok).toBe(true);
    expect(await statusOf(o.orderId)).toBe("rejected");
  });

  it("hides products and changes a price only on the supplier's own products, keeping every other field", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const mine = await createTestProduct(supplier, categoryId, { name: "[TEST] Price me", basePrice: "10" });
    const foreign = await createTestProduct(other, categoryId, { name: "[TEST] Not mine" });
    expect(await runSupplierTool(supplier, "propose_set_price", { product_id: foreign, price: 1 })).toEqual({ ok: false, error: "not_found" });
    expect(await runSupplierTool(supplier, "propose_set_active", { product_ids: [foreign], active: false })).toEqual({ ok: false, error: "nothing_to_change" });

    const price = proposal(await runSupplierTool(supplier, "propose_set_price", { product_id: mine, price: 12.5 }));
    expect(price.rows[0].after).toContain("12");
    const [before] = await getDb().select().from(products).where(eq(products.id, mine));
    expect((await applySupplierAction(supplier, price.action)).ok).toBe(true);
    const [after] = await getDb().select().from(products).where(eq(products.id, mine));
    expect(after.basePriceMinor).toBe(1250);
    expect({ ...after, basePriceMinor: 0, updatedAt: null }).toEqual({ ...before, basePriceMinor: 0, updatedAt: null });

    const hide = proposal(await runSupplierTool(supplier, "propose_set_active", { product_ids: [mine, foreign], active: false }));
    expect(hide.rows).toHaveLength(1);
    expect((await applySupplierAction(supplier, hide.action)).ok).toBe(true);
    expect((await getDb().select().from(products).where(eq(products.id, mine)))[0].isActive).toBe(false);
    expect((await getDb().select().from(products).where(eq(products.id, foreign)))[0].isActive).toBe(true);
  });

  it("an action forged in the browser is checked again", async () => {
    const supplier = await createSupplier();
    expect(await applySupplierAction(supplier, { type: "orders_confirm", orderIds: ["not-a-uuid"] })).toEqual({ ok: false, error: "invalid" });
    expect(await applySupplierAction(supplier, { type: "product_price", productId: randomUUID(), priceMinor: -5 })).toEqual({ ok: false, error: "invalid" });
    expect(await applySupplierAction(supplier, { type: "product_price", productId: randomUUID(), priceMinor: 100 })).toEqual({ ok: false, error: "not_found" });
    await expect(applySupplierAction(await createBuyer(), { type: "orders_confirm", orderIds: [randomUUID()] })).rejects.toThrow();
  });

  it("finds products, customers and builds the loading sheet", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Findable cheese" });
    const found = await runSupplierTool(supplier, "find_products", { query: "Findable cheese" });
    if (!found.ok) throw new Error("failed");
    expect((found.forModel as { products: { uuid: string }[] }).products.map((p) => p.uuid)).toEqual([product]);
    const customers = await runSupplierTool(supplier, "list_customers", {});
    expect(customers.ok && (customers.forModel as { customers: unknown[] }).customers.length).toBe(1);
    const o = await place(supplier, buyer, product);
    const { confirmOrder } = await import("@/server/domain/orders/transitions");
    await confirmOrder(supplier, o.orderId, [], undefined, undefined);
    const sheet = await runSupplierTool(supplier, "loading_sheet", { day: "none" });
    expect(sheet.ok && (sheet.forModel as { stops: number }).stops).toBe(1);
  });
});
