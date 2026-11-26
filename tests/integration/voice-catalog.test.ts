import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { loadVoiceCatalog } from "@/server/domain/buyer/voice-catalog";
import { connectBuyer, createAdmin, createBuyer, createSupplier, createTestCategory, createTestProduct } from "./helpers";

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

describe("voice catalogue for a buyer", () => {
  it("holds only this buyer's orderable products, under short ids, with no prices and no real ids", async () => {
    const supplier = await createSupplier();
    const stranger = await createSupplier();
    const buyer = await createBuyer();
    await connectBuyer(supplier, buyer);
    const mine = await createTestProduct(supplier, categoryId, { name: "[TEST] Voice cheese", basePrice: "12" });
    const hidden = await createTestProduct(supplier, categoryId, { name: "[TEST] Voice hidden", basePrice: "5" });
    await getDb().update(products).set({ isActive: false }).where(eq(products.id, hidden));
    await createTestProduct(stranger, categoryId, { name: "[TEST] Voice strangers", basePrice: "1" });

    const catalog = await loadVoiceCatalog(buyer);
    const names = catalog.items.map((i) => i.name);
    expect(names).toContain("[TEST] Voice cheese");
    expect(names).not.toContain("[TEST] Voice hidden");
    expect(names).not.toContain("[TEST] Voice strangers");

    const item = catalog.items.find((i) => i.name === "[TEST] Voice cheese")!;
    expect(item.id).toMatch(/^p\d+$/);
    expect(item.supplierId).toMatch(/^s\d+$/);
    expect(catalog.refs[item.id].productId).toBe(mine);
    // Nothing the assistant could leak: no price, no uuid anywhere in what it is given.
    expect(JSON.stringify(catalog.items)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(catalog.suppliers.some((s) => s.name.startsWith("[TEST] Supplier") && s.count >= 1)).toBe(true);
  });

  it("is empty for a buyer with no connection and refused for a supplier", async () => {
    const lonely = await createBuyer();
    expect((await loadVoiceCatalog(lonely)).items).toEqual([]);
    await expect(loadVoiceCatalog(await createSupplier())).rejects.toThrow();
  });
});
