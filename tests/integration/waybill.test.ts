import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { addresses, organizations } from "@/server/db/schema";
import type { OrgCtx, SupplierCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { getCart, setCartQuantity } from "@/server/domain/orders/cart";
import { getOrder } from "@/server/domain/orders/queries";
import { submitOrder } from "@/server/domain/orders/submit";
import { confirmOrder } from "@/server/domain/orders/transitions";
import { getWaybillSheet } from "@/server/domain/orders/waybill";
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

describe("waybill sheet (phase 1)", () => {
  it("prepares the confirmed lines with both identification codes, for the seller only", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const stranger = await createSupplier();
    await connectBuyer(supplier, buyer);
    const wine = await createTestProduct(supplier, categoryId, { name: "[TEST] Wine", basePrice: "20" });
    const water = await createTestProduct(supplier, categoryId, { name: "[TEST] Water", basePrice: "2" });
    const day = addDays(todayIn("Asia/Tbilisi"), 2);
    const orderId = await placeOrder(buyer, supplier, [[wine, 3000], [water, 5000]]);

    // Still pending: nothing to prepare yet.
    await expect(getWaybillSheet(supplier, orderId)).rejects.toBeInstanceOf(NotFoundError);

    const items = (await getOrder(supplier, orderId)).items;
    const waterItem = items.find((i) => i.name === "[TEST] Water")!;
    const wineItem = items.find((i) => i.name === "[TEST] Wine")!;
    // Wine is confirmed at 2.5; the water is "unavailable" (0).
    await confirmOrder(supplier, orderId, [{ itemId: wineItem.id, confirmedQtyMilli: 2500 }, { itemId: waterItem.id, confirmedQtyMilli: 0 }], undefined, day);

    const sheet = await getWaybillSheet(supplier, orderId);
    expect(sheet.lines).toHaveLength(1);
    expect(sheet.lines[0]).toMatchObject({ lineNo: 1, name: "[TEST] Wine", qtyMilli: 2500, unitPriceMinor: 2000, lineTotalMinor: 5000 });
    expect(sheet.deliveryDate).toBe(day);
    const [sellerOrg] = await getDb().select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, supplier.orgId));
    const [buyerOrg] = await getDb().select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, buyer.orgId));
    expect(sheet.seller.legalId).toBe(sellerOrg.legalId);
    expect(sheet.buyer.legalId).toBe(buyerOrg.legalId);
    expect(sheet.totalMinor).toBe(sheet.pricesIncludeVat ? 5000 : 5000 + sheet.vatMinor);

    // Only the seller, and only the right shape of id.
    await expect(getWaybillSheet(buyer, orderId)).rejects.toThrow();
    await expect(getWaybillSheet(stranger, orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getWaybillSheet(supplier, "not-an-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});
