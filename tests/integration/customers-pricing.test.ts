import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { customerSchema } from "@/lib/validation/customer";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { getDb } from "@/server/db/client";
import { invitations, organizations, supplierCustomers } from "@/server/db/schema";
import {
  getConnectedSupplier,
  listBuyerCatalog,
  listConnectedSuppliers,
  searchConnectedCatalogs,
} from "@/server/domain/buyer/catalog";
import { setProductActive } from "@/server/domain/catalog/products";
import type { AdminCtx, OrgCtx, SupplierCtx } from "@/server/domain/context";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  regenerateInvitation,
  revokeInvitations,
  setCustomerBlocked,
  setCustomerPriceList,
} from "@/server/domain/customers/customers";
import {
  acceptInvitationAsBuyer,
  acceptInvitationWithNewBuyer,
  previewInvitation,
} from "@/server/domain/customers/invitations";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { OnboardingError } from "@/server/domain/onboarding/create-organization";
import {
  applyBulkDiscount,
  createPriceList,
  deletePriceList,
  discountedPrice,
  getPriceList,
  listPriceListProducts,
  previewBulkDiscount,
  setPriceOverrides,
} from "@/server/domain/pricing/price-lists";
import { analyzePriceImport, commitPriceImport } from "@/server/domain/pricing/price-import";
import { resolvePrices } from "@/server/domain/pricing/resolve";
import {
  connectBuyer,
  createAdmin,
  createAuthUser,
  createBuyer,
  createSupplier,
  createTestCategory,
  createTestProduct,
} from "./helpers";

let admin: AdminCtx;
let categoryId: string;
beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

const newCustomer = (overrides: Record<string, string> = {}) =>
  customerSchema.parse({ businessName: "[TEST] Café Customer", contactName: "Nino", phone: "555 12 34 56", ...overrides });

async function priceSeen(buyer: OrgCtx, supplier: SupplierCtx, productId: string): Promise<number | undefined> {
  const catalog = await listBuyerCatalog(buyer, supplier.orgId, {});
  return catalog.items.find((p) => p.id === productId)?.priceMinor;
}

describe("invitations", () => {
  it("only approved suppliers can invite", async () => {
    const pending = await createSupplier("pending_review");
    await expect(createCustomer(pending, newCustomer())).rejects.toEqual(new StateError("not_active"));
  });

  it("stores only a hash and can be accepted exactly once", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const other = await createBuyer();
    const { customerId, token } = await createCustomer(supplier, newCustomer());

    const stored = await getDb().select({ hash: invitations.tokenHash }).from(invitations).where(eq(invitations.supplierCustomerId, customerId));
    expect(stored).toHaveLength(1);
    expect(stored[0].hash).not.toContain(token);
    expect(stored[0].hash).toMatch(/^[0-9a-f]{64}$/);

    expect(await previewInvitation(token)).toMatchObject({ status: "valid", businessName: "[TEST] Café Customer" });
    await acceptInvitationAsBuyer(buyer, token);
    await expect(acceptInvitationAsBuyer(other, token)).rejects.toEqual(new StateError("unavailable"));
    expect(await previewInvitation(token)).toEqual({ status: "unavailable" });

    expect(await getCustomer(supplier, customerId)).toMatchObject({ status: "active", buyerOrgName: expect.stringContaining("[TEST] Café") });
  });

  it("expired, revoked, forged and never-issued tokens all fail identically", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const expired = await createCustomer(supplier, newCustomer());
    await getDb()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.supplierCustomerId, expired.customerId));
    const revoked = await createCustomer(supplier, newCustomer());
    await revokeInvitations(supplier, revoked.customerId);
    const forged = revoked.token.slice(0, -1) + (revoked.token.endsWith("A") ? "B" : "A");

    for (const token of [expired.token, revoked.token, forged, "x".repeat(43), "not-even-close", ""]) {
      expect(await previewInvitation(token)).toEqual({ status: "unavailable" });
      await expect(acceptInvitationAsBuyer(buyer, token)).rejects.toEqual(new StateError("unavailable"));
    }
  });

  it("a new link revokes the previous one", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const { customerId, token: first } = await createCustomer(supplier, newCustomer());
    const second = await regenerateInvitation(supplier, customerId);
    expect(await previewInvitation(first)).toEqual({ status: "unavailable" });
    await acceptInvitationAsBuyer(buyer, second);
    await expect(regenerateInvitation(supplier, customerId)).rejects.toEqual(new StateError("not_invited"));
  });

  it("creates the buyer organization and the connection together for a new user", async () => {
    const supplier = await createSupplier();
    const { token } = await createCustomer(supplier, newCustomer());
    const user = await createAuthUser();
    const onboarding = onboardingSchema.parse({
      kind: "buyer",
      businessName: "[TEST] New Café",
      businessType: "cafe",
      contactName: "Nino",
      phone: "555123456",
      city: "Tbilisi",
      addressLine: "Main st 1",
    });
    if (onboarding.kind !== "buyer") throw new Error("unreachable");
    const { orgId } = await acceptInvitationWithNewBuyer(user.id, token, onboarding);
    const buyer: OrgCtx = { userId: user.id, orgId, orgType: "buyer", orgStatus: "active" };
    expect((await listConnectedSuppliers(buyer)).map((s) => s.id)).toEqual([supplier.orgId]);
  });

  it("rolls back the connection if the new user already has an organization", async () => {
    const supplier = await createSupplier();
    const { token } = await createCustomer(supplier, newCustomer());
    const existing = await createBuyer();
    const onboarding = onboardingSchema.parse({
      kind: "buyer", businessName: "[TEST] Dup", businessType: "cafe", contactName: "N", phone: "555123456", city: "T", addressLine: "A",
    });
    if (onboarding.kind !== "buyer") throw new Error("unreachable");
    await expect(acceptInvitationWithNewBuyer(existing.userId, token, onboarding)).rejects.toBeInstanceOf(OnboardingError);
    expect(await previewInvitation(token)).toMatchObject({ status: "valid" });
  });

  it("refuses a second connection between the same buyer and supplier", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const { token } = await createCustomer(supplier, newCustomer());
    await expect(acceptInvitationAsBuyer(buyer, token)).rejects.toEqual(new StateError("already_connected"));
  });

  it("suppliers cannot accept invitations", async () => {
    const supplier = await createSupplier();
    const otherSupplier = await createSupplier();
    const { token } = await createCustomer(supplier, newCustomer());
    await expect(acceptInvitationAsBuyer(otherSupplier, token)).rejects.toEqual(new StateError("not_a_buyer"));
  });
});

