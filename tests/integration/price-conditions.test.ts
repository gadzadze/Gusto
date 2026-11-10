import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { notificationDeliveries, notifications } from "@/server/db/schema";
import { listNotifications, markRead } from "@/server/notifications/queries";
import { emailChannel } from "@/server/notifications/channels/email";
import { getDb } from "@/server/db/client";
import { addresses, orderItems, orders, supplierCustomers } from "@/server/db/schema";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { getPickList } from "@/server/domain/orders/pick-list";
import { submitOrder } from "@/server/domain/orders/submit";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { decideTermsRequest, getListRules, getTermsState, listTermsRequests, requestTerms, saveScopeRules } from "@/server/domain/pricing/conditions";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

async function setup() {
  const supplier = await createSupplier();
  const buyer = await createBuyer();
  const cheese = await createTestProduct(supplier, categoryId, { name: "ყველი", sku: "SUL", unit: "kg", basePrice: "10,00", minQty: "1", qtyStep: "1" });
  await connectBuyer(supplier, buyer);
  const [row] = await getDb()
    .select({ priceListId: supplierCustomers.priceListId })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.supplierOrgId, supplier.orgId), eq(supplierCustomers.buyerOrgId, buyer.orgId)));
  return { supplier, buyer, cheese, listId: row.priceListId! };
}

async function checkout(buyer: OrgCtx, supplier: SupplierCtx) {
  const cart = await getCart(buyer, supplier.orgId);
  const [address] = await getDb().select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buyer.orgId));
  return submitOrder(buyer, supplier.orgId, {
    idempotencyKey: randomUUID(),
    expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
    addressId: address.id,
  });
}

describe("price conditions", () => {
  it("applies quantity tiers per line and snapshots the list price and the change on the order", async () => {
    const { supplier, buyer, cheese, listId } = await setup();
    await saveScopeRules(supplier, listId, null, [
      { kind: "qty", minQtyMilli: 10_000, adjustBp: -500 },
      { kind: "qty", minQtyMilli: 50_000, adjustBp: -1000 },
    ]);
    await setCartQuantity(buyer, supplier.orgId, cheese, 5000);
    expect((await getCart(buyer, supplier.orgId)).lines[0].unitPriceMinor).toBe(1000);
    await setCartQuantity(buyer, supplier.orgId, cheese, 12_000);
    const cart = await getCart(buyer, supplier.orgId);
    expect(cart.lines[0]).toMatchObject({ listPriceMinor: 1000, adjustBp: -500, unitPriceMinor: 950 });

    const result = await checkout(buyer, supplier);
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    const [item] = await getDb().select().from(orderItems).where(eq(orderItems.orderId, result.orderId));
    expect(item).toMatchObject({ unitPriceMinor: 950, listPriceMinor: 1000, adjustBp: -500 });
  });

  it("changes prices only after the supplier approves the buyer's payment terms", async () => {
    const { supplier, buyer, cheese, listId } = await setup();
    await saveScopeRules(supplier, listId, null, [
      { kind: "method", method: "cash", adjustBp: -300 },
      { kind: "method", method: "transfer", adjustBp: 0 },
      { kind: "interval", intervalDays: 0, adjustBp: 0 },
      { kind: "interval", intervalDays: 30, adjustBp: 200 },
    ]);
    await setCartQuantity(buyer, supplier.orgId, cheese, 2000);

    // Asking for something the supplier doesn't offer is refused.
    await expect(requestTerms(buyer, supplier.orgId, { method: "cash", intervalDays: 14 })).rejects.toEqual(new StateError("not_offered"));

    await requestTerms(buyer, supplier.orgId, { method: "cash", intervalDays: 0 });
    // Still the standard price while the request is open.
    expect((await getCart(buyer, supplier.orgId)).lines[0].unitPriceMinor).toBe(1000);
    const state = await getTermsState(buyer, supplier.orgId);
    expect(state.pending).toMatchObject({ method: "cash", intervalDays: 0 });

    const [request] = await listTermsRequests(supplier);
    expect(request).toMatchObject({ fromBp: 0, toBp: -300 });
    expect(request.samples[0]).toMatchObject({ nowMinor: 1000, afterMinor: 970 });

    await decideTermsRequest(supplier, request.id, true);
    expect((await getCart(buyer, supplier.orgId)).lines[0].unitPriceMinor).toBe(970);
    expect((await listTermsRequests(supplier))).toHaveLength(0);

    const result = await checkout(buyer, supplier);
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    const [order] = await getDb().select().from(orders).where(eq(orders.id, result.orderId));
    expect(order).toMatchObject({ paymentMethod: "cash", paymentIntervalDays: 0 });

    // A declined request changes nothing, and another supplier cannot decide it.
    await requestTerms(buyer, supplier.orgId, { method: "transfer", intervalDays: 30 });
    const [second] = await listTermsRequests(supplier);
    const stranger = await createSupplier();
    await expect(decideTermsRequest(stranger, second.id, true)).rejects.toThrow();
    await decideTermsRequest(supplier, second.id, false);
    await setCartQuantity(buyer, supplier.orgId, cheese, 2000);
    expect((await getCart(buyer, supplier.orgId)).lines[0].unitPriceMinor).toBe(970);
  });

  it("lets a product's own rules replace the list's, and refuses bad rules", async () => {
    const { supplier, cheese, listId } = await setup();
    await saveScopeRules(supplier, listId, null, [{ kind: "method", method: "cash", adjustBp: -300 }]);
    await saveScopeRules(supplier, listId, cheese, [{ kind: "method", method: "cash", adjustBp: -800 }]);
    const rules = await getListRules(supplier, listId);
    expect(rules).toHaveLength(2);
    await expect(saveScopeRules(supplier, listId, null, [{ kind: "method", method: "crypto", adjustBp: 0 }])).rejects.toEqual(new StateError("invalid_rule"));
    await expect(saveScopeRules(supplier, listId, null, [{ kind: "qty", minQtyMilli: 0, adjustBp: -100 }])).rejects.toEqual(new StateError("invalid_rule"));
    await expect(saveScopeRules(supplier, listId, null, [{ kind: "method", method: "cash", adjustBp: -9500 }])).rejects.toEqual(new StateError("invalid_rule"));
    await expect(
      saveScopeRules(supplier, listId, null, [
        { kind: "interval", intervalDays: 7, adjustBp: 0 },
        { kind: "interval", intervalDays: 7, adjustBp: 100 },
      ]),
    ).rejects.toEqual(new StateError("invalid_rule"));
    // Another supplier's list is not reachable.
    const other = await createSupplier();
    await expect(saveScopeRules(other, listId, null, [])).rejects.toThrow();
  });
});

