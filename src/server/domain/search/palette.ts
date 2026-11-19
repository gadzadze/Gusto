import "server-only";
import { and, asc, eq, ilike } from "drizzle-orm";
import { orderNumberFrom } from "@/lib/palette";
import { getDb } from "@/server/db/client";
import { products, supplierCustomers } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { listConnectedSuppliers } from "@/server/domain/buyer/catalog";
import { searchCondition } from "@/server/domain/catalog/products";
import { orderLinkTarget } from "@/server/domain/orders/queries";
import { escapeLike } from "@/server/domain/search/translit";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

// Results for the command palette (Ctrl/Cmd+K): a few things of the acting company that match what was typed, each with the
// page it opens. Everything is scoped by the guard's context, never by input, and only names and ids leave (no prices,
// stock or contacts). Buyers only ever see suppliers they are connected to, like everywhere else.

export type PaletteKind = "product" | "customer" | "supplier" | "order";
export type PaletteResult = { kind: PaletteKind; id: string; label: string; hint: string; href: string };

const PER_KIND = 5;

export async function searchPalette(ctx: OrgCtx, rawQuery: string): Promise<PaletteResult[]> {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return [];
  await consumeRateLimit(RATE_LIMITS.palette, ctx.userId);
  const out: PaletteResult[] = [];

  const number = orderNumberFrom(q);
  if (number !== null) {
    const href = await orderLinkTarget(ctx, number);
    if (href) out.push({ kind: "order", id: String(number), label: `GST-${number}`, hint: "", href });
  }

  const db = getDb();
  if (ctx.orgType === "supplier") {
    const found = await db
      .select({ id: products.id, name: products.name, sku: products.sku })
      .from(products)
      .where(and(eq(products.supplierOrgId, ctx.orgId), searchCondition(q)))
      .orderBy(asc(products.name))
      .limit(PER_KIND);
    for (const p of found) out.push({ kind: "product", id: p.id, label: p.name, hint: p.sku ?? "", href: `/supplier/products/${p.id}` });

    const customers = await db
      .select({ id: supplierCustomers.id, name: supplierCustomers.businessName })
      .from(supplierCustomers)
      .where(and(eq(supplierCustomers.supplierOrgId, ctx.orgId), ilike(supplierCustomers.businessName, `%${escapeLike(q)}%`)))
      .orderBy(asc(supplierCustomers.businessName))
      .limit(PER_KIND);
    for (const c of customers) out.push({ kind: "customer", id: c.id, label: c.name, hint: "", href: `/supplier/customers/${c.id}` });
  } else if (ctx.orgType === "buyer") {
    const needle = q.toLowerCase();
    const suppliers = (await listConnectedSuppliers(ctx)).filter((s) => s.name.toLowerCase().includes(needle)).slice(0, PER_KIND);
    for (const s of suppliers) out.push({ kind: "supplier", id: s.id, label: s.name, hint: s.city ?? "", href: `/buyer/suppliers/${s.id}` });
  }
  return out;
}
