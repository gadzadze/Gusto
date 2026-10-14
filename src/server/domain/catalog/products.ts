import "server-only";
import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { ProductValues } from "@/lib/validation/product";
import { getDb, type Tx } from "@/server/db/client";
import { categories, products, type Product } from "@/server/db/schema";
import { assertSupplier, type OrgCtx, type SupplierCtx } from "@/server/domain/context";
import { ConflictError, NotFoundError, StateError, isUniqueViolation } from "@/server/domain/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { buildSearchText, escapeLike, searchSkeleton } from "@/server/domain/search/translit";
import {
  imageFilePaths,
  newImagePathPrefix,
  processProductImage,
} from "@/server/storage/images";
import type { ImageStorage } from "@/server/storage/image-storage";

export const PRODUCTS_PAGE_SIZE = 25;

export type CatalogWriteError = "suspended" | "category_unavailable" | "sku_taken";

/** Suppliers may edit while pending review (to prepare the catalog), not while suspended. */
export function assertCatalogWritable(ctx: OrgCtx): asserts ctx is SupplierCtx {
  assertSupplier(ctx);
  if (ctx.orgStatus === "suspended") throw new StateError<CatalogWriteError>("suspended");
}

export function productSearchText(v: Pick<ProductValues, "name" | "brand" | "sku">): string {
  return buildSearchText([v.name, v.brand, v.sku]);
}

/** Matches a free-text query against `search_text`, as typed and as a skeleton. */
export function searchCondition(query: string): SQL | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const skeleton = searchSkeleton(q);
  const conditions = [ilike(products.searchText, `%${escapeLike(q)}%`)];
  if (skeleton && skeleton !== q) conditions.push(ilike(products.searchText, `%${escapeLike(skeleton)}%`));
  return or(...conditions);
}

export type ProductListFilters = {
  q?: string;
  categoryId?: string;
  status?: "all" | "active" | "inactive";
  page?: number;
};

export type ProductListItem = Pick<
  Product,
  | "id"
  | "name"
  | "sku"
  | "brand"
  | "unit"
  | "packDescription"
  | "imagePath"
  | "basePriceMinor"
  | "vatRateBp"
  | "isActive"
  | "updatedAt"
> & { categoryName: string };

export async function listSupplierProducts(
  ctx: OrgCtx,
  filters: ProductListFilters,
): Promise<{ items: ProductListItem[]; total: number; page: number; pageCount: number }> {
  assertSupplier(ctx);
  const where = and(
    eq(products.supplierOrgId, ctx.orgId),
    filters.categoryId ? eq(products.categoryId, filters.categoryId) : undefined,
    filters.status === "active" ? eq(products.isActive, true) : undefined,
    filters.status === "inactive" ? eq(products.isActive, false) : undefined,
    filters.q ? searchCondition(filters.q) : undefined,
  );

  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(products).where(where);
  const pageCount = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);

  const items = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      brand: products.brand,
      unit: products.unit,
      packDescription: products.packDescription,
      imagePath: products.imagePath,
      basePriceMinor: products.basePriceMinor,
      vatRateBp: products.vatRateBp,
      isActive: products.isActive,
      updatedAt: products.updatedAt,
      categoryName: categories.name,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(desc(products.isActive), asc(products.name), asc(products.id))
    .limit(PRODUCTS_PAGE_SIZE)
    .offset((page - 1) * PRODUCTS_PAGE_SIZE);

  return { items, total, page, pageCount };
}

/** One of the supplier's own products, or NotFoundError (also for other suppliers' IDs). */
export async function getSupplierProduct(ctx: OrgCtx, productId: string): Promise<Product> {
  assertSupplier(ctx);
  if (!isUuid(productId)) throw new NotFoundError("product");
  const [row] = await getDb()
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)));
  if (!row) throw new NotFoundError("product");
  return row;
}

async function assertCategoryUsable(tx: Tx, categoryId: string, currentCategoryId?: string) {
  // Keeping an archived category on an existing product is fine; choosing one isn't.
  if (categoryId === currentCategoryId) return;
  const [category] = await tx
    .select({ isArchived: categories.isArchived })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!category || category.isArchived) throw new StateError<CatalogWriteError>("category_unavailable");
}

