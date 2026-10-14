import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  cartItems,
  carts,
  categories,
  orderItems,
  orders,
  organizations,
  products,
  supplierCustomers,
  supplierSettings,
  type Product,
} from "@/server/db/schema";
import { isUuid, searchCondition } from "@/server/domain/catalog/products";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { effectivePriceSql } from "@/server/domain/pricing/resolve";

// What a buyer can see: only suppliers they are actively connected to, only
// while that supplier is approved (active), only active products, at the
// buyer's own prices. Anything else is "not found".

export const BUYER_CATALOG_PAGE_SIZE = 24;
export const SEARCH_MAX_RESULTS = 50;
export const SEARCH_PER_SUPPLIER = 8;

function assertBuyer(ctx: OrgCtx) {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
}

/** Join condition: an active connection between this buyer and an active supplier. */
function visibleSupplierCondition(buyerOrgId: string): SQL {
  return and(
    eq(supplierCustomers.buyerOrgId, buyerOrgId),
    eq(supplierCustomers.status, "active"),
    eq(organizations.status, "active"),
  ) as SQL;
}

export type ConnectedSupplier = {
  id: string;
  name: string;
  city: string;
  phone: string;
  currency: string;
  minOrderMinor: number;
  pricesIncludeVat: boolean;
  deliveryArea: string | null;
  deliveryTerms: string | null;
  orderCutoffNote: string | null;
  productCount: number;
};

const supplierColumns = {
  id: organizations.id,
  name: organizations.name,
  city: organizations.city,
  phone: organizations.phone,
  currency: organizations.currency,
  minOrderMinor: supplierSettings.minOrderMinor,
  pricesIncludeVat: supplierSettings.pricesIncludeVat,
  deliveryArea: supplierSettings.deliveryArea,
  deliveryTerms: supplierSettings.deliveryTerms,
  orderCutoffNote: supplierSettings.orderCutoffNote,
  productCount: sql<number>`(select count(*)::int from ${products}
    where ${products.supplierOrgId} = ${organizations.id} and ${products.isActive})`,
};

export async function listConnectedSuppliers(ctx: OrgCtx): Promise<ConnectedSupplier[]> {
  assertBuyer(ctx);
  return getDb()
    .select(supplierColumns)
    .from(supplierCustomers)
    .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
    .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
    .where(visibleSupplierCondition(ctx.orgId))
    .orderBy(asc(organizations.name));
}

export async function getConnectedSupplier(ctx: OrgCtx, supplierOrgId: string): Promise<ConnectedSupplier> {
  assertBuyer(ctx);
  if (!isUuid(supplierOrgId)) throw new NotFoundError("supplier");
  const [row] = await getDb()
    .select(supplierColumns)
    .from(supplierCustomers)
    .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
    .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
    .where(and(visibleSupplierCondition(ctx.orgId), eq(supplierCustomers.supplierOrgId, supplierOrgId)));
  if (!row) throw new NotFoundError("supplier");
  return row;
}

export type BuyerProduct = Pick<
  Product,
  "id" | "name" | "description" | "brand" | "sku" | "unit" | "packDescription" | "imagePath" | "minQtyMilli" | "qtyStepMilli" | "vatRateBp"
> & { categoryId: string; categoryName: string; priceMinor: number };

function buyerProductColumns(buyerOrgId: string) {
  return {
    id: products.id,
    name: products.name,
    description: products.description,
    brand: products.brand,
    sku: products.sku,
    unit: products.unit,
    packDescription: products.packDescription,
    imagePath: products.imagePath,
    minQtyMilli: products.minQtyMilli,
    qtyStepMilli: products.qtyStepMilli,
    vatRateBp: products.vatRateBp,
    categoryId: products.categoryId,
    categoryName: categories.name,
    priceMinor: effectivePriceSql(buyerOrgId),
  };
}

