import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { guessMapping, type RawSheet } from "@/lib/catalog/import";
import { getDb } from "@/server/db/client";
import { products, supplierSettings } from "@/server/db/schema";
import { analyzeImport, commitImport } from "@/server/domain/catalog/import";
import { createMissingCategories } from "@/server/domain/catalog/categories";
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
    expect(analysis.rows).toMatchObject([
      { rowNumber: 2, action: "create", name: "New one", sku: "NEW-1", category: category.name, categorySource: "file", skuGenerated: false },
      { rowNumber: 3, action: "update", name: "Existing renamed", sku: "EX-1", categorySource: "file", skuGenerated: false },
      { rowNumber: 4, action: "error", name: "Bad", errors: [{ field: "category", key: "unknown_category" }] },
      { rowNumber: 5, action: "error", name: "Dup", errors: [{ field: "sku", key: "duplicate_sku_in_file" }] },
    ]);
  });

  it("matches category spellings and new packaging units from the file", async () => {
    const supplier = await createSupplier();
    // A standard category (Georgian name) and its English / short spellings.
    await createMissingCategories(admin, ["სასმელები", "რძის პროდუქტები"]);
    const result = await commitImport(
      supplier,
      sheet([
        ["წყალი", "V-1", "  DRINKS ", "Btl.", "1,5"],
        ["ლუდი კასრი", "V-2", "სასმელი", "კასრი", "120"],
        ["რძე", "V-3", "Dairy", "pcs", "3"],
        ["ქერი", "V-4", "dairy", "ტომარა", "40"],
      ]),
      guessMapping(headers),
      "all",
    );
    expect(result).toMatchObject({ created: 4, updated: 0 });
    const rows = (await listSupplierProducts(supplier, {})).items;
    expect(Object.fromEntries(rows.map((p) => [p.sku, [p.unit, p.categoryName]]))).toEqual({
      "V-1": ["bottle", "სასმელები"],
      "V-2": ["keg", "სასმელები"],
      "V-3": ["piece", "რძის პროდუქტები"],
      "V-4": ["sack", "რძის პროდუქტები"],
    });
  });

  it("imports a plain name / unit / price list: guesses categories, makes stable codes, and updates on re-import", async () => {
    const supplier = await createSupplier();
    await createMissingCategories(admin, ["ყველი", "ხორცი და ფრინველი", "რძის პროდუქტები"]);
    const plain: RawSheet = {
      headers: ["დასახელება", "ერთეული", "ფასი"],
      rows: [
        ["ყველი პარმეზანი", "კგ", "30"],
        ["ქათმის უძვლო ბარკალი", "კგ", "8,50"],
        ["რძე 3,2% 1 ლ", "ცალი", "3,40 ₾"],
        ["QZ-77 უცნობი", "ცალი", "1"],
      ],
    };
    const mapping = guessMapping(plain.headers);
    const options = { guessCategory: true, autoSku: true } as const;

    const analysis = await analyzeImport(supplier, plain, mapping, options);
    expect(analysis.counts).toEqual({ create: 3, update: 0, error: 1 });
    expect(analysis.rows[0]).toMatchObject({ action: "create", category: "ყველი", categorySource: "guess", skuGenerated: true });
    expect(analysis.rows[3]).toMatchObject({ action: "error", errors: [{ field: "category", key: "category_not_guessed" }] });
    // Without the options the same file is rejected for its missing category column.
    await expect(analyzeImport(supplier, plain, mapping)).rejects.toEqual(new StateError("missing_columns"));

    expect(await commitImport(supplier, plain, mapping, "valid_only", options)).toEqual({ created: 3, updated: 0, skipped: 1 });
    // The same list again, reordered and with a new price: same codes, so everything updates.
    const again: RawSheet = { ...plain, rows: [plain.rows[2], plain.rows[0], ["ქათმის უძვლო ბარკალი", "კგ", "9"]] };
    const second = await analyzeImport(supplier, again, mapping, options);
    expect(second.counts).toEqual({ create: 0, update: 3, error: 0 });
    expect(await commitImport(supplier, again, mapping, "all", options)).toEqual({ created: 0, updated: 3, skipped: 0 });
    const items = (await listSupplierProducts(supplier, {})).items;
    expect(items).toHaveLength(3);
    expect(items.find((p) => p.name.startsWith("ქათმის"))?.basePriceMinor).toBe(900);
  });

  it("uses one chosen category for rows without one, and refuses a category that is not active", async () => {
    const supplier = await createSupplier();
    const plain: RawSheet = { headers: ["სახელი", "ერთეული", "ფასი"], rows: [["რამე", "ც", "2"]] };
    const mapping = guessMapping(plain.headers);
    const analysis = await analyzeImport(supplier, plain, mapping, { defaultCategoryId: category.id });
    expect(analysis.rows[0]).toMatchObject({ action: "create", category: category.name, categorySource: "default", skuGenerated: false });
    await expect(
      analyzeImport(supplier, plain, mapping, { defaultCategoryId: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toEqual(new StateError("invalid_options"));
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
        ["Broken", "C-9", category.name, "parsec", "1"],
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
