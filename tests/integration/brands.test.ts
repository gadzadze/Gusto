import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { getDb } from "@/server/db/client";
import { addresses, connectionRequests, organizationMemberships, organizations } from "@/server/db/schema";
import { sendConnectionRequest } from "@/server/domain/connections/connections";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { getPickList } from "@/server/domain/orders/pick-list";
import { countSupplierOrders, listSupplierOrders } from "@/server/domain/orders/queries";
import { submitOrder } from "@/server/domain/orders/submit";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { OnboardingError, createOrganizationForUser } from "@/server/domain/onboarding/create-organization";
import { listMyBrands, scopeOrgIds } from "@/server/domain/suppliers/brands";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct, randomLegalId } from "./helpers";

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

/** The same person adds another supplier company (a brand), and the admin approves it. */
async function addBrand(first: SupplierCtx, name: string, approve = true): Promise<SupplierCtx> {
  const created = await createOrganizationForUser(
    first.userId,
    onboardingSchema.parse({ kind: "supplier", businessName: name, legalId: randomLegalId(), contactName: "Giorgi", phone: "599 00 00 00", city: "Tbilisi", deliveryArea: "Tbilisi" }),
    { addSide: true, additional: true },
  );
  expect(created.status).toBe("pending_review");
  if (approve) await getDb().update(organizations).set({ status: "active" }).where(eq(organizations.id, created.orgId));
  return { userId: first.userId, orgId: created.orgId, orgType: "supplier", orgStatus: approve ? "active" : "pending_review" };
}

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

describe("one login, several supplier companies", () => {
  it("adds a further company of the same kind: it waits for the admin, and only on purpose", async () => {
    const first = await createSupplier();
    const input = (legalId: string) =>
      onboardingSchema.parse({ kind: "supplier", businessName: "[TEST] Brand", legalId, contactName: "G", phone: "599 00 00 00", city: "Tbilisi", deliveryArea: "Tbilisi" });
    // Without the explicit "another company" option the old rule holds.
    await expect(createOrganizationForUser(first.userId, input(randomLegalId()), { addSide: true })).rejects.toEqual(new OnboardingError("already_has_kind"));
    const brand = await addBrand(first, "[TEST] Brand B", false);
    expect(await listMyBrands(first)).toHaveLength(1); // the pending one is not offered yet
    await getDb().update(organizations).set({ status: "active" }).where(eq(organizations.id, brand.orgId));
    expect((await listMyBrands(first)).map((b) => b.id).sort()).toEqual([first.orgId, brand.orgId].sort());
    // A legal ID is still one company per kind.
    const [row] = await getDb().select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, brand.orgId));
    await expect(createOrganizationForUser(first.userId, input(row.legalId!), { addSide: true, additional: true })).rejects.toEqual(new OnboardingError("legal_id_taken"));
  });

  it("caps how many companies one person can run", async () => {
    const first = await createSupplier();
    for (let i = 0; i < 9; i++) await addBrand(first, `[TEST] Many ${i}`, false);
    await expect(
      createOrganizationForUser(
        first.userId,
        onboardingSchema.parse({ kind: "supplier", businessName: "[TEST] One too many", legalId: randomLegalId(), contactName: "G", phone: "599 00 00 00", city: "Tbilisi", deliveryArea: "Tbilisi" }),
        { addSide: true, additional: true },
      ),
    ).rejects.toEqual(new OnboardingError("too_many_companies"));
  });

  it("shows orders and the loading sheet of all brands together, and never someone else's", async () => {
    const a = await createSupplier();
    const b = await addBrand(a, "[TEST] Brand B");
    const stranger = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(a, buyer);
    await connectBuyer(b, buyer);
    await connectBuyer(stranger, buyer);
    const wineA = await createTestProduct(a, categoryId, { name: "[TEST] Wine A", basePrice: "10" });
    const wineB = await createTestProduct(b, categoryId, { name: "[TEST] Wine B", basePrice: "12" });
    const other = await createTestProduct(stranger, categoryId, { name: "[TEST] Other", basePrice: "5" });
    const day = addDays(todayIn("Asia/Tbilisi"), 2);
    const oa = await placeOrder(buyer, a, [[wineA, 2000]]);
    const ob = await placeOrder(buyer, b, [[wineB, 3000]]);
    const os = await placeOrder(buyer, stranger, [[other, 1000]]);
    await confirmOrder(a, oa, [], undefined, day);
    await confirmOrder(b, ob, [], undefined, day);
    await confirmOrder(stranger, os, [], undefined, day);

    // This company only, by default.
    expect((await listSupplierOrders(a, "confirmed")).items.map((o) => o.id)).toEqual([oa]);
    // All brands: both of mine, not the stranger's.
    const all = await listSupplierOrders(a, "confirmed", 1, true);
    expect(all.items.map((o) => o.id).sort()).toEqual([oa, ob].sort());
    expect((await countSupplierOrders(a, true)).confirmed).toBe(2);
    expect((await countSupplierOrders(b)).confirmed).toBe(1);

    const sheet = await getPickList(a, day, true);
    expect(sheet.orders.map((o) => o.id).sort()).toEqual([oa, ob].sort());
    expect(sheet.orders.map((o) => o.supplierName).every(Boolean)).toBe(true);
    expect(sheet.groups.flatMap((g) => g.rows).map((r) => r.name).sort()).toEqual(["[TEST] Wine A", "[TEST] Wine B"]);
    expect((await getPickList(a, day)).orders.map((o) => o.id)).toEqual([oa]);
    // The brand set comes from memberships: dropping the membership drops the brand from "all".
    await getDb().delete(organizationMemberships).where(eq(organizationMemberships.organizationId, b.orgId));
    expect(await scopeOrgIds(a, true)).toEqual([a.orgId]);
    expect((await listSupplierOrders(a, "confirmed", 1, true)).items.map((o) => o.id)).toEqual([oa]);
  });

  it("asks one customer to connect with several of my brands at once, each as its own company", async () => {
    const a = await createSupplier();
    const b = await addBrand(a, "[TEST] Brand B");
    const buyer = await createBuyer();
    await sendConnectionRequest(a, buyer.orgId);
    await sendConnectionRequest(b, buyer.orgId);
    const rows = await getDb().select().from(connectionRequests).where(eq(connectionRequests.toOrgId, buyer.orgId));
    expect(rows.map((r) => r.fromOrgId).sort()).toEqual([a.orgId, b.orgId].sort());
  });
});
