import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { productSchema } from "@/lib/validation/product";
import { getDb } from "@/server/db/client";
import { addresses, auditLogs, organizations } from "@/server/db/schema";
import { listAuditActions, listAuditLog } from "@/server/domain/admin/audit-log";
import { viewOrderForAdmin } from "@/server/domain/admin/orders";
import {
  countPendingOrganizations,
  getBuyerForAdmin,
  getVerificationInfo,
  listOrganizations,
  reviewBuyer,
} from "@/server/domain/admin/organizations";
import { reviewSupplier } from "@/server/domain/admin/suppliers";
import { createCategory } from "@/server/domain/catalog/categories";
import { createProduct } from "@/server/domain/catalog/products";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { getOrder } from "@/server/domain/orders/queries";
import { submitOrder } from "@/server/domain/orders/submit";
import { cancelByBuyer, confirmOrder } from "@/server/domain/orders/transitions";
import { listTopOrderedProducts } from "@/server/domain/buyer/catalog";
import { listNotifications } from "@/server/notifications/queries";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct, productInput } from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

async function place(supplier: SupplierCtx, buyer: OrgCtx, productId: string, qty = 1) {
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

describe("organizations (admin)", () => {
  it("searches by name and filters by type", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const [s] = await getDb().select({ name: organizations.name }).from(organizations).where(eq(organizations.id, supplier.orgId));
    const found = await listOrganizations(admin, { q: s.name });
    expect(found.items.map((o) => o.id)).toEqual([supplier.orgId]);
    expect((await listOrganizations(admin, { q: s.name, type: "buyer" })).items).toEqual([]);
    expect((await listOrganizations(admin, { type: "buyer" })).items.some((o) => o.id === buyer.orgId)).toBe(true);
    // LIKE wildcards in the query are literals, not patterns.
    expect((await listOrganizations(admin, { q: "%" })).total).toBe(0);
  });

  it("suspends and reactivates a buyer: reason required, conditional, audited", async () => {
    const buyer = await createBuyer();
    await expect(reviewBuyer(admin, buyer.orgId, "suspend")).rejects.toEqual(new StateError("reason_required"));
    await expect(reviewBuyer(admin, buyer.orgId, "suspend", "ab")).rejects.toEqual(new StateError("reason_required"));
    await expect(reviewBuyer(admin, buyer.orgId, "reactivate", "Back to normal")).rejects.toEqual(new StateError("stale_status"));

    await reviewBuyer(admin, buyer.orgId, "suspend", "Unpaid invoices outside Gusto");
    expect((await getBuyerForAdmin(admin, buyer.orgId)).org.status).toBe("suspended");
    await expect(reviewBuyer(admin, buyer.orgId, "suspend", "Twice")).rejects.toEqual(new StateError("stale_status"));
    await reviewBuyer(admin, buyer.orgId, "reactivate", "Resolved");
    expect((await getBuyerForAdmin(admin, buyer.orgId)).org.status).toBe("active");

    const log = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, buyer.orgId));
    // Registration is audited too; the two admin actions follow it.
    expect(log.map((l) => l.action).sort()).toEqual(["buyer.reactivate", "buyer.suspend", "organization.created"]);
    expect(log.find((l) => l.action === "buyer.suspend")).toMatchObject({
      actorUserId: admin.userId,
      data: { before: "active", after: "suspended", reason: "Unpaid invoices outside Gusto" },
    });
  });

  it("approves a buyer waiting for verification, without a reason, once; shows what to check", async () => {
    const buyer = await createBuyer("pending_review");
    expect((await getBuyerForAdmin(admin, buyer.orgId)).org.status).toBe("pending_review");
    expect(await countPendingOrganizations(admin, "buyer")).toBeGreaterThanOrEqual(1);
    const info = await getVerificationInfo(admin, buyer.orgId);
    expect(info).toMatchObject({ preRegistered: false, invitedBy: [], freeMail: false });
    expect(info.legalId).toMatch(/^\d{9}$/);

    await reviewBuyer(admin, buyer.orgId, "approve");
    expect((await getBuyerForAdmin(admin, buyer.orgId)).org.status).toBe("active");
    await expect(reviewBuyer(admin, buyer.orgId, "approve")).rejects.toEqual(new StateError("stale_status"));
    const [log] = await getDb().select().from(auditLogs).where(eq(auditLogs.action, "buyer.approve"));
    expect(log).toMatchObject({ actorUserId: admin.userId, data: { before: "pending_review", after: "active" } });
  });

  it("lists organizations waiting for verification first and filters by status", async () => {
    const buyer = await createBuyer("pending_review");
    const list = await listOrganizations(admin, { type: "buyer", status: "pending_review" });
    expect(list.items.every((o) => o.status === "pending_review")).toBe(true);
    expect(list.items.map((o) => o.id)).toContain(buyer.orgId);
  });

  it("a buyer organization is marked as pre-registered when the admin vetted it", async () => {
    const buyer = await createBuyer();
    expect((await getVerificationInfo(admin, buyer.orgId)).preRegistered).toBe(true);
  });

  it("a buyer review is for buyers only; supplier review for suppliers only", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await expect(reviewBuyer(admin, supplier.orgId, "suspend", "Not a buyer")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBuyerForAdmin(admin, supplier.orgId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reviewSupplier(admin, buyer.orgId, "suspend", "Not a supplier")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("order lookup (admin)", () => {
  it("returns the order by number and writes an audit row every time", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const p = await createTestProduct(supplier, categoryId, { basePrice: "10" });
    const { orderId, number } = await place(supplier, buyer, p, 2);

    const detail = await viewOrderForAdmin(admin, number);
    expect(detail.order.id).toBe(orderId);
    expect(detail.items).toHaveLength(1);
    expect(detail.history).toHaveLength(1);
    await viewOrderForAdmin(admin, number);

    const views = await getDb().select().from(auditLogs).where(eq(auditLogs.targetId, orderId));
    expect(views).toHaveLength(2);
    expect(views.every((v) => v.action === "order.view" && v.actorUserId === admin.userId)).toBe(true);
    expect(views[0].data).toEqual({ number });
  });

  it("unknown numbers are not found and not audited; non-admins get not found", async () => {
    const before = (await getDb().select().from(auditLogs).where(eq(auditLogs.action, "order.view"))).length;
    await expect(viewOrderForAdmin(admin, 99_999_999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(viewOrderForAdmin(admin, -5)).rejects.toBeInstanceOf(NotFoundError);
    await expect(viewOrderForAdmin(admin, 1.5)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getDb().select().from(auditLogs).where(eq(auditLogs.action, "order.view"))).length).toBe(before);
    await expect(viewOrderForAdmin({ userId: randomUUID(), isPlatformAdmin: false } as unknown as AdminCtx, 1001)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("audit log (admin)", () => {
  it("filters by actor, action and date, and pages", async () => {
    const buyer = await createBuyer();
    const other = await createAdmin();
    await reviewBuyer(admin, buyer.orgId, "suspend", "Filter test one");
    await reviewBuyer(other, buyer.orgId, "reactivate", "Filter test two");

    const byAction = await listAuditLog(admin, { action: "buyer.suspend" });
    expect(byAction.items.length).toBeGreaterThan(0);
    expect(byAction.items.every((i) => i.action === "buyer.suspend")).toBe(true);
    expect((await listAuditActions(admin))).toContain("buyer.reactivate");

    const mine = await listAuditLog(admin, { actor: "@test.gusto.ge", action: "buyer.reactivate" });
    expect(mine.items.some((i) => i.targetId === buyer.orgId && i.actorEmail?.endsWith("@test.gusto.ge"))).toBe(true);
    expect((await listAuditLog(admin, { actor: randomUUID() })).total).toBe(0);

    const today = new Date().toISOString().slice(0, 10);
    expect((await listAuditLog(admin, { action: "buyer.suspend", from: today, to: today })).total).toBeGreaterThan(0);
    expect((await listAuditLog(admin, { action: "buyer.suspend", to: "2000-01-01" })).total).toBe(0);
    expect((await listAuditLog(admin, { action: "buyer.suspend", from: "not-a-date" })).total).toBeGreaterThan(0);

    const page1 = await listAuditLog(admin, { page: 1 });
    expect(page1.items.length).toBeLessThanOrEqual(50);
    await expect(listAuditLog({ userId: randomUUID(), isPlatformAdmin: false } as unknown as AdminCtx, {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("tampering across roles and organizations", () => {
  it("a buyer cannot call supplier or admin domain functions", async () => {
    const buyer = await createBuyer();
    await expect(createProduct(buyer, productSchema.parse(productInput(categoryId)))).rejects.toBeInstanceOf(NotFoundError);
    await expect(createCategory(buyer as unknown as AdminCtx, "[TEST] sneaky")).rejects.toBeInstanceOf(NotFoundError);
    await expect(listOrganizations(buyer as unknown as AdminCtx, {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a supplier cannot order, and cannot read or move another supplier's order", async () => {
    const supplier = await createSupplier();
    const rival = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const p = await createTestProduct(supplier, categoryId, { basePrice: "10" });
    const { orderId } = await place(supplier, buyer, p);

    await expect(setCartQuantity(supplier, supplier.orgId, p, 1000)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrder(rival, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmOrder(rival, orderId, [])).rejects.toBeInstanceOf(NotFoundError);
    // The order is untouched.
    expect((await getOrder(supplier, orderId)).order.status).toBe("pending");
  });

  it("another buyer cannot read or cancel an order, and sees no notifications of it", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const stranger = await createBuyer();
    await connectBuyer(supplier, buyer);
    await connectBuyer(supplier, stranger);
    const p = await createTestProduct(supplier, categoryId, { basePrice: "10" });
    const { orderId } = await place(supplier, buyer, p);

    await expect(getOrder(stranger, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelByBuyer(stranger, orderId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listNotifications(stranger.userId)).total).toBe(0);
    expect((await getOrder(buyer, orderId)).order.status).toBe("pending");
  });

  it("an unconnected buyer cannot order from a supplier, whatever supplierOrgId they send", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const p = await createTestProduct(supplier, categoryId, { basePrice: "10" });
    await expect(setCartQuantity(buyer, supplier.orgId, p, 1000)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      submitOrder(buyer, supplier.orgId, { idempotencyKey: randomUUID(), expected: [], addressId: randomUUID() }),
    ).rejects.toEqual(new StateError("empty_cart"));
  });
});

describe("buyer dashboard: most-ordered products", () => {
  it("ranks by number of orders, shows current prices, hides what can't be ordered any more", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const often = await createTestProduct(supplier, categoryId, { name: "[TEST] Often", basePrice: "10" });
    const sometimes = await createTestProduct(supplier, categoryId, { name: "[TEST] Sometimes", basePrice: "5" });
    const gone = await createTestProduct(supplier, categoryId, { name: "[TEST] Gone", basePrice: "5" });

    await place(supplier, buyer, often);
    await place(supplier, buyer, often);
    await place(supplier, buyer, often);
    await place(supplier, buyer, sometimes);
    await place(supplier, buyer, sometimes);
    await place(supplier, buyer, gone);
    await getDb().execute((await import("drizzle-orm")).sql`update products set is_active = false where id = ${gone}`);

    const top = await listTopOrderedProducts(buyer, 10);
    expect(top.map((t) => [t.product.name, t.orderCount])).toEqual([
      ["[TEST] Often", 3],
      ["[TEST] Sometimes", 2],
    ]);
    expect(top[0].product.priceMinor).toBe(1000);
    expect(top[0].supplier.id).toBe(supplier.orgId);

    // Nothing ordered yet → empty list, not an error; and only buyers have one.
    expect(await listTopOrderedProducts(await createBuyer())).toEqual([]);
    await expect(listTopOrderedProducts(supplier)).rejects.toBeInstanceOf(NotFoundError);

    // Blocking the connection removes the supplier's products from the list.
    const { setCustomerBlocked } = await import("@/server/domain/customers/customers");
    const [row] = await getDb().execute<{ id: string }>((await import("drizzle-orm")).sql`select id from supplier_customers where buyer_org_id = ${buyer.orgId}`);
    await setCustomerBlocked(supplier, row.id, true);
    expect(await listTopOrderedProducts(buyer)).toEqual([]);
  });
});
