import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { auditLogs, categories, organizations, products } from "@/server/db/schema";
import { bulkDeleteProducts, bulkSetActive, bulkSetCategory, getSupplierProduct } from "@/server/domain/catalog/products";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { createAdmin, createSupplier, createTestCategory, createTestProduct, memoryStorage } from "./helpers";

let categoryId: string;
let otherCategoryId: string;
beforeAll(async () => {
  const admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
  otherCategoryId = (await createTestCategory(admin)).id;
});

describe("bulk product actions", () => {
  it("shows, hides and moves only this company's products", async () => {
    const supplier = await createSupplier();
    const stranger = await createSupplier();
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] A" });
    const b = await createTestProduct(supplier, categoryId, { name: "[TEST] B" });
    const theirs = await createTestProduct(stranger, categoryId, { name: "[TEST] Theirs" });

    expect(await bulkSetActive(supplier, [a, b, theirs], false)).toBe(2);
    expect((await getSupplierProduct(supplier, a)).isActive).toBe(false);
    expect((await getSupplierProduct(stranger, theirs)).isActive).toBe(true);
    expect(await bulkSetActive(supplier, [a, b], true)).toBe(2);
    expect((await getSupplierProduct(supplier, b)).isActive).toBe(true);

    expect(await bulkSetCategory(supplier, [a, b, theirs], otherCategoryId)).toBe(2);
    expect((await getSupplierProduct(supplier, a)).categoryId).toBe(otherCategoryId);
    expect((await getSupplierProduct(stranger, theirs)).categoryId).toBe(categoryId);

    await getDb().update(categories).set({ isArchived: true }).where(eq(categories.id, otherCategoryId));
    await expect(bulkSetCategory(supplier, [a], otherCategoryId)).rejects.toEqual(new StateError("category_unavailable"));
    await getDb().update(categories).set({ isArchived: false }).where(eq(categories.id, otherCategoryId));
  });

  it("deletes the selected products, skipping ones that are gone or not theirs", async () => {
    const supplier = await createSupplier();
    const stranger = await createSupplier();
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] A" });
    const b = await createTestProduct(supplier, categoryId, { name: "[TEST] B" });
    const keep = await createTestProduct(supplier, categoryId, { name: "[TEST] Keep" });
    const theirs = await createTestProduct(stranger, categoryId, { name: "[TEST] Theirs" });

    expect(await bulkDeleteProducts(supplier, [a, b, theirs], memoryStorage())).toBe(2);
    await expect(getSupplierProduct(supplier, a)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getSupplierProduct(supplier, keep)).id).toBe(keep);
    expect((await getSupplierProduct(stranger, theirs)).id).toBe(theirs);
    expect(await getDb().select({ id: products.id }).from(products).where(eq(products.id, theirs))).toHaveLength(1);
  });

  it("refuses empty or oversized selections and a suspended company", async () => {
    const supplier = await createSupplier();
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] A" });
    await expect(bulkSetActive(supplier, [], true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bulkSetActive(supplier, Array.from({ length: 101 }, () => a), true)).resolves.toBe(1); // duplicates collapse
    await expect(bulkSetActive(supplier, ["not-a-uuid"], true)).rejects.toBeInstanceOf(NotFoundError);

    await getDb().update(organizations).set({ status: "suspended" }).where(eq(organizations.id, supplier.orgId));
    const suspended = { ...supplier, orgStatus: "suspended" as const };
    await expect(bulkSetActive(suspended, [a], false)).rejects.toEqual(new StateError("suspended"));
    await expect(bulkSetCategory(suspended, [a], categoryId)).rejects.toEqual(new StateError("suspended"));
    await expect(bulkDeleteProducts(suspended, [a], memoryStorage())).rejects.toEqual(new StateError("suspended"));
    expect((await getSupplierProduct(supplier, a)).isActive).toBe(true);
  });

  it("audits bulk show, hide and category moves and limits how often they run", async () => {
    const supplier = await createSupplier();
    const a = await createTestProduct(supplier, categoryId, { name: "[TEST] A" });
    await bulkSetActive(supplier, [a], false);
    await bulkSetCategory(supplier, [a], otherCategoryId);
    const rows = await getDb().select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.targetId, supplier.orgId));
    expect(rows.map((r) => r.action).filter((x) => x.startsWith("product.")).sort()).toEqual(["product.bulk_category", "product.bulk_hidden"]);

    for (let i = 0; i < 18; i += 1) await bulkSetActive(supplier, [a], true); // 20 calls so far, the limit is 20
    await expect(bulkSetActive(supplier, [a], true)).rejects.toEqual(new StateError("rate_limited"));
  });
});
