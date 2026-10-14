import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { parseMoneyInput, roundHalfUp } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { categories, priceListItems, priceLists, products, supplierCustomers, type PriceList } from "@/server/db/schema";
import { assertCatalogWritable, isUuid, searchCondition } from "@/server/domain/catalog/products";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { ConflictError, NotFoundError, StateError, isUniqueViolation } from "@/server/domain/errors";

export const priceListNameSchema = z.string().trim().min(1, "required").max(80, "too_long");
export const PRICE_LIST_PAGE_SIZE = 50;

export type PriceListError = "name_taken" | "suspended" | "invalid_discount" | "unknown_products";

export type PriceListSummary = PriceList & { customerCount: number; overrideCount: number };

export async function listPriceLists(ctx: OrgCtx): Promise<PriceListSummary[]> {
  assertSupplier(ctx);
  return getDb()
    .select({
      id: priceLists.id,
      supplierOrgId: priceLists.supplierOrgId,
      name: priceLists.name,
      isDefault: priceLists.isDefault,
      createdAt: priceLists.createdAt,
      updatedAt: priceLists.updatedAt,
      customerCount: sql<number>`(select count(*)::int from ${supplierCustomers} where ${supplierCustomers.priceListId} = ${priceLists.id})`,
      overrideCount: sql<number>`(select count(*)::int from ${priceListItems} where ${priceListItems.priceListId} = ${priceLists.id})`,
    })
    .from(priceLists)
    .where(eq(priceLists.supplierOrgId, ctx.orgId))
    .orderBy(desc(priceLists.isDefault), asc(priceLists.name));
}

export async function getPriceList(ctx: OrgCtx, priceListId: string): Promise<PriceList> {
  assertSupplier(ctx);
  if (!isUuid(priceListId)) throw new NotFoundError("price list");
  const [row] = await getDb()
    .select()
    .from(priceLists)
    .where(and(eq(priceLists.id, priceListId), eq(priceLists.supplierOrgId, ctx.orgId)));
  if (!row) throw new NotFoundError("price list");
  return row;
}

function rethrowNameTaken(error: unknown): never {
  if (isUniqueViolation(error, "price_lists_supplier_name_key")) throw new ConflictError<PriceListError>("name_taken");
  throw error;
}

export async function createPriceList(ctx: OrgCtx, rawName: string): Promise<string> {
  assertCatalogWritable(ctx);
  const name = priceListNameSchema.parse(rawName);
  try {
    const [row] = await getDb()
      .insert(priceLists)
      .values({ supplierOrgId: ctx.orgId, name })
      .returning({ id: priceLists.id });
    return row.id;
  } catch (error) {
    rethrowNameTaken(error);
  }
}

export async function renamePriceList(ctx: OrgCtx, priceListId: string, rawName: string): Promise<void> {
  assertCatalogWritable(ctx);
  const name = priceListNameSchema.parse(rawName);
  await getPriceList(ctx, priceListId);
  try {
    await getDb()
      .update(priceLists)
      .set({ name })
      .where(and(eq(priceLists.id, priceListId), eq(priceLists.supplierOrgId, ctx.orgId)));
  } catch (error) {
    rethrowNameTaken(error);
  }
}

/** Makes this list the one pre-selected for new customers (or clears it with null). */
export async function setDefaultPriceList(ctx: OrgCtx, priceListId: string | null): Promise<void> {
  assertCatalogWritable(ctx);
  if (priceListId) await getPriceList(ctx, priceListId);
  await getDb().transaction(async (tx) => {
    await tx
      .update(priceLists)
      .set({ isDefault: false })
      .where(and(eq(priceLists.supplierOrgId, ctx.orgId), eq(priceLists.isDefault, true)));
    if (priceListId) {
      await tx
        .update(priceLists)
        .set({ isDefault: true })
        .where(and(eq(priceLists.id, priceListId), eq(priceLists.supplierOrgId, ctx.orgId)));
    }
  });
}

/** Deletes a list. Customers on it fall back to base prices; its overrides go with it. */
export async function deletePriceList(ctx: OrgCtx, priceListId: string): Promise<void> {
  assertCatalogWritable(ctx);
  await getPriceList(ctx, priceListId);
  await getDb().transaction(async (tx) => {
    await tx
      .update(supplierCustomers)
      .set({ priceListId: null })
      .where(and(eq(supplierCustomers.supplierOrgId, ctx.orgId), eq(supplierCustomers.priceListId, priceListId)));
    await tx.delete(priceLists).where(and(eq(priceLists.id, priceListId), eq(priceLists.supplierOrgId, ctx.orgId)));
  });
}

export type PriceListProductRow = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  categoryName: string;
  isActive: boolean;
  basePriceMinor: number;
  overrideMinor: number | null;
};

