import "server-only";
import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  categories,
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
