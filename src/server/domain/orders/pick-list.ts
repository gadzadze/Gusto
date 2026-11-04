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
  groups: { category: string; rows: { name: string; sku: string | null; unit: string; qtyMilli: number; orderCount: number }[] }[];
};

export async function getPickList(ctx: OrgCtx, rawDay: string): Promise<PickList> {
  assertSupplier(ctx);
  const day = rawDay === "none" ? "none" : parseDateInput(rawDay);
  if (!day) return { day: "none", orders: [], groups: [] };
  const db = getDb();
  const scope = and(
    eq(orders.supplierOrgId, ctx.orgId),
    eq(orders.status, "confirmed"),
    day === "none" ? isNull(orders.deliveryDate) : eq(orders.deliveryDate, day),
  );
  const [stops, lines] = await Promise.all([
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
  ]);
  const groups: PickList["groups"] = [];
  for (const l of lines) {
    let g = groups.find((x) => x.category === l.category);
    if (!g) groups.push((g = { category: l.category, rows: [] }));
    g.rows.push({ name: l.name, sku: l.sku, unit: l.unit, qtyMilli: l.qtyMilli, orderCount: l.orderCount });
  }
  return { day, orders: stops, groups };
}