describe("notifications beyond orders", () => {
  it("tells the supplier about a terms request and the buyer about the answer, in the app and by email", async () => {
    const { supplier, buyer, listId } = await setup();
    await saveScopeRules(supplier, listId, null, [{ kind: "method", method: "cash", adjustBp: -300 }]);
    await requestTerms(buyer, supplier.orgId, { method: "cash", intervalDays: null });

    const supplierList = await listNotifications(supplier.userId);
    const asked = supplierList.items.find((n) => n.event === "terms_requested");
    expect(asked).toBeDefined();
    expect(asked!.orderNumber).toBeNull();
    expect(asked!.link).toMatch(/^\/supplier\/customers\/[0-9a-f-]{36}$/);
    // The one who asked is not notified of their own action.
    expect((await listNotifications(buyer.userId)).items.some((n) => n.event === "terms_requested")).toBe(false);
    expect(await markRead(supplier.userId, asked!.id)).toMatchObject({ orderNumber: null, link: asked!.link });

    // An email is queued for the supplier (no order in it), and it renders and sends without one.
    const deliveries = await getDb().select().from(notificationDeliveries).where(eq(notificationDeliveries.recipientUserId, supplier.userId));
    const queued = deliveries.find((d) => d.payload.event === "terms_requested");
    expect(queued).toBeDefined();
    expect(queued!.payload.orderId).toBeUndefined();
    const sent = await emailChannel.send!({ id: queued!.id, notificationId: queued!.notificationId, recipientUserId: supplier.userId, payload: queued!.payload, attempts: 1 });
    expect(sent.status).toBe("skipped"); // no email provider configured in tests

    const [request] = await listTermsRequests(supplier);
    await decideTermsRequest(supplier, request.id, true);
    const buyerList = await listNotifications(buyer.userId);
    const answer = buyerList.items.find((n) => n.event === "terms_approved");
    expect(answer?.link).toBe(`/buyer/suppliers/${supplier.orgId}`);

    // A decline reaches the buyer too; the supplier is not told about their own decision.
    await requestTerms(buyer, supplier.orgId, { method: null, intervalDays: null });
    const [second] = await listTermsRequests(supplier);
    await decideTermsRequest(supplier, second.id, false);
    expect((await listNotifications(buyer.userId)).items.some((n) => n.event === "terms_declined")).toBe(true);
    expect((await listNotifications(supplier.userId)).items.some((n) => n.event === "terms_declined")).toBe(false);
  });

  it("tells the supplier when an invited customer joins", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const joined = (await listNotifications(supplier.userId)).items.find((n) => n.event === "customer_connected");
    expect(joined).toBeDefined();
    expect(joined!.link).toMatch(/^\/supplier\/customers\//);
    const rows = await getDb().select().from(notifications).where(eq(notifications.userId, supplier.userId));
    expect(rows.filter((r) => r.event === "customer_connected")).toHaveLength(1);
  });
});

describe("loading sheet", () => {
  it("splits each product's total per order and lists each stop's lines", async () => {
    const { supplier, buyer, cheese } = await setup();
    const water = await createTestProduct(supplier, categoryId, { name: "წყალი", sku: "WAT", unit: "bottle", basePrice: "1,00", minQty: "1", qtyStep: "1" });
    const buyer2 = await createBuyer();
    await connectBuyer(supplier, buyer2);
    const today = todayIn("Asia/Tbilisi");
    const day = addDays(today, 2);
    const orderIds: string[] = [];
    for (const [b, qty] of [[buyer, 3000], [buyer2, 7000]] as const) {
      await setCartQuantity(b, supplier.orgId, cheese, qty);
      if (b === buyer) await setCartQuantity(b, supplier.orgId, water, 4000);
      const r = await checkout(b, supplier);
      expect(r.status).toBe("created");
      if (r.status !== "created") return;
      orderIds.push(r.orderId);
      await confirmOrder(supplier, r.orderId, [], undefined, day);
    }
    const list = await getPickList(supplier, day);
    const rows = list.groups.flatMap((g) => g.rows);
    const cheeseRow = rows.find((r) => r.name === "ყველი")!;
    expect(cheeseRow.qtyMilli).toBe(10_000);
    expect(cheeseRow.parts.map((p) => p.qtyMilli).sort((a, b) => a - b)).toEqual([3000, 7000]);
    const waterRow = rows.find((r) => r.name === "წყალი")!;
    expect(waterRow.parts).toHaveLength(1);
    expect(Object.keys(list.stopLines).sort()).toEqual([...orderIds].sort());
    expect(list.stopLines[orderIds[0]].map((l) => l.qtyMilli).sort((a, b) => a - b)).toEqual([3000, 4000]);
    expect(list.stopLines[orderIds[1]]).toHaveLength(1);
  });
});
