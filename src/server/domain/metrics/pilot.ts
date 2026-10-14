import "server-only";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { orders, organizations, products, type OrderStatus, type OrgStatus } from "@/server/db/schema";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";

// The pilot's success measures (CLAUDE.md, "The MVP"), computed from real
// rows only. Definitions are shown next to each number on the admin overview.
//
//  - active supplier   received >= 1 order in the last 30 days
//  - active buyer      submitted >= 1 order in the last 14 days
//  - weekly reorder    buyers who ordered in BOTH of the last two weeks,
//    rate              divided by buyers who ordered in the earlier of the two
//                      (null while nobody ordered in the earlier week)
//  - orders per        orders submitted in the last 28 days / 4 / approved
//    supplier per week suppliers (null while there are none)
//
// A "week" is a rolling 7 days ending now.

const DAY_MS = 24 * 60 * 60 * 1000;

export type PilotMetrics = {
  suppliersByStatus: Record<OrgStatus, number>;
  buyerOrgs: number;
  activeProducts: number;
  ordersByStatus30d: Record<OrderStatus, number>;
  activeSuppliers: number;
  activeBuyers: number;
  /** Buyers who ordered in the earlier week / in both weeks. */
  reorder: { earlierWeekBuyers: number; bothWeeksBuyers: number; rate: number | null };
  ordersPerSupplierPerWeek: number | null;
};

export async function getPilotMetrics(ctx: AdminCtx, now: Date = new Date()): Promise<PilotMetrics> {
  assertAdmin(ctx);
  const db = getDb();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const inWindow = (from: Date, to: Date = now) => and(gte(orders.createdAt, from), lt(orders.createdAt, to));
  const buyersIn = (from: Date, to: Date) =>
    db.selectDistinct({ id: orders.buyerOrgId }).from(orders).where(inWindow(from, to));

  const [supplierRows, [buyers], [activeProducts], statusRows, [activeSuppliers], [activeBuyers], earlier, latest, [recentOrders]] =
    await Promise.all([
      db
        .select({ status: organizations.status, n: count() })
        .from(organizations)
        .where(eq(organizations.type, "supplier"))
        .groupBy(organizations.status),
      db.select({ n: count() }).from(organizations).where(eq(organizations.type, "buyer")),
      db.select({ n: count() }).from(products).where(eq(products.isActive, true)),
      db.select({ status: orders.status, n: count() }).from(orders).where(inWindow(ago(30))).groupBy(orders.status),
      db
        .select({ n: sql<number>`count(distinct ${orders.supplierOrgId})::int` })
        .from(orders)
        .where(inWindow(ago(30))),
      db
        .select({ n: sql<number>`count(distinct ${orders.buyerOrgId})::int` })
        .from(orders)
        .where(inWindow(ago(14))),
      buyersIn(ago(14), ago(7)),
      buyersIn(ago(7), now),
      db.select({ n: count() }).from(orders).where(inWindow(ago(28))),
    ]);

  const suppliersByStatus: Record<OrgStatus, number> = { pending_review: 0, active: 0, suspended: 0 };
  for (const r of supplierRows) suppliersByStatus[r.status] = r.n;
  const ordersByStatus30d: Record<OrderStatus, number> = { pending: 0, confirmed: 0, delivered: 0, rejected: 0, cancelled: 0 };
  for (const r of statusRows) ordersByStatus30d[r.status] = r.n;

  const latestIds = new Set(latest.map((b) => b.id));
  const both = earlier.filter((b) => latestIds.has(b.id)).length;

  return {
    suppliersByStatus,
    buyerOrgs: buyers.n,
    activeProducts: activeProducts.n,
    ordersByStatus30d,
    activeSuppliers: activeSuppliers.n,
    activeBuyers: activeBuyers.n,
    reorder: {
      earlierWeekBuyers: earlier.length,
      bothWeeksBuyers: both,
      rate: earlier.length === 0 ? null : both / earlier.length,
    },
    ordersPerSupplierPerWeek: suppliersByStatus.active === 0 ? null : recentOrders.n / 4 / suppliersByStatus.active,
  };
}