describe("buyer visibility and price isolation", () => {
  let supplier: SupplierCtx;
  let x: OrgCtx;
  let y: OrgCtx;
  let stranger: OrgCtx;
  let productId: string;
  let listX: string;
  let listY: string;

  beforeAll(async () => {
    supplier = await createSupplier();
    productId = await createTestProduct(supplier, categoryId, { name: "ყველი იმერული", basePrice: "10" });
    listX = await createPriceList(supplier, "[TEST] Restaurants");
    listY = await createPriceList(supplier, "[TEST] Cafés");
    await setPriceOverrides(supplier, listX, [{ productId, priceMinor: 800 }]);
    await setPriceOverrides(supplier, listY, [{ productId, priceMinor: 900 }]);
    x = await createBuyer();
    y = await createBuyer();
    stranger = await createBuyer();
    await connectBuyer(supplier, x, listX);
    await connectBuyer(supplier, y, listY);
  });

  it("each buyer sees their own list's price, and resolvePrices agrees", async () => {
    expect(await priceSeen(x, supplier, productId)).toBe(800);
    expect(await priceSeen(y, supplier, productId)).toBe(900);
    const resolved = await resolvePrices({ supplierOrgId: supplier.orgId, buyerOrgId: x.orgId, productIds: [productId] });
    expect(resolved.get(productId)).toBe(800);
    const forStranger = await resolvePrices({ supplierOrgId: supplier.orgId, buyerOrgId: stranger.orgId, productIds: [productId] });
    expect(forStranger.get(productId)).toBe(1000);
  });

  it("an unconnected buyer can't see the supplier or its catalog", async () => {
    expect(await listConnectedSuppliers(stranger)).toEqual([]);
    await expect(getConnectedSupplier(stranger, supplier.orgId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listBuyerCatalog(stranger, supplier.orgId, {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a supplier can't use buyer catalog functions", async () => {
    await expect(listConnectedSuppliers(supplier)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("hides inactive products from buyers", async () => {
    const hidden = await createTestProduct(supplier, categoryId, { name: "[TEST] Hidden" });
    await setProductActive(supplier, hidden, false);
    const ids = (await listBuyerCatalog(x, supplier.orgId, {})).items.map((p) => p.id);
    expect(ids).toContain(productId);
    expect(ids).not.toContain(hidden);
  });

  it("blocking ends access; unblocking restores it", async () => {
    const buyer = await createBuyer();
    const { customerId } = await connectBuyer(supplier, buyer);
    await setCustomerBlocked(supplier, customerId, true);
    await expect(listBuyerCatalog(buyer, supplier.orgId, {})).rejects.toBeInstanceOf(NotFoundError);
    expect(await listConnectedSuppliers(buyer)).toEqual([]);
    await setCustomerBlocked(supplier, customerId, false);
    expect((await listBuyerCatalog(buyer, supplier.orgId, {})).total).toBeGreaterThan(0);
  });

  it("suspended and pending suppliers are invisible to their buyers", async () => {
    const other = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(other, buyer);
    for (const status of ["suspended", "pending_review"] as const) {
      await getDb().update(organizations).set({ status }).where(eq(organizations.id, other.orgId));
      expect(await listConnectedSuppliers(buyer)).toEqual([]);
      await expect(listBuyerCatalog(buyer, other.orgId, {})).rejects.toBeInstanceOf(NotFoundError);
    }
    await getDb().update(organizations).set({ status: "active" }).where(eq(organizations.id, other.orgId));
    expect(await listConnectedSuppliers(buyer)).toHaveLength(1);
  });

  it("deleting a price list puts its customers back on base prices", async () => {
    const buyer = await createBuyer();
    const list = await createPriceList(supplier, "[TEST] Temporary");
    await setPriceOverrides(supplier, list, [{ productId, priceMinor: 500 }]);
    const { customerId } = await connectBuyer(supplier, buyer, list);
    expect(await priceSeen(buyer, supplier, productId)).toBe(500);
    await deletePriceList(supplier, list);
    expect(await priceSeen(buyer, supplier, productId)).toBe(1000);
    expect((await getCustomer(supplier, customerId)).priceListId).toBeNull();
  });

  it("switching a customer's list changes their prices immediately", async () => {
    const buyer = await createBuyer();
    const { customerId } = await connectBuyer(supplier, buyer);
    expect(await priceSeen(buyer, supplier, productId)).toBe(1000);
    await setCustomerPriceList(supplier, customerId, listX);
    expect(await priceSeen(buyer, supplier, productId)).toBe(800);
  });
});

describe("supplier isolation", () => {
  it("a supplier can't read or use another supplier's customers or price lists", async () => {
    const s = await createSupplier();
    const t = await createSupplier();
    const productOfS = await createTestProduct(s, categoryId);
    const listOfS = await createPriceList(s, "[TEST] S list");
    const listOfT = await createPriceList(t, "[TEST] T list");
    const { customerId } = await createCustomer(s, newCustomer());

    await expect(getCustomer(t, customerId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listCustomers(t)).map((c) => c.id)).not.toContain(customerId);
    await expect(setCustomerBlocked(t, customerId, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPriceList(t, listOfS)).rejects.toBeInstanceOf(NotFoundError);
    await expect(listPriceListProducts(t, listOfS, {})).rejects.toBeInstanceOf(NotFoundError);
    // T can't put S's product on T's list, nor assign S's list to a customer.
    await expect(setPriceOverrides(t, listOfT, [{ productId: productOfS, priceMinor: 1 }])).rejects.toEqual(
      new StateError("unknown_products"),
    );
    const tCustomer = await createCustomer(t, newCustomer());
    await expect(setCustomerPriceList(t, tCustomer.customerId, listOfS)).rejects.toEqual(
      new StateError("price_list_unavailable"),
    );
  });

  it("the database itself rejects cross-supplier price list rows", async () => {
    const s = await createSupplier();
    const t = await createSupplier();
    const productOfS = await createTestProduct(s, categoryId);
    const listOfT = await createPriceList(t, "[TEST] T list");
    await expect(
      getDb().execute(sql`
        insert into price_list_items (price_list_id, product_id, supplier_org_id, price_minor)
        values (${listOfT}, ${productOfS}, ${t.orgId}, 1)`),
    ).rejects.toThrow();
    await expect(
      getDb().execute(sql`
        insert into price_list_items (price_list_id, product_id, supplier_org_id, price_minor)
        values (${listOfT}, ${productOfS}, ${s.orgId}, 1)`),
    ).rejects.toThrow();
  });
});

describe("price list tools", () => {
  it("bulk discount previews then applies with half-up rounding", async () => {
    const supplier = await createSupplier();
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] A", basePrice: "10" });
    const b = await createTestProduct(supplier, categoryId, { name: "[TEST] B", basePrice: "0,05" });
    const list = await createPriceList(supplier, "[TEST] −12.5%");

    const preview = await previewBulkDiscount(supplier, list, 1250);
    expect(preview.count).toBe(2);
    expect(preview.sample).toEqual(
      expect.arrayContaining([{ name: "[TEST] A", basePriceMinor: 1000, newPriceMinor: 875 }]),
    );
    expect(await applyBulkDiscount(supplier, list, 1250)).toBe(2);

    const rows = (await listPriceListProducts(supplier, list, {})).items;
    expect(rows.find((r) => r.productId === a)?.overrideMinor).toBe(875);
    // 5 × 0.875 = 4.375 → 4 in both the SQL and the JS helper.
    expect(rows.find((r) => r.productId === b)?.overrideMinor).toBe(discountedPrice(5, 1250));
    await expect(applyBulkDiscount(supplier, list, 10_001)).rejects.toEqual(new StateError("invalid_discount"));
  });

  it("imports overrides by SKU, reporting unknown SKUs and bad prices", async () => {
    const supplier = await createSupplier();
    const p = await createTestProduct(supplier, categoryId, { sku: "IMP-1", basePrice: "5" });
    const list = await createPriceList(supplier, "[TEST] Imported");
    const sheet = { headers: ["SKU", "ფასი"], rows: [["IMP-1", "4,20"], ["NOPE", "1"], ["IMP-1", "3"], ["", "x"]] };
    const mapping = { sku: "SKU", price: "ფასი" };

    const analysis = await analyzePriceImport(supplier, list, sheet, mapping);
    expect(analysis.counts).toEqual({ set: 1, error: 3 });
    await expect(commitPriceImport(supplier, list, sheet, mapping, "all")).rejects.toEqual(new StateError("has_errors"));
    expect(await commitPriceImport(supplier, list, sheet, mapping, "valid_only")).toEqual({ updated: 1, skipped: 3 });
    expect((await listPriceListProducts(supplier, list, {})).items.find((r) => r.productId === p)?.overrideMinor).toBe(420);
  });
});

describe("cross-supplier search", () => {
  it("finds Georgian products by Latin queries, only at connected suppliers, grouped", async () => {
    const s1 = await createSupplier();
    const s2 = await createSupplier();
    const unconnected = await createSupplier();
    await createTestProduct(s1, categoryId, { name: "ყველი სულგუნი" });
    await createTestProduct(s2, categoryId, { name: "ყველი იმერული" });
    await createTestProduct(s2, categoryId, { name: "წყალი" });
    await createTestProduct(unconnected, categoryId, { name: "ყველი სხვა" });
    const buyer = await createBuyer();
    await connectBuyer(s1, buyer);
    await connectBuyer(s2, buyer);

    const groups = await searchConnectedCatalogs(buyer, "kveli");
    expect(groups.map((g) => g.supplier.id).sort()).toEqual([s1.orgId, s2.orgId].sort());
    expect(groups.flatMap((g) => g.items.map((i) => i.name)).sort()).toEqual(["ყველი იმერული", "ყველი სულგუნი"]);
    expect(groups.every((g) => g.items.every((i) => typeof i.priceMinor === "number"))).toBe(true);
    expect(await searchConnectedCatalogs(buyer, "   ")).toEqual([]);
  });

  it("caps results per supplier and reports the total for 'show more'", async () => {
    const supplier = await createSupplier();
    for (let i = 0; i < 12; i++) await createTestProduct(supplier, categoryId, { name: `ყველი ${i}` });
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const [group] = await searchConnectedCatalogs(buyer, "qveli");
    expect(group.items.length).toBeLessThan(12);
    expect(group.totalMatches).toBe(12);
  });
});

describe("customer status in the database", () => {
  it("an active customer must have a buyer org", async () => {
    const supplier = await createSupplier();
    const { customerId } = await createCustomer(supplier, newCustomer());
    await expect(
      getDb().update(supplierCustomers).set({ status: "active" }).where(eq(supplierCustomers.id, customerId)),
    ).rejects.toThrow();
  });
});
