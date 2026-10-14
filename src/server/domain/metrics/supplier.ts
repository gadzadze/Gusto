import "server-only";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { ProductUnit } from "@/lib/catalog/units";
import { getDb } from "@/server/db/client";
import { orderItems, orders, organizations } from "@/server/db/schema";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";

// The supplier dashboard's numbers. Every figure comes from `orders` and
// `order_items`; the definitions below are the ones the dashboard shows next to
// each number (messages: supplier.dashboard.*.hint). "Order value" is what was
// ordered, never revenue: Gusto does not know whether anything was paid.

const DAY_MS = 24 * 60 * 60 * 1000;

export type SupplierMetrics = {
  currency: string;
  /** Orders waiting for the supplier to confirm or reject (right now). */
  pendingOrders: number;
  /** Orders submitted in the last 7 days / the 7 days before that. */
  ordersThisWeek: number;
  ordersLastWeek: number;
  /** Total of confirmed + delivered orders submitted in the last 30 days, in minor units. */
  orderValue30dMinor: number;
  /** Top products by confirmed quantity, confirmed + delivered orders, last 30 days. */
  topProducts: { name: string; unit: ProductUnit; confirmedQtyMilli: number }[];
  /** Buyers with 2 or more submitted orders in the last 30 days. */
  repeatBuyers30d: number;
};

export async function getSupplierMetrics(ctx: OrgCtx, now: Date = new Date()): Promise<SupplierMetrics> {
  assertSupplier(ctx);
  const db = getDb();
  const mine = eq(orders.supplierOrgId, ctx.orgId);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const counted = inArray(orders.status, ["confirmed", "delivered"]);

  const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId));

  const [[pending], [thisWeek], [lastWeek], [value], topProducts, [repeat]] = await Promise.all([
    db.select({ n: count() }).from(orders).where(and(mine, eq(orders.status, "pending"))),
    db.select({ n: count() }).from(orders).where(and(mine, gte(orders.createdAt, weekAgo), lt(orders.createdAt, now))),
    db.select({ n: count() }).from(orders).where(and(mine, gte(orders.createdAt, twoWeeksAgo), lt(orders.createdAt, weekAgo))),
    db
      .select({ total: sql<string>`coalesce(sum(${orders.totalMinor}), 0)` })
      .from(orders)
      .where(and(mine, counted, gte(orders.createdAt, monthAgo), lt(orders.createdAt, now))),
    db
      .select({
        name: orderItems.name,
        unit: orderItems.unit,
        qty: sql<string>`sum(${orderItems.confirmedQtyMilli})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(mine, counted, gte(orders.createdAt, monthAgo), lt(orders.createdAt, now)))
      // A renamed product is a different line in history; group by what was ordered.
      .groupBy(orderItems.productId, orderItems.name, orderItems.unit)
      .having(sql`sum(${orderItems.confirmedQtyMilli}) > 0`)
      .orderBy(desc(sql`sum(${orderItems.confirmedQtyMilli})`), orderItems.name)
      .limit(5),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(
        db
          .select({ buyer: orders.buyerOrgId })
          .from(orders)
          .where(and(mine, gte(orders.createdAt, monthAgo), lt(orders.createdAt, now)))
          .groupBy(orders.buyerOrgId)
          .having(sql`count(*) >= 2`)
          .as("repeat_buyers"),
      ),
  ]);

  return {
    currency: org?.currency ?? "GEL",
    pendingOrders: pending.n,
    ordersThisWeek: thisWeek.n,
    ordersLastWeek: lastWeek.n,
    orderValue30dMinor: Number(value.total),
    topProducts: topProducts.map((p) => ({ name: p.name, unit: p.unit, confirmedQtyMilli: Number(p.qty) })),
    repeatBuyers30d: repeat.n,
  };
}
