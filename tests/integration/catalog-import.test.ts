import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { guessMapping, type RawSheet } from "@/lib/catalog/import";
import { getDb } from "@/server/db/client";
import { products, supplierSettings } from "@/server/db/schema";
import { analyzeImport, commitImport } from "@/server/domain/catalog/import";
import { listSupplierProducts } from "@/server/domain/catalog/products";
import type { AdminCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { createAdmin, createSupplier, createTestCategory, createTestProduct } from "./helpers";

const headers = ["სახელი", "SKU", "კატეგორია", "ერთეული", "ფასი"];
let admin: AdminCtx;
let category: { id: string; name: string };

beforeAll(async () => {
  admin = await createAdmin();
  category = await createTestCategory(admin);
});

const sheet = (rows: string[][]): RawSheet => ({ headers, rows });

describe("catalog import", () => {
  it("analyzes rows: create, update by SKU, and per-row errors", async () => {
    const supplier = await createSupplier();
    await createTestProduct(supplier, category.id, { sku: "EX-1", name: "[TEST] Existing" });
    const analysis = await analyzeImport(
      supplier,
      sheet([
        ["New one", "NEW-1", category.name, "ც", "10"],
        ["Existing renamed", "EX-1", category.name, "კგ", "12,50"],
        ["Bad", "BAD-1", "No such category", "ც", "1"],
        ["Dup", "NEW-1", category.name, "ც", "1"],
      ]),
      guessMapping(headers),
    );
    expect(analysis.counts).toEqual({ create: 1, update: 1, error: 2 });
    expect(analysis.rows).toEqual([
      { rowNumber: 2, action: "create", name: "New one", sku: "NEW-1" },
      { rowNumber: 3, action: "update", name: "Existing renamed", sku: "EX-1" },
      { rowNumber: 4, action: "error", name: "Bad", errors: [{ field: "category", key: "unknown_category" }] },
      { rowNumber: 5, action: "error", name: "Dup", errors: [{ field: "sku", key: "duplicate_sku_in_file" }] },
    ]);
  });

  it("commits nothing in 'all' mode when any row is invalid", async () => {
    const supplier = await createSupplier();
    await expect(
      commitImport(
        supplier,
        sheet([
          ["Good", "G-1", category.name, "ც", "10"],
          ["Bad price", "G-2", category.name, "ც", "free"],
        ]),
        guessMapping(headers),
        "all",
      ),
    ).rejects.toEqual(new StateError("has_errors"));
    expect((await listSupplierProducts(supplier, {})).total).toBe(0);
  });

  it("imports only valid rows when asked, updates by SKU and remembers the mapping", async () => {
    const supplier = await createSupplier();
    const existingId = await createTestProduct(supplier, category.id, { sku: "EX-2", basePrice: "1" });
    const mapping = guessMapping(headers);

    const result = await commitImport(
      supplier,
      sheet([
        ["ყველი", "C-1", category.name, "კგ", "18,50"],
        ["No SKU item", "", category.name, "ბოთლი", "3"],
        ["Updated", "EX-2", category.name, "ც", "2,25"],
        ["Broken", "C-9", category.name, "barrel", "1"],
      ]),
      mapping,
      "valid_only",
    );
    expect(result).toEqual({ created: 2, updated: 1, skipped: 1 });

    const [updated] = await getDb().select().from(products).where(eq(products.id, existingId));
    expect(updated).toMatchObject({ name: "Updated", basePriceMinor: 225, unit: "piece" });
    const kveli = await listSupplierProducts(supplier, { q: "kveli" });
    expect(kveli.items.map((p) => p.name)).toEqual(["ყველი"]);

    const [settings] = await getDb()
      .select({ mapping: supplierSettings.importMapping })
      .from(supplierSettings)
      .where(eq(supplierSettings.organizationId, supplier.orgId));
    expect(settings.mapping).toMatchObject({ name: "სახელი", price: "ფასი" });
  });

  it("never touches another supplier's products, even with the same SKU", async () => {
    const a = await createSupplier();
    const b = await createSupplier();
    const ofA = await createTestProduct(a, category.id, { sku: "SHARED", basePrice: "1" });
    const result = await commitImport(b, sheet([["B's", "SHARED", category.name, "ც", "99"]]), guessMapping(headers), "all");
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0 });
    const [row] = await getDb().select().from(products).where(eq(products.id, ofA));
    expect(row.basePriceMinor).toBe(100);
  });

  it("requires the mandatory columns to be mapped", async () => {
    const supplier = await createSupplier();
    await expect(
      analyzeImport(supplier, sheet([["x", "", category.name, "ც", "1"]]), { name: "სახელი" }),
    ).rejects.toEqual(new StateError("missing_columns"));
  });
});