export async function listBuyerCatalog(
  ctx: OrgCtx,
  supplierOrgId: string,
  filters: { q?: string; categoryId?: string; page?: number },
): Promise<{
  items: BuyerProduct[];
  total: number;
  page: number;
  pageCount: number;
  categories: { id: string; name: string }[];
}> {
  // Throws NotFoundError unless the connection is active and the supplier approved.
  await getConnectedSupplier(ctx, supplierOrgId);
  const db = getDb();
  const base = and(eq(products.supplierOrgId, supplierOrgId), eq(products.isActive, true));
  const where = and(
    base,
    filters.categoryId && isUuid(filters.categoryId) ? eq(products.categoryId, filters.categoryId) : undefined,
    filters.q ? searchCondition(filters.q) : undefined,
  );

  const [{ total }] = await db.select({ total: count() }).from(products).where(where);
  const pageCount = Math.max(1, Math.ceil(total / BUYER_CATALOG_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);

  const [items, cats] = await Promise.all([
    db
      .select(buyerProductColumns(ctx.orgId))
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(asc(categories.sortOrder), asc(products.name), asc(products.id))
      .limit(BUYER_CATALOG_PAGE_SIZE)
      .offset((page - 1) * BUYER_CATALOG_PAGE_SIZE),
    db
      .selectDistinct({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(base)
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
  ]);
  return { items, total, page, pageCount, categories: cats.map(({ id, name }) => ({ id, name })) };
}

export type SearchGroup = {
  supplier: { id: string; name: string; currency: string; pricesIncludeVat: boolean };
  items: BuyerProduct[];
  /** All matches at this supplier; more than items.length means "show more". */
  totalMatches: number;
};

/**
 * Searches every connected, approved supplier's active catalog at once.
 * Bounded: at most SEARCH_PER_SUPPLIER items per supplier and
 * SEARCH_MAX_RESULTS overall, with per-supplier totals for "show more".
 */
export async function searchConnectedCatalogs(ctx: OrgCtx, query: string): Promise<SearchGroup[]> {
  assertBuyer(ctx);
  const condition = searchCondition(query.slice(0, 100));
  if (!condition) return [];
  const db = getDb();

  // Every computed or name-clashing column gets an explicit alias: Drizzle
  // requires it for subquery fields.
  const matches = db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      brand: products.brand,
      sku: products.sku,
      unit: products.unit,
      packDescription: products.packDescription,
      imagePath: products.imagePath,
      minQtyMilli: products.minQtyMilli,
      qtyStepMilli: products.qtyStepMilli,
      vatRateBp: products.vatRateBp,
      categoryId: products.categoryId,
      categoryName: sql<string>`${categories.name}`.as("category_name"),
      priceMinor: effectivePriceSql(ctx.orgId).as("price_minor"),
      supplierOrgId: products.supplierOrgId,
      supplierName: sql<string>`${organizations.name}`.as("supplier_name"),
      currency: sql<string>`${organizations.currency}`.as("currency"),
      pricesIncludeVat: sql<boolean>`${supplierSettings.pricesIncludeVat}`.as("prices_include_vat"),
      rank: sql<number>`row_number() over (partition by ${products.supplierOrgId} order by ${products.name}, ${products.id})`.as("rank"),
      supplierTotal: sql<number>`count(*) over (partition by ${products.supplierOrgId})`.as("supplier_total"),
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .innerJoin(organizations, eq(organizations.id, products.supplierOrgId))
    .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
    .innerJoin(supplierCustomers, eq(supplierCustomers.supplierOrgId, products.supplierOrgId))
    .where(and(visibleSupplierCondition(ctx.orgId), eq(products.isActive, true), condition))
    .as("matches");

  const rows = await db
    .select()
    .from(matches)
    .where(sql`${matches.rank} <= ${SEARCH_PER_SUPPLIER}`)
    .orderBy(asc(matches.supplierName), asc(matches.rank))
    .limit(SEARCH_MAX_RESULTS);

  const groups = new Map<string, SearchGroup>();
  for (const r of rows) {
    let group = groups.get(r.supplierOrgId);
    if (!group) {
      group = {
        supplier: { id: r.supplierOrgId, name: r.supplierName, currency: r.currency, pricesIncludeVat: r.pricesIncludeVat },
        items: [],
        totalMatches: Number(r.supplierTotal),
      };
      groups.set(r.supplierOrgId, group);
    }
    group.items.push({
      id: r.id,
      name: r.name,
      description: r.description,
      brand: r.brand,
      sku: r.sku,
      unit: r.unit,
      packDescription: r.packDescription,
      imagePath: r.imagePath,
      minQtyMilli: r.minQtyMilli,
      qtyStepMilli: r.qtyStepMilli,
      vatRateBp: r.vatRateBp,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      priceMinor: Number(r.priceMinor),
    });
  }
  return [...groups.values()];
}

export type TopOrderedProduct = {
  product: BuyerProduct;
  supplier: { id: string; name: string; currency: string; pricesIncludeVat: boolean };
  /** How many of the buyer's orders contained it. */
  orderCount: number;
  cartQtyMilli: number;
};

/**
 * The products this buyer has ordered most often (number of orders containing
 * them, across suppliers), limited to what they can still order today: active
 * product, active connection, approved supplier. Prices are the current ones.
 */
export async function listTopOrderedProducts(ctx: OrgCtx, limit = 10): Promise<TopOrderedProduct[]> {
  assertBuyer(ctx);
  const db = getDb();
  const ranked = await db
    .select({
      productId: orderItems.productId,
      orderCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
      lastOrdered: sql<Date>`max(${orders.createdAt})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.buyerOrgId, ctx.orgId), isNotNull(orderItems.productId)))
    .groupBy(orderItems.productId)
    // Over-fetch: some will have been deactivated or their supplier suspended.
    .orderBy(desc(sql`count(distinct ${orderItems.orderId})`), desc(sql`max(${orders.createdAt})`))
    .limit(limit * 3);
  const ids = ranked.map((r) => r.productId).filter((id): id is string => id !== null);
  if (ids.length === 0) return [];

  const [rows, inCart] = await Promise.all([
    db
      .select({
        ...buyerProductColumns(ctx.orgId),
        supplierId: organizations.id,
        supplierName: organizations.name,
        currency: organizations.currency,
        pricesIncludeVat: supplierSettings.pricesIncludeVat,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .innerJoin(organizations, eq(organizations.id, products.supplierOrgId))
      .innerJoin(supplierSettings, eq(supplierSettings.organizationId, organizations.id))
      .innerJoin(supplierCustomers, eq(supplierCustomers.supplierOrgId, organizations.id))
      .where(and(inArray(products.id, ids), eq(products.isActive, true), visibleSupplierCondition(ctx.orgId))),
    db
      .select({ productId: cartItems.productId, qtyMilli: cartItems.qtyMilli })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(and(eq(carts.buyerOrgId, ctx.orgId), inArray(cartItems.productId, ids))),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cart = new Map(inCart.map((c) => [c.productId, c.qtyMilli]));

  const out: TopOrderedProduct[] = [];
  for (const r of ranked) {
    const row = r.productId ? byId.get(r.productId) : undefined;
    if (!row) continue;
    const { supplierId, supplierName, currency, pricesIncludeVat, ...product } = row;
    out.push({
      product,
      supplier: { id: supplierId, name: supplierName, currency, pricesIncludeVat },
      orderCount: r.orderCount,
      cartQtyMilli: cart.get(row.id) ?? 0,
    });
    if (out.length === limit) break;
  }
  return out;
}
