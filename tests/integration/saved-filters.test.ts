import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { savedFilters } from "@/server/db/schema";
import { NotFoundError, StateError, ConflictError } from "@/server/domain/errors";
import { createSavedFilter, deleteSavedFilter, listSavedFilters } from "@/server/domain/filters/saved-filters";
import { createAdmin, createBuyer, createSupplier, createTestCategory } from "./helpers";

let categoryId: string;
beforeAll(async () => {
  categoryId = (await createTestCategory(await createAdmin())).id;
});

describe("saved filter views", () => {
  it("saves, lists and removes views for this user and company only", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    const id = await createSavedFilter(supplier, "products", "  Low   stock ", `stock=low&category=${categoryId}&page=4&junk=1`);
    const mine = await listSavedFilters(supplier, "products");
    expect(mine).toEqual([{ id, name: "Low stock", query: `category=${categoryId}&stock=low` }]);
    expect(await listSavedFilters(other, "products")).toEqual([]);
    // Another person in the same company has their own views.
    expect(await listSavedFilters({ ...supplier, userId: other.userId }, "products")).toEqual([]);

    await expect(deleteSavedFilter(other, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteSavedFilter(supplier, "nope")).rejects.toBeInstanceOf(NotFoundError);
    await deleteSavedFilter(supplier, id);
    expect(await listSavedFilters(supplier, "products")).toEqual([]);
  });

  it("refuses empty names, empty filters, duplicates and more than 20 views", async () => {
    const supplier = await createSupplier();
    await expect(createSavedFilter(supplier, "products", "   ", "status=active")).rejects.toEqual(new StateError("name_required"));
    await expect(createSavedFilter(supplier, "products", "Nothing", "page=2")).rejects.toEqual(new StateError("nothing_to_save"));
    await createSavedFilter(supplier, "products", "Active", "status=active");
    await expect(createSavedFilter(supplier, "products", "Active", "status=inactive")).rejects.toEqual(new ConflictError("name_taken"));
    for (let i = 1; i < 20; i++) await createSavedFilter(supplier, "products", `View ${i}`, `q=item${i}`);
    await expect(createSavedFilter(supplier, "products", "One too many", "q=extra")).rejects.toEqual(new StateError("too_many"));
    expect(await getDb().select().from(savedFilters).where(eq(savedFilters.organizationId, supplier.orgId))).toHaveLength(20);
  });

  it("is for suppliers only", async () => {
    const buyer = await createBuyer();
    await expect(listSavedFilters(buyer, "products")).rejects.toBeInstanceOf(NotFoundError);
    await expect(createSavedFilter(buyer, "products", "x", "q=a")).rejects.toBeInstanceOf(NotFoundError);
  });
});