function productColumns(values: ProductValues) {
  return {
    name: values.name,
    description: values.description,
    brand: values.brand,
    sku: values.sku,
    categoryId: values.categoryId,
    unit: values.unit,
    packDescription: values.packDescription,
    basePriceMinor: values.basePrice,
    vatRateBp: values.vatRate,
    minQtyMilli: values.minQty,
    qtyStepMilli: values.qtyStep,
    searchText: productSearchText(values),
  };
}

function rethrowSkuConflict(error: unknown): never {
  if (isUniqueViolation(error, "products_supplier_sku_key")) {
    throw new ConflictError<CatalogWriteError>("sku_taken");
  }
  throw error;
}

export async function createProduct(ctx: OrgCtx, values: ProductValues): Promise<string> {
  assertCatalogWritable(ctx);
  try {
    return await getDb().transaction(async (tx) => {
      await assertCategoryUsable(tx, values.categoryId);
      const [row] = await tx
        .insert(products)
        .values({ supplierOrgId: ctx.orgId, ...productColumns(values) })
        .returning({ id: products.id });
      return row.id;
    });
  } catch (error) {
    rethrowSkuConflict(error);
  }
}

export async function updateProduct(ctx: OrgCtx, productId: string, values: ProductValues): Promise<void> {
  assertCatalogWritable(ctx);
  if (!isUuid(productId)) throw new NotFoundError("product");
  try {
    await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)))
        .for("update");
      if (!current) throw new NotFoundError("product");
      await assertCategoryUsable(tx, values.categoryId, current.categoryId);
      await tx
        .update(products)
        .set(productColumns(values))
        .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)));
    });
  } catch (error) {
    rethrowSkuConflict(error);
  }
}

/** Deactivate / reactivate. Products are never hard-deleted (orders will reference them). */
export async function setProductActive(ctx: OrgCtx, productId: string, active: boolean): Promise<void> {
  assertCatalogWritable(ctx);
  if (!isUuid(productId)) throw new NotFoundError("product");
  const updated = await getDb()
    .update(products)
    .set({ isActive: active })
    .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)))
    .returning({ id: products.id });
  if (updated.length === 0) throw new NotFoundError("product");
}

/**
 * Validates and re-encodes an uploaded image, stores it, and points the
 * product at it. The previous image is removed afterwards (best effort: a
 * leftover file is harmless, a missing current one is not).
 */
export async function setProductImage(
  ctx: OrgCtx,
  productId: string,
  upload: Uint8Array,
  storage: ImageStorage,
): Promise<string> {
  assertCatalogWritable(ctx);
  await consumeRateLimit(RATE_LIMITS.imageUpload, ctx.orgId);
  const product = await getSupplierProduct(ctx, productId);
  const variants = await processProductImage(upload);

  const prefix = newImagePathPrefix(ctx.orgId, product.id);
  const paths = imageFilePaths(prefix);
  await Promise.all(variants.map((v, i) => storage.put(paths[i], v.body, "image/webp")));

  const updated = await getDb()
    .update(products)
    .set({ imagePath: prefix })
    .where(and(eq(products.id, product.id), eq(products.supplierOrgId, ctx.orgId)))
    .returning({ id: products.id });
  if (updated.length === 0) {
    await storage.remove(paths).catch(() => {});
    throw new NotFoundError("product");
  }

  if (product.imagePath) {
    await storage.remove(imageFilePaths(product.imagePath)).catch((error: unknown) => {
      console.error("[catalog] old image cleanup failed", {
        productId: product.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return prefix;
}

export async function removeProductImage(ctx: OrgCtx, productId: string, storage: ImageStorage): Promise<void> {
  assertCatalogWritable(ctx);
  const product = await getSupplierProduct(ctx, productId);
  if (!product.imagePath) return;
  await getDb()
    .update(products)
    .set({ imagePath: null })
    .where(and(eq(products.id, product.id), eq(products.supplierOrgId, ctx.orgId)));
  await storage.remove(imageFilePaths(product.imagePath)).catch((error: unknown) => {
    console.error("[catalog] image removal failed", {
      productId: product.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
