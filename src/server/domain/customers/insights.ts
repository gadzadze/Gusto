import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { orderItems, orders, supplierCustomers, type OrderStatus } from "@/server/db/schema";
import { isUuid } from "@/server/domain/catalog/products";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";

// What a supplier learns about one customer from their own orders. Only the
// supplier's own orders with this buyer are read (both ids are in every query).

export type CustomerInsights = {
  orderCount: number;
  /** Confirmed + delivered orders only. This is order value, not revenue (CLAUDE.md). */
  valueMinor: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  /** Products by confirmed quantity (rejected and cancelled orders excluded), top 5. */
  topProducts: { name: string; unit: string; orderCount: number }[];
  recent: { id: string; number: number; status: OrderStatus; totalMinor: number; createdAt: Date }[];
  currency: string | null;
};

export async function getCustomerInsights(ctx: OrgCtx, customerId: string): Promise<CustomerInsights> {
  assertSupplier(ctx);
  if (!isUuid(customerId)) throw new NotFoundError("customer");
  const db = getDb();
  const [customer] = await db
    .select({ buyerOrgId: supplierCustomers.buyerOrgId })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.id, customerId), eq(supplierCustomers.supplierOrgId, ctx.orgId)));
  if (!customer) throw new NotFoundError("customer");
  const empty: CustomerInsights = { orderCount: 0, valueMinor: 0, firstOrderAt: null, lastOrderAt: null, topProducts: [], recent: [], currency: null };
  if (!customer.buyerOrgId) return empty;

  const scope = and(eq(orders.supplierOrgId, ctx.orgId), eq(orders.buyerOrgId, customer.buyerOrgId));
  const [[totals], recent, top] = await Promise.all([
    db
      .select({
        orderCount: sql<number>`count(*)::int`,
        valueMinor: sql<number>`coalesce(sum(${orders.totalMinor}) filter (where ${orders.status} in ('confirmed','delivered')), 0)::bigint`.mapWith(Number),
        firstOrderAt: sql<Date | null>`min(${orders.createdAt})`.mapWith((v: string | null) => (v ? new Date(v) : null)),
        lastOrderAt: sql<Date | null>`max(${orders.createdAt})`.mapWith((v: string | null) => (v ? new Date(v) : null)),
        currency: sql<string | null>`max(${orders.currency})`,
      })
      .from(orders)
      .where(scope),
    db
      .select({ id: orders.id, number: orders.number, status: orders.status, totalMinor: orders.totalMinor, createdAt: orders.createdAt })
      .from(orders)
      .where(scope)
      .orderBy(desc(orders.createdAt), desc(orders.number))
      .limit(8),
    db
      .select({
        name: sql<string>`max(${orderItems.name})`,
        unit: sql<string>`max(${orderItems.unit}::text)`,
        orderCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(scope, inArray(orders.status, ["pending", "confirmed", "delivered"]), sql`coalesce(${orderItems.confirmedQtyMilli}, ${orderItems.orderedQtyMilli}) > 0`))
      .groupBy(sql`coalesce(${orderItems.productId}::text, ${orderItems.name})`)
      .orderBy(desc(sql`count(distinct ${orderItems.orderId})`), desc(sql`max(${orders.createdAt})`))
      .limit(5),
  ]);
  return { ...totals, topProducts: top, recent };
}
