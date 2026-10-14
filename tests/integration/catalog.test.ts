import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { productSchema } from "@/lib/validation/product";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { setCategoryArchived } from "@/server/domain/catalog/categories";
import {
  createProduct,
  getSupplierProduct,
  listSupplierProducts,
  PRODUCTS_PAGE_SIZE,
  setProductActive,
  updateProduct,
} from "@/server/domain/catalog/products";
import { getSupplierSettings, updateSupplierSettings } from "@/server/domain/catalog/supplier-settings";
import type { AdminCtx, SupplierCtx } from "@/server/domain/context";
import { ConflictError, NotFoundError, StateError } from "@/server/domain/errors";
import { supplierSettingsSchema } from "@/lib/validation/supplier-settings";
import {
  createAdmin,
  createBuyer,
  createSupplier,
  createTestCategory,
  createTestProduct,
  productInput,
} from "./helpers";

let admin: AdminCtx;
let categoryId: string;

beforeAll(async () => {
  admin = await createAdmin();
  categoryId = (await createTestCategory(admin)).id;
});

describe("products", () => {
  it("creates a product with integer money/quantities and a search skeleton", async () => {
    const supplier = await createSupplier();
    const id = await createTestProduct(supplier, categoryId, {
      name: "ყველი სულგუნი",
      sku: "SUL-1",
      unit: "kg",
      basePrice: "18,50",
      vatRate: "18",
      minQty: "0,5",
      qtyStep: "0,5",
    });
    const product = await getSupplierProduct(supplier, id);
    expect(product).toMatchObject({
      supplierOrgId: supplier.orgId,
      basePriceMinor: 1850,
      vatRateBp: 1800,
      minQtyMilli: 500,
      qtyStepMilli: 500,
      isActive: true,
    });
    expect(product.searchText).toContain("kveli sulguni");
  });

  it("lets a supplier prepare its catalog while pending review", async () => {
    const pending = await createSupplier("pending_review");
    await expect(createTestProduct(pending, categoryId)).resolves.toEqual(expect.any(String));
  });

  it("finds products by Georgian, transliterated and SKU queries, only in the supplier's own catalog", async () => {
    const supplier = await createSupplier();
    const other = await createSupplier();
    await createTestProduct(supplier, categoryId, { name: "ყველი იმერული", sku: "IMR-9" });
    await createTestProduct(supplier, categoryId, { name: "წყალი ბორჯომი" });
    await createTestProduct(other, categoryId, { name: "ყველი სხვისი" });

    const names = async (q: string) =>
      (await listSupplierProducts(supplier, { q })).items.map((p) => p.name).sort();
    expect(await names("ყველი")).toEqual(["ყველი იმერული"]);
    expect(await names("kveli")).toEqual(["ყველი იმერული"]);
    expect(await names("qveli")).toEqual(["ყველი იმერული"]);
    expect(await names("wyali")).toEqual(["წყალი ბორჯომი"]);
    expect(await names("imr-9")).toEqual(["ყველი იმერული"]);
    expect(await names("100%_x")).toEqual([]);
  });

  it("paginates and filters by status", async () => {
    const supplier = await createSupplier();
    for (let i = 0; i < PRODUCTS_PAGE_SIZE + 3; i++) {
      await createTestProduct(supplier, categoryId, { name: `[TEST] P${String(i).padStart(2, "0")}` });
    }
    const page2 = await listSupplierProducts(supplier, { page: 2 });
    expect(page2).toMatchObject({ total: PRODUCTS_PAGE_SIZE + 3, page: 2, pageCount: 2 });
    expect(page2.items).toHaveLength(3);
    expect((await listSupplierProducts(supplier, { page: 99 })).page).toBe(2);

    await setProductActive(supplier, page2.items[0].id, false);
    expect((await listSupplierProducts(supplier, { status: "inactive" })).total).toBe(1);
    expect((await listSupplierProducts(supplier, { status: "active" })).total).toBe(PRODUCTS_PAGE_SIZE + 2);
  });

  it("rejects a duplicate SKU within a supplier but allows it across suppliers", async () => {
    const a = await createSupplier();
    const b = await createSupplier();
    await createTestProduct(a, categoryId, { sku: "DUP-1" });
    await expect(createTestProduct(a, categoryId, { sku: "DUP-1" })).rejects.toEqual(new ConflictError("sku_taken"));
    await expect(createTestProduct(b, categoryId, { sku: "DUP-1" })).resolves.toEqual(expect.any(String));
    // Products without a SKU never collide.
    await createTestProduct(a, categoryId);
    await createTestProduct(a, categoryId);
  });

  it("refuses archived categories for new products but keeps them on existing ones", async () => {
    const supplier = await createSupplier();
    const archived = await createTestCategory(admin);
    const id = await createTestProduct(supplier, archived.id);
    await setCategoryArchived(admin, archived.id, true);

    await expect(createTestProduct(supplier, archived.id)).rejects.toEqual(new StateError("category_unavailable"));
    await expect(
      updateProduct(supplier, id, productSchema.parse(productInput(archived.id, { name: "[TEST] Renamed" }))),
    ).resolves.toBeUndefined();
  });
});

