import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OrderSnap, Snapshot } from "@/lib/assistant/snapshots";
import { getDb } from "@/server/db/client";
import { addresses } from "@/server/db/schema";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { cartQuantities, getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { submitOrder } from "@/server/domain/orders/submit";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

// The assistant's tools run inside a Next request in production (translations, formatting). Here they get plain stand-ins, so what is
// tested is the data: who can see what, what a proposal says, what a confirmed action changes.
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  getFormatter: async () => ({ dateTime: (d: Date) => d.toISOString().slice(0, 10) }),
}));

const { runBuyerTool } = await import("@/server/assistant/buyer-tools");
const { applyBuyerAction } = await import("@/server/assistant/buyer-actions");
const { loadOrderHistory } = await import("@/server/assistant/history");

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

async function place(supplier: SupplierCtx, buyer: OrgCtx, lines: [string, number][]) {
  for (const [productId, qty] of lines) await setCartQuantity(buyer, supplier.orgId, productId, qty * 1000);
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

function ok(result: Awaited<ReturnType<typeof runBuyerTool>>) {
  if (!result.ok) throw new Error(`tool failed: ${result.error}`);
  return result;
}
const orderSnap = (view: Snapshot | null) => (view && view.kind === "order" ? view.order : (null as unknown as OrderSnap));

describe("assistant tools: what the buyer sees by hand", () => {
  it("search shows this buyer's products with their price, and never another buyer's assortment", async () => {
    const supplier = await createSupplier();
    const mine = await createBuyer();
    const other = await createBuyer();
    await connectBuyer(supplier, mine);
    const sulguni = await createTestProduct(supplier, categoryId, { name: "[TEST] Assistant sulguni", basePrice: "12" });

    const found = ok(await runBuyerTool(mine, "search_products", { query: "Assistant sulguni" }));
    const facts = found.forModel as { results: { uuid: string; product: string; price_per_unit: string }[] };
    expect(facts.results.map((r) => r.uuid)).toEqual([sulguni]);
    expect(facts.results[0].price_per_unit).toContain("12");
    expect(found.view?.kind).toBe("products");

    const none = ok(await runBuyerTool(other, "search_products", { query: "Assistant sulguni" }));
    expect((none.forModel as { results: unknown[] }).results).toEqual([]);
  });

  it("rejects bad arguments and tools it does not have, and refuses a supplier's context", async () => {
    const buyer = await createBuyer();
    expect(await runBuyerTool(buyer, "search_products", { query: "" })).toEqual({ ok: false, error: "invalid_arguments" });
    expect(await runBuyerTool(buyer, "drop_database", {})).toEqual({ ok: false, error: "unknown_tool" });
    await expect(runBuyerTool(await createSupplier(), "list_suppliers", {})).rejects.toThrow();
  });

  it("lists suppliers, orders and one order, and an order number of someone else is not found", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const stranger = await createBuyer();
    await connectBuyer(supplier, buyer);
    await connectBuyer(supplier, stranger);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Assistant eggs", basePrice: "5" });
    const placed = await place(supplier, buyer, [[product, 3]]);

    expect((ok(await runBuyerTool(buyer, "list_suppliers", {})).forModel as { suppliers: unknown[] }).suppliers).toHaveLength(1);
    const orders = ok(await runBuyerTool(buyer, "list_orders", {}));
    expect((orders.forModel as { orders: { number: string }[] }).orders.map((o) => o.number)).toEqual([`GST-${placed.number}`]);
    expect((ok(await runBuyerTool(stranger, "list_orders", {})).forModel as { orders: unknown[] }).orders).toEqual([]);

    const one = ok(await runBuyerTool(buyer, "get_order", { number: placed.number }));
    expect(orderSnap(one.view).number).toBe(`GST-${placed.number}`);
    expect((one.forModel as { lines: unknown[] }).lines).toHaveLength(1);
    expect(await runBuyerTool(stranger, "get_order", { number: placed.number })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("assistant proposals and confirmed actions", () => {
  it("proposes a cart change without changing anything, checks the step, and applies only on confirm", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Assistant cheese", basePrice: "10" });

    const proposal = ok(await runBuyerTool(buyer, "propose_cart_change", { product_id: product, quantity: 2, mode: "add" }));
    expect(proposal.view).toMatchObject({ kind: "proposal", action: { type: "cart_set", productId: product, qtyMilli: 2000 } });
    expect((await cartQuantities(buyer, supplier.orgId)).get(product)).toBeUndefined(); // nothing changed yet

    const applied = await applyBuyerAction(buyer, (proposal.view as { action: unknown }).action);
    expect(applied.ok).toBe(true);
    expect((await cartQuantities(buyer, supplier.orgId)).get(product)).toBe(2000);

    // "Add 1 more" is relative to the cart: 2 + 1.
    const more = ok(await runBuyerTool(buyer, "propose_cart_change", { product_id: product, quantity: 1, mode: "add" }));
    expect((more.view as { action: { qtyMilli: number } }).action.qtyMilli).toBe(3000);
    // Removing proposes zero.
    const removal = ok(await runBuyerTool(buyer, "propose_cart_change", { product_id: product, quantity: 0, mode: "remove" }));
    expect((removal.view as { action: { qtyMilli: number } }).action.qtyMilli).toBe(0);
    // A quantity off the step is explained to the model, not proposed.
    const off = await runBuyerTool(buyer, "propose_cart_change", { product_id: product, quantity: 0.0005, mode: "set" });
    expect(off.ok).toBe(false);
  });

  it("will not propose, or apply, a product the buyer may not order", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const stranger = await createBuyer();
    await connectBuyer(supplier, buyer);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Assistant private", basePrice: "10" });

    expect((await runBuyerTool(stranger, "propose_cart_change", { product_id: product, quantity: 1 })).ok).toBe(false);
    expect(await applyBuyerAction(stranger, { type: "cart_set", supplierId: supplier.orgId, productId: product, qtyMilli: 1000 })).toEqual({ ok: false, error: "not_found" });
    expect((await applyBuyerAction(buyer, { type: "cart_set", supplierId: supplier.orgId, productId: "not-a-uuid", qtyMilli: 1000 })).ok).toBe(false);
    expect((await applyBuyerAction(buyer, { type: "drop", orderId: randomUUID() })).ok).toBe(false);
  });

  it("proposes order again and saves a regular order, applying only the buyer's own order", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const stranger = await createBuyer();
    await connectBuyer(supplier, buyer);
    await connectBuyer(supplier, stranger);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Assistant milk", basePrice: "4" });
    const placed = await place(supplier, buyer, [[product, 6]]);

    const again = ok(await runBuyerTool(buyer, "propose_reorder", { number: placed.number }));
    const action = (again.view as { action: { type: string; orderId: string } }).action;
    expect(action.type).toBe("reorder");
    expect((await cartQuantities(buyer, supplier.orgId)).get(product)).toBeUndefined();
    expect((await applyBuyerAction(buyer, action)).ok).toBe(true);
    expect((await cartQuantities(buyer, supplier.orgId)).get(product)).toBe(6000);

    // Someone else's order can be neither proposed nor applied.
    expect(await runBuyerTool(stranger, "propose_reorder", { number: placed.number })).toEqual({ ok: false, error: "not_found" });
    expect(await applyBuyerAction(stranger, action)).toEqual({ ok: false, error: "not_found" });

    const regular = ok(await runBuyerTool(buyer, "propose_regular_order", { number: placed.number, weekday: 4, name: "Thursday milk" }));
    expect((await applyBuyerAction(buyer, (regular.view as { action: unknown }).action)).ok).toBe(true);
    expect(await runBuyerTool(buyer, "propose_regular_order", { number: placed.number, weekday: 9 })).toEqual({ ok: false, error: "invalid_arguments" });
  });

  it("shows choices as buttons and nothing else", async () => {
    const buyer = await createBuyer();
    const result = ok(await runBuyerTool(buyer, "show_choices", { question: "Which cheese?", options: ["Sulguni", "Imeruli"] }));
    expect(result.view).toEqual({ kind: "choices", question: "Which cheese?", options: ["Sulguni", "Imeruli"] });
    expect(await runBuyerTool(buyer, "show_choices", { question: "x", options: ["only one"] })).toEqual({ ok: false, error: "invalid_arguments" });
  });
});

describe("order history for the usual", () => {
  it("groups this buyer's last orders per supplier, newest first, and never another buyer's", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const other = await createBuyer();
    await connectBuyer(supplier, buyer);
    await connectBuyer(supplier, other);
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] Hist a", basePrice: "2" });
    const b = await createTestProduct(supplier, categoryId, { name: "[TEST] Hist b", basePrice: "3" });
    await place(supplier, buyer, [[a, 2]]);
    await place(supplier, buyer, [[a, 4], [b, 1]]);
    await place(supplier, other, [[b, 9]]);

    const mine = (await loadOrderHistory(buyer)).get(supplier.orgId)!;
    expect(mine).toHaveLength(2);
    expect(mine[0].lines.map((l) => l.productId).sort()).toEqual([a, b].sort());
    expect(mine[1].lines).toEqual([{ productId: a, qtyMilli: 2000 }]);
    expect((await loadOrderHistory(other)).get(supplier.orgId)).toHaveLength(1);
  });
});

