import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { MAX_CATALOG_LINES, type CatalogItem, type VoiceRef } from "@/lib/voice/order-parse";
import { getDb } from "@/server/db/client";
import { organizations, products, supplierCustomers } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { voicePhrasesByProduct } from "@/server/domain/buyer/voice-phrases";
import { availableToBuyerSql } from "@/server/domain/pricing/resolve";

export type VoiceCatalog = {
  /** Short ids (`p1`, `p2`...) and supplier names only: no prices, no real ids in the prompt. */
  items: CatalogItem[];
  refs: Record<string, VoiceRef>;
  suppliers: { name: string; count: number }[];
};

/**
 * The products this buyer may order by voice: active products of suppliers the buyer is actively connected to, on the buyer's own
 * assortment list (`availableToBuyerSql`). The ones the buyer ordered before come first, then the rest by name, up to what the
 * assistant can hold. Never another business's data, never prices.
 */
export async function loadVoiceCatalog(ctx: OrgCtx): Promise<VoiceCatalog> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const rows = await getDb()
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      minMilli: products.minQtyMilli,
      stepMilli: products.qtyStepMilli,
      supplierId: products.supplierOrgId,
      supplierName: organizations.name,
      ordered: sql<number>`(select count(*)::int from order_items oi join orders o on o.id = oi.order_id
        where oi.product_id = ${products.id} and o.buyer_org_id = ${ctx.orgId})`.as("ordered"),
    })
    .from(products)
    .innerJoin(organizations, eq(organizations.id, products.supplierOrgId))
    .innerJoin(
      supplierCustomers,
      and(
        eq(supplierCustomers.supplierOrgId, products.supplierOrgId),
        eq(supplierCustomers.buyerOrgId, ctx.orgId),
        eq(supplierCustomers.status, "active"),
      ),
    )
    .where(and(eq(products.isActive, true), eq(organizations.status, "active"), availableToBuyerSql(ctx.orgId)))
    .orderBy(desc(sql`"ordered"`), asc(products.name))
    .limit(MAX_CATALOG_LINES);

  // How this buyer has named these products before (their own earlier, confirmed orders), as "also said" hints.
  // An enhancement: if it cannot be read, the assistant still works from the plain catalogue.
  const remembered = await voicePhrasesByProduct(ctx, rows.map((r) => r.id)).catch((error: unknown) => {
    console.error("voicePhrasesByProduct failed:", error instanceof Error ? error.message : "unknown");
    return new Map<string, string[]>();
  });
  const items: CatalogItem[] = [];
  const refs: Record<string, VoiceRef> = {};
  const supplierAlias = new Map<string, string>();
  const counts = new Map<string, { name: string; count: number }>();
  rows.forEach((row, index) => {
    const alias = `p${index + 1}`;
    if (!supplierAlias.has(row.supplierId)) supplierAlias.set(row.supplierId, `s${supplierAlias.size + 1}`);
    items.push({ id: alias, name: row.name.slice(0, 120), unit: row.unit, supplierId: supplierAlias.get(row.supplierId), supplierName: row.supplierName, aliases: remembered.get(row.id) });
    refs[alias] = { productId: row.id, minMilli: row.minMilli, stepMilli: row.stepMilli };
    const entry = counts.get(row.supplierId) ?? { name: row.supplierName, count: 0 };
    entry.count += 1;
    counts.set(row.supplierId, entry);
  });
  return { items, refs, suppliers: [...counts.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
