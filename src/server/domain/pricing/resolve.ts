import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/server/db/client";
import { products } from "@/server/db/schema";

// The one place a buyer's price is decided (CLAUDE.md, "Conventions").
// Rule: the override in the price list assigned to this buyer's active
// connection with the supplier, otherwise the product's base price.

/** The rule itself, for code that already has both numbers. */
export function pickPrice(basePriceMinor: number, overrideMinor: number | null | undefined): number {
  return overrideMinor ?? basePriceMinor;
}

/**
 * SQL for the effective price of `products` rows for `buyerOrgId`, to embed
 * in a select that already reads from `products` (catalog lists, search).
 * Resolved in the same query — no per-product lookups.
 */
export function effectivePriceSql(buyerOrgId: string): SQL<number> {
  // Written with explicit aliases: Drizzle leaves columns unqualified in
  // single-table selects, which would make this correlated subquery ambiguous.
  return sql<number>`coalesce((
    select pli.price_minor
    from price_list_items pli
    join supplier_customers sc
      on sc.price_list_id = pli.price_list_id
     and sc.supplier_org_id = pli.supplier_org_id
    where pli.product_id = "products"."id"
      and sc.buyer_org_id = ${buyerOrgId}
      and sc.status = 'active'
  ), "products"."base_price_minor")`.mapWith(Number);
}

/**
 * Effective unit prices for a set of one supplier's products, for one buyer.
 * Products that don't belong to the supplier are simply absent from the map.
 * One query regardless of how many products.
 */
export async function resolvePrices(
  input: { supplierOrgId: string; buyerOrgId: string; productIds: string[] },
  db: Db | Tx = getDb(),
): Promise<Map<string, number>> {
  if (input.productIds.length === 0) return new Map();
  const rows = await db
    .select({ id: products.id, price: effectivePriceSql(input.buyerOrgId) })
    .from(products)
    .where(and(eq(products.supplierOrgId, input.supplierOrgId), inArray(products.id, input.productIds)));
  return new Map(rows.map((r) => [r.id, r.price]));
}