describe("the usual in the voice catalogue", () => {
  it("is the latest order for a young history and the typical order once there are three", async () => {
    const { loadVoiceCatalog } = await import("@/server/domain/buyer/voice-catalog");
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] Usual a", basePrice: "2" });
    const b = await createTestProduct(supplier, categoryId, { name: "[TEST] Usual b", basePrice: "3" });
    const c = await createTestProduct(supplier, categoryId, { name: "[TEST] Usual c", basePrice: "3" });

    expect((await loadVoiceCatalog(buyer)).previous).toBe("");
    await place(supplier, buyer, [[a, 2], [b, 1]]);
    const young = (await loadVoiceCatalog(buyer)).previous;
    expect(young).toContain("2 "); // the single order, as it was

    await place(supplier, buyer, [[a, 4], [b, 1]]);
    await place(supplier, buyer, [[a, 2], [c, 7]]); // c is a one-off
    const catalogue = await loadVoiceCatalog(buyer);
    const aliasOf = (name: string) => catalogue.items.find((i) => i.name === name)!.id;
    expect(catalogue.previous).toContain(`${aliasOf("[TEST] Usual a")} 2 `); // median of 2, 4, 2
    expect(catalogue.previous).toContain(`${aliasOf("[TEST] Usual b")} 1 `); // in two of three orders
    expect(catalogue.previous).not.toContain(aliasOf("[TEST] Usual c")); // a one-off is not "usual"
  });
});
