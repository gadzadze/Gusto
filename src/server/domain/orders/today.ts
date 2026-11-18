import "server-only";
import { and, asc, count, eq, gte, inArray, max, sql } from "drizzle-orm";
import { addDays, todayIn } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { orders, organizations } from "@/server/db/schema";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";

// What the supplier's home page needs beyond the headline metrics: the queue of orders waiting for an
// answer (oldest first, because those have waited longest), the next delivery days, and the daily order
// value for the small chart. Everything is scoped to the acting company.

export type PendingQueueItem = {
  id: string;
  number: number;
  buyerName: string;
  totalMinor: number;
  currency: string;
  createdAt: Date;
  itemCount: number;
};

export async function listPendingQueue(ctx: OrgCtx, limit = 6): Promise<PendingQueueItem[]> {
  assertSupplier(ctx);
  return getDb()
    .select({
      id: orders.id,
      number: orders.number,
      buyerName: orders.buyerName,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
      itemCount: sql<number>`(select count(*)::int from order_items where order_items.order_id = "orders"."id")`,
    })
    .from(orders)
    .where(and(eq(orders.supplierOrgId, ctx.orgId), eq(orders.status, "pending")))
    .orderBy(asc(orders.createdAt), asc(orders.number))
    .limit(limit);
}

export type UpcomingDelivery = {
  /** "YYYY-MM-DD" on the supplier's calendar, or null for confirmed orders with no agreed day. */
  date: string | null;
  orders: number;
  customers: number;
};

/** Confirmed orders by delivery day, earliest first (days already past come first: they are late). */
export async function listUpcomingDeliveries(ctx: OrgCtx, limit = 5): Promise<UpcomingDelivery[]> {
  assertSupplier(ctx);
  return getDb()
    .select({
      date: orders.deliveryDate,
      orders: sql<number>`count(*)::int`,
      customers: sql<number>`count(distinct ${orders.buyerOrgId})::int`,
    })
    .from(orders)
    .where(and(eq(orders.supplierOrgId, ctx.orgId), eq(orders.status, "confirmed")))
    .groupBy(orders.deliveryDate)
    .orderBy(sql`${orders.deliveryDate} asc nulls last`)
    .limit(limit);
}

/** Order value (confirmed + delivered) per day for the last `days` days on the company's calendar, oldest first. */
export async function getOrderValueSeries(ctx: OrgCtx, days = 30): Promise<{ day: string; valueMinor: number }[]> {
  assertSupplier(ctx);
  const db = getDb();
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const tz = org?.timezone ?? "UTC";
  const today = todayIn(tz);
  const first = addDays(today, -(days - 1));
  const localDay = sql<string>`to_char((${orders.createdAt} at time zone ${tz})::date, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: localDay, total: sql<string>`coalesce(sum(${orders.totalMinor}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.supplierOrgId, ctx.orgId),
        inArray(orders.status, ["confirmed", "delivered"]),
        gte(orders.createdAt, sql`(${first}::date::timestamp at time zone ${tz})`),
      ),
    )
    .groupBy(sql`1`);
  const byDay = new Map(rows.map((r) => [r.day, Number(r.total)]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(first, i);
    return { day, valueMinor: byDay.get(day) ?? 0 };
  });
}

/** The company's calendar: today's date and its timezone. */
export async function getSupplierClock(ctx: OrgCtx, now: Date = new Date()): Promise<{ timezone: string; today: string }> {
  assertSupplier(ctx);
  const [org] = await getDb().select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const timezone = org?.timezone ?? "UTC";
  return { timezone, today: todayIn(timezone, now) };
}

/**
 * A cheap fingerprint of the supplier's waiting queue, polled by the open dashboard / inbox so a new
 * (or withdrawn) order shows up without a manual reload. The signature changes when the count changes
 * or a newer pending order arrives; it carries no order data.
 */
export async function getPendingPulse(ctx: OrgCtx): Promise<{ pending: number; signature: string }> {
  assertSupplier(ctx);
  const [row] = await getDb()
    .select({ n: count(), latest: max(orders.createdAt) })
    .from(orders)
    .where(and(eq(orders.supplierOrgId, ctx.orgId), eq(orders.status, "pending")));
  const pending = row?.n ?? 0;
  return { pending, signature: `${pending}:${row?.latest ? new Date(row.latest).getTime() : 0}` };
}
