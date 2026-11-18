import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import type { ProductValues } from "@/lib/validation/product";
import { getDb, type Tx } from "@/server/db/client";
import { categories, orderItems, orders, products, regularOrderItems, regularOrders, type Product } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
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

export type CatalogWriteError = "suspended" | "category_unavailable" | "sku_taken" | "invalid_stock";

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
  /** Only products with a stock count of 0 or less (needs restocking). */
  lowStock?: boolean;
  page?: number;
};

export type ProductListItem = Pick<
  Product,
  | "id"
  | "stockMilli"
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
    filters.lowStock ? and(isNotNull(products.stockMilli), lte(products.stockMilli, 0)) : undefined,
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
      stockMilli: products.stockMilli,
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
    barcode: values.barcode,
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
        .values({ supplierOrgId: ctx.orgId, ...productColumns(values), stockMilli: values.stock })
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

/** What would be affected by deleting a product, so the supplier is told before confirming. */
export async function getProductUsage(ctx: OrgCtx, productId: string): Promise<{ openOrders: number; orderLines: number }> {
  assertSupplier(ctx);
  const product = await getSupplierProduct(ctx, productId);
  const rows = await getDb()
    .select({ status: orders.status, n: count() })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.productId, product.id), eq(orders.supplierOrgId, ctx.orgId)))
    .groupBy(orders.status);
  const orderLines = rows.reduce((sum, r) => sum + r.n, 0);
  const openOrders = rows.filter((r) => r.status === "pending" || r.status === "confirmed").reduce((sum, r) => sum + r.n, 0);
  return { openOrders, orderLines };
}

/** Usage counts for several of the supplier's own products at once (the product list's delete confirmation). */
export async function getProductsUsage(
  ctx: OrgCtx,
  productIds: string[],
): Promise<Map<string, { openOrders: number; orderLines: number }>> {
  assertSupplier(ctx);
  const result = new Map<string, { openOrders: number; orderLines: number }>();
  if (productIds.length === 0) return result;
  const rows = await getDb()
    .select({ productId: orderItems.productId, status: orders.status, n: count() })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(inArray(orderItems.productId, productIds), eq(orders.supplierOrgId, ctx.orgId)))
    .groupBy(orderItems.productId, orders.status);
  for (const r of rows) {
    if (!r.productId) continue;
    const cur = result.get(r.productId) ?? { openOrders: 0, orderLines: 0 };
    cur.orderLines += r.n;
    if (r.status === "pending" || r.status === "confirmed") cur.openOrders += r.n;
    result.set(r.productId, cur);
  }
  return result;
}

/**
 * Deletes a product for good (the supplier asked for it; hiding stays available). It disappears from price
 * lists, buyers' carts and saved regular orders (a regular order left with no products is removed too).
 * Orders keep their own copy of every line (name, code, unit, price, VAT, quantities), so history, open
 * orders, loading sheets and waybill data are unaffected: only the link to the product is cleared.
 */
export async function deleteProduct(ctx: OrgCtx, productId: string, storage: ImageStorage): Promise<void> {
  assertCatalogWritable(ctx);
  const product = await getSupplierProduct(ctx, productId); // another company's product: not found
  await getDb().transaction(async (tx) => {
    const deleted = await tx
      .delete(products)
      .where(and(eq(products.id, product.id), eq(products.supplierOrgId, ctx.orgId)))
      .returning({ id: products.id });
    if (deleted.length === 0) throw new NotFoundError("product");
    // Saved regular orders that lost their last product.
    const empty = await tx
      .select({ id: regularOrders.id })
      .from(regularOrders)
      .where(and(eq(regularOrders.supplierOrgId, ctx.orgId), notExists(tx.select({ one: sql`1` }).from(regularOrderItems).where(eq(regularOrderItems.regularOrderId, regularOrders.id)))));
    if (empty.length > 0) await tx.delete(regularOrders).where(inArray(regularOrders.id, empty.map((r) => r.id)));
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: "product.deleted",
      targetType: "organization",
      targetId: ctx.orgId,
      data: { name: product.name, sku: product.sku },
    });
  });
  if (product.imagePath) {
    await storage.remove(imageFilePaths(product.imagePath)).catch((error: unknown) => {
      console.error("[catalog] image removal failed", { productId: product.id, message: error instanceof Error ? error.message : String(error) });
    });
  }
}

/** Deactivate / reactivate (hide from or show to customers). */
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

export const MAX_BULK_PRODUCTS = 100;

function bulkIds(ids: string[]): string[] {
  const unique = [...new Set(ids)].filter(isUuid);
  if (unique.length === 0 || unique.length > MAX_BULK_PRODUCTS) throw new NotFoundError("product");
  return unique;
}

/** Show or hide several of the supplier's own products at once. Returns how many were changed. */
export async function bulkSetActive(ctx: OrgCtx, productIds: string[], active: boolean): Promise<number> {
  assertCatalogWritable(ctx);
  const updated = await getDb()
    .update(products)
    .set({ isActive: active })
    .where(and(inArray(products.id, bulkIds(productIds)), eq(products.supplierOrgId, ctx.orgId)))
    .returning({ id: products.id });
  return updated.length;
}

/** Move several of the supplier's own products into one category (an archived one is refused). */
export async function bulkSetCategory(ctx: OrgCtx, productIds: string[], categoryId: string): Promise<number> {
  assertCatalogWritable(ctx);
  const ids = bulkIds(productIds);
  return getDb().transaction(async (tx) => {
    await assertCategoryUsable(tx, categoryId);
    const updated = await tx
      .update(products)
      .set({ categoryId })
      .where(and(inArray(products.id, ids), eq(products.supplierOrgId, ctx.orgId)))
      .returning({ id: products.id });
    return updated.length;
  });
}

/** Delete several of the supplier's own products for good, one by one (each is audited). Returns how many went. */
export async function bulkDeleteProducts(ctx: OrgCtx, productIds: string[], storage: ImageStorage): Promise<number> {
  assertCatalogWritable(ctx);
  let deleted = 0;
  for (const id of bulkIds(productIds)) {
    try {
      await deleteProduct(ctx, id, storage);
      deleted += 1;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error; // already gone, or not this company's: skip
    }
  }
  return deleted;
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

/**
 * Hand-edits the stock count. "add": goods received, added to what is there
 * (an untracked product starts from 0). "set": a recount, the absolute number
 * replaces whatever the platform thought. Done in SQL so it cannot lose a
 * concurrent order confirmation.
 */
export async function adjustStock(
  ctx: OrgCtx,
  productId: string,
  change: { mode: "add" | "set"; qtyMilli: number },
): Promise<number> {
  assertCatalogWritable(ctx);
  if (!isUuid(productId)) throw new NotFoundError("product");
  const { mode, qtyMilli } = change;
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli < 0 || qtyMilli > 1_000_000_000 || (mode === "add" && qtyMilli === 0)) {
    throw new StateError<CatalogWriteError>("invalid_stock");
  }
  const [row] = await getDb()
    .update(products)
    .set({ stockMilli: mode === "add" ? sql`coalesce(${products.stockMilli}, 0) + ${qtyMilli}` : qtyMilli })
    .where(and(eq(products.id, productId), eq(products.supplierOrgId, ctx.orgId)))
    .returning({ stock: products.stockMilli });
  if (!row) throw new NotFoundError("product");
  return row.stock as number;
}
