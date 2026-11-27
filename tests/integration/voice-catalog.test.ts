import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { buyerVoicePhrases, products } from "@/server/db/schema";
import { loadVoiceCatalog } from "@/server/domain/buyer/voice-catalog";
import { clearVoicePhrases, recordVoicePhrases, voicePhrasesByProduct } from "@/server/domain/buyer/voice-phrases";
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

describe("what a buyer taught the assistant", () => {
  it("is remembered only for products the buyer may order, counted on reuse, and shown to that buyer alone", async () => {
    const supplier = await createSupplier();
    const buyer = await createBuyer();
    const other = await createBuyer();
    await connectBuyer(supplier, buyer);
    await connectBuyer(supplier, other);
    const product = await createTestProduct(supplier, categoryId, { name: "[TEST] Sulguni", basePrice: "12" });
    const stranger = await createTestProduct(await createSupplier(), categoryId, { name: "[TEST] Not mine", basePrice: "3" });

    const lines = [
      { productId: product, productName: "[TEST] Sulguni", phrase: "ყველი" },
      { productId: product, productName: "[TEST] Sulguni", phrase: "[TEST] Sulguni" }, // its own name: nothing to learn
      { productId: stranger, productName: "[TEST] Not mine", phrase: "უცხო" }, // not orderable by this buyer
    ];
    expect(await recordVoicePhrases(buyer, lines)).toBe(1);
    await recordVoicePhrases(buyer, [lines[0]]);

    const mine = await voicePhrasesByProduct(buyer, [product, stranger]);
    expect(mine.get(product)).toEqual(["ყველი"]);
    expect(mine.has(stranger)).toBe(false);
    expect((await voicePhrasesByProduct(other, [product])).size).toBe(0);

    const [row] = await getDb().select().from(buyerVoicePhrases).where(eq(buyerVoicePhrases.buyerOrgId, buyer.orgId));
    expect(row.uses).toBe(2);

    const catalog = await loadVoiceCatalog(buyer);
    expect(catalog.items.find((i) => i.name === "[TEST] Sulguni")?.aliases).toEqual(["ყველი"]);
    const theirs = await loadVoiceCatalog(other);
    expect(theirs.items.find((i) => i.name === "[TEST] Sulguni")?.aliases).toBeUndefined();

    await clearVoicePhrases(buyer);
    expect((await voicePhrasesByProduct(buyer, [product])).size).toBe(0);
  });
});
