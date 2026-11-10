import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { parseDateInput } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { categories, orderItems, orders, products } from "@/server/db/schema";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";

// The warehouse's view: what to pick for all confirmed orders going out on one
// delivery day, as totals per product grouped by category, plus the stops.
// `day` is "YYYY-MM-DD", or "none" for confirmed orders with no agreed day.

export type PickList = {
  day: string;
  orders: { id: string; number: number; buyerName: string; address: string; city: string; instructions: string | null; note: string | null }[];
  groups: {
    category: string;
    rows: {
      key: string;
      name: string;
      sku: string | null;
      unit: string;
      qtyMilli: number;
      orderCount: number;
      /** Who gets how much of this product: the split to set aside while loading. */
      parts: { orderNumber: number; buyerName: string; qtyMilli: number }[];
    }[];
  }[];
  /** The same lines per stop, for checking each drop-off. */
  stopLines: Record<string, { key: string; name: string; unit: string; qtyMilli: number }[]>;
};

export async function getPickList(ctx: OrgCtx, rawDay: string): Promise<PickList> {
  assertSupplier(ctx);
  const day = rawDay === "none" ? "none" : parseDateInput(rawDay);
  if (!day) return { day: "none", orders: [], groups: [], stopLines: {} };
  const db = getDb();
  const scope = and(
    eq(orders.supplierOrgId, ctx.orgId),
    eq(orders.status, "confirmed"),
    day === "none" ? isNull(orders.deliveryDate) : eq(orders.deliveryDate, day),
  );
  const [stops, lines, parts] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        buyerName: orders.buyerName,
        address: orders.deliveryAddress,
        city: orders.deliveryCity,
        instructions: orders.deliveryInstructions,
        note: orders.note,
      })
      .from(orders)
      .where(scope)
      .orderBy(asc(orders.number)),
    db
      .select({
        category: sql<string>`coalesce(${categories.name}, '')`,
        sortOrder: sql<number>`coalesce(${categories.sortOrder}, 2147483647)`,
        key: sql<string>`coalesce(${orderItems.productId}::text, ${orderItems.name})`,
        name: sql<string>`max(${orderItems.name})`,
        sku: sql<string | null>`max(${orderItems.sku})`,
        unit: sql<string>`max(${orderItems.unit}::text)`,
        qtyMilli: sql<number>`sum(${orderItems.confirmedQtyMilli})::bigint`.mapWith(Number),
        orderCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(products, eq(products.id, orderItems.productId))
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(and(scope, sql`${orderItems.confirmedQtyMilli} > 0`))
      .groupBy(sql`coalesce(${orderItems.productId}::text, ${orderItems.name})`, categories.name, categories.sortOrder)
      .orderBy(sql`coalesce(${categories.sortOrder}, 2147483647)`, asc(categories.name), sql`max(${orderItems.name})`),
    db
      .select({
        orderId: orders.id,
        orderNumber: orders.number,
        buyerName: orders.buyerName,
        key: sql<string>`coalesce(${orderItems.productId}::text, ${orderItems.name})`,
        name: orderItems.name,
        unit: sql<string>`${orderItems.unit}::text`,
        qtyMilli: sql<number>`${orderItems.confirmedQtyMilli}::bigint`.mapWith(Number),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(scope, sql`${orderItems.confirmedQtyMilli} > 0`))
      .orderBy(asc(orders.number), asc(orderItems.name)),
  ]);
  const byKey = new Map<string, { orderNumber: number; buyerName: string; qtyMilli: number }[]>();
  const stopLines: Record<string, { key: string; name: string; unit: string; qtyMilli: number }[]> = {};
  for (const p of parts) {
    (byKey.get(p.key) ?? byKey.set(p.key, []).get(p.key)!).push({ orderNumber: p.orderNumber, buyerName: p.buyerName, qtyMilli: p.qtyMilli });
    (stopLines[p.orderId] ??= []).push({ key: p.key, name: p.name, unit: p.unit, qtyMilli: p.qtyMilli });
  }
  const groups: PickList["groups"] = [];
  for (const l of lines) {
    let g = groups.find((x) => x.category === l.category);
    if (!g) groups.push((g = { category: l.category, rows: [] }));
    g.rows.push({ key: l.key, name: l.name, sku: l.sku, unit: l.unit, qtyMilli: l.qtyMilli, orderCount: l.orderCount, parts: byKey.get(l.key) ?? [] });
  }
  return { day, orders: stops, groups, stopLines };
}