export async function listPriceListProducts(
  ctx: OrgCtx,
  priceListId: string,
  filters: { q?: string; page?: number },
): Promise<{ items: PriceListProductRow[]; total: number; page: number; pageCount: number }> {
  await getPriceList(ctx, priceListId);
  const where = and(eq(products.supplierOrgId, ctx.orgId), filters.q ? searchCondition(filters.q) : undefined);
  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(products).where(where);
  const pageCount = Math.max(1, Math.ceil(total / PRICE_LIST_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);
  const items = await db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      categoryName: categories.name,
      isActive: products.isActive,
      basePriceMinor: products.basePriceMinor,
      overrideMinor: priceListItems.priceMinor,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(
      priceListItems,
      and(eq(priceListItems.productId, products.id), eq(priceListItems.priceListId, priceListId)),
    )
    .where(where)
    .orderBy(desc(products.isActive), asc(products.name), asc(products.id))
    .limit(PRICE_LIST_PAGE_SIZE)
    .offset((page - 1) * PRICE_LIST_PAGE_SIZE);
  return { items, total, page, pageCount };
}

export type OverrideChange = { productId: string; priceMinor: number | null };

/** Sets (or, with null, removes) overrides. All products must be the supplier's own. */
export async function setPriceOverrides(ctx: OrgCtx, priceListId: string, changes: OverrideChange[]): Promise<void> {
  assertCatalogWritable(ctx);
  await getPriceList(ctx, priceListId);
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.productId))];
  if (!ids.every(isUuid)) throw new StateError<PriceListError>("unknown_products");

  await getDb().transaction(async (tx) => {
    const owned = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.supplierOrgId, ctx.orgId), inArray(products.id, ids)));
    if (owned.length !== ids.length) throw new StateError<PriceListError>("unknown_products");

    const removals = changes.filter((c) => c.priceMinor === null).map((c) => c.productId);
    if (removals.length) {
      await tx
        .delete(priceListItems)
        .where(and(eq(priceListItems.priceListId, priceListId), inArray(priceListItems.productId, removals)));
    }
    const upserts = changes.filter((c): c is { productId: string; priceMinor: number } => c.priceMinor !== null);
    if (upserts.length) {
      await tx
        .insert(priceListItems)
        .values(upserts.map((c) => ({ priceListId, productId: c.productId, supplierOrgId: ctx.orgId, priceMinor: c.priceMinor })))
        .onConflictDoUpdate({
          target: [priceListItems.priceListId, priceListItems.productId],
          set: { priceMinor: sql`excluded.price_minor`, updatedAt: new Date() },
        });
    }
  });
}

/** Discount in basis points (12.5% = 1250) → base × (1 − d), rounded half up. */
export function discountedPrice(basePriceMinor: number, discountBp: number): number {
  return Number(roundHalfUp(BigInt(basePriceMinor) * BigInt(10_000 - discountBp), 10_000n));
}

/** "12,5" → 1250. Discounts between 0 and 100% with up to two decimals. */
export function parseDiscountPercent(input: string): number | null {
  const minor = parseMoneyInput(input.replace(/%$/, ""));
  if (minor === null || minor > 10_000) return null;
  return minor; // "percent with 2 decimals" has the same shape as an amount in minor units
}

export type BulkPreview = {
  count: number;
  sample: { name: string; basePriceMinor: number; newPriceMinor: number }[];
};

export async function previewBulkDiscount(ctx: OrgCtx, priceListId: string, discountBp: number): Promise<BulkPreview> {
  assertCatalogWritable(ctx);
  await getPriceList(ctx, priceListId);
  if (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 10_000) {
    throw new StateError<PriceListError>("invalid_discount");
  }
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(products).where(eq(products.supplierOrgId, ctx.orgId));
  const sample = await db
    .select({ name: products.name, basePriceMinor: products.basePriceMinor })
    .from(products)
    .where(eq(products.supplierOrgId, ctx.orgId))
    .orderBy(desc(products.isActive), asc(products.name))
    .limit(8);
  return {
    count: n,
    sample: sample.map((p) => ({ ...p, newPriceMinor: discountedPrice(p.basePriceMinor, discountBp) })),
  };
}

/** Sets every product's override in this list to base − discount. Replaces existing overrides. */
export async function applyBulkDiscount(ctx: OrgCtx, priceListId: string, discountBp: number): Promise<number> {
  assertCatalogWritable(ctx);
  await getPriceList(ctx, priceListId);
  if (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 10_000) {
    throw new StateError<PriceListError>("invalid_discount");
  }
  // Same result as discountedPrice(): Postgres round(numeric) rounds halves
  // away from zero, i.e. up for these non-negative amounts.
  const rows = await getDb().execute<{ product_id: string }>(sql`
    insert into ${priceListItems} (price_list_id, product_id, supplier_org_id, price_minor)
    select ${priceListId}, ${products.id}, ${products.supplierOrgId},
           round(${products.basePriceMinor}::numeric * (10000 - ${discountBp}::int) / 10000)::bigint
    from ${products}
    where ${products.supplierOrgId} = ${ctx.orgId}
    on conflict (price_list_id, product_id)
      do update set price_minor = excluded.price_minor, updated_at = now()
    returning product_id
  `);
  return rows.length;
}

/** Counts of customers per list, used to warn before deleting. */
export async function customersOnPriceList(ctx: OrgCtx, priceListId: string): Promise<number> {
  await getPriceList(ctx, priceListId);
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.priceListId, priceListId), isNotNull(supplierCustomers.priceListId)));
  return n;
}