describe("tenant isolation", () => {
  let a: SupplierCtx;
  let b: SupplierCtx;
  let productOfA: string;

  beforeAll(async () => {
    a = await createSupplier();
    b = await createSupplier();
    productOfA = await createTestProduct(a, categoryId, { name: "[TEST] A's product", basePrice: "5" });
  });

  it("supplier B cannot read, update, deactivate or list supplier A's product", async () => {
    await expect(getSupplierProduct(b, productOfA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateProduct(b, productOfA, productSchema.parse(productInput(categoryId, { basePrice: "0" }))),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(setProductActive(b, productOfA, false)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listSupplierProducts(b, {})).items.map((p) => p.id)).not.toContain(productOfA);

    const [row] = await getDb().select().from(products).where(eq(products.id, productOfA));
    expect(row).toMatchObject({ basePriceMinor: 500, isActive: true, name: "[TEST] A's product" });
  });

  it("a buyer cannot use supplier catalog functions", async () => {
    const buyer = await createBuyer();
    await expect(listSupplierProducts(buyer, {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSupplierProduct(buyer, productOfA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createProduct(buyer, productSchema.parse(productInput(categoryId))),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSupplierSettings(buyer)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("malformed IDs are just not found", async () => {
    await expect(getSupplierProduct(a, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("suspended suppliers", () => {
  it("can read their catalog but not change it", async () => {
    const supplier = await createSupplier();
    const id = await createTestProduct(supplier, categoryId);
    const suspended: SupplierCtx = { ...supplier, orgStatus: "suspended" };

    await expect(getSupplierProduct(suspended, id)).resolves.toMatchObject({ id });
    await expect(listSupplierProducts(suspended, {})).resolves.toMatchObject({ total: 1 });
    await expect(createTestProduct(suspended, categoryId)).rejects.toEqual(new StateError("suspended"));
    await expect(setProductActive(suspended, id, false)).rejects.toEqual(new StateError("suspended"));
    await expect(
      updateSupplierSettings(
        suspended,
        supplierSettingsSchema.parse({
          contactName: "x",
          phone: "599000000",
          minOrder: "",
          pricesIncludeVat: true,
        }),
      ),
    ).rejects.toEqual(new StateError("suspended"));
  });
});

describe("supplier settings", () => {
  it("saves contact and order terms; empty minimum means none", async () => {
    const supplier = await createSupplier();
    await updateSupplierSettings(
      supplier,
      supplierSettingsSchema.parse({
        contactName: "Tamar",
        phone: "+995 577 11 22 33",
        minOrder: "150,00",
        pricesIncludeVat: false,
        deliveryArea: "Tbilisi",
        deliveryTerms: "Mon–Sat",
        orderCutoffNote: "",
      }),
    );
    expect(await getSupplierSettings(supplier)).toMatchObject({
      contactName: "Tamar",
      phone: "+995577112233",
      minOrderMinor: 15000,
      pricesIncludeVat: false,
      deliveryTerms: "Mon–Sat",
      orderCutoffNote: null,
    });
    await updateSupplierSettings(
      supplier,
      supplierSettingsSchema.parse({ contactName: "Tamar", phone: "577112233", minOrder: "", pricesIncludeVat: true }),
    );
    expect((await getSupplierSettings(supplier)).minOrderMinor).toBe(0);
  });
});
