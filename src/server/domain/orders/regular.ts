import "server-only";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { hourIn, isoWeekdayIn, todayIn } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import {
  notificationPreferences,
  organizationMemberships,
  organizations,
  products,
  regularOrderItems,
  regularOrders,
} from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { isUuid } from "@/server/domain/catalog/products";
import { getOrder } from "./queries";
import { putItemsInCart } from "./cart";

// A regular order is a saved set of products and quantities with one supplier
// and the weekday the buyer usually reorders. It never becomes an order by
// itself: it is a reminder plus a one-tap "put in cart", and checkout re-checks
// prices and availability as always.

export type RegularOrderError = "limit_reached" | "empty";
export const MAX_REGULAR_ORDERS = 10;
/** Reminders go out from this local hour, on the chosen weekday. */
export const REMINDER_HOUR = 8;

export const regularOrderInputSchema = z.object({
  name: z.string().trim().min(1, "required").max(80, "too_long"),
  weekday: z.number().int().min(1).max(7),
});
export type RegularOrderInput = z.infer<typeof regularOrderInputSchema>;

function assertBuyer(ctx: OrgCtx) {
  if (ctx.orgType !== "buyer") throw new NotFoundError("regular order");
}

/** Saves what was in a placed order (confirmed quantities where there are any) as a regular order. */
export async function createRegularOrderFromOrder(ctx: OrgCtx, orderId: string, rawInput: RegularOrderInput): Promise<string> {
  assertBuyer(ctx);
  const input = regularOrderInputSchema.parse(rawInput);
  const { order, items } = await getOrder(ctx, orderId);
  const lines = items
    .map((i) => ({ productId: i.productId, qty: i.confirmedQtyMilli ?? i.orderedQtyMilli }))
    .filter((l): l is { productId: string; qty: number } => l.productId !== null && l.qty > 0);
  if (lines.length === 0) throw new StateError<RegularOrderError>("empty");

  return getDb().transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(regularOrders)
      .where(eq(regularOrders.buyerOrgId, ctx.orgId));
    if (n >= MAX_REGULAR_ORDERS) throw new StateError<RegularOrderError>("limit_reached");
    const [created] = await tx
      .insert(regularOrders)
      .values({ buyerOrgId: ctx.orgId, supplierOrgId: order.supplierOrgId, name: input.name, weekday: input.weekday, createdByUserId: ctx.userId })
      .returning({ id: regularOrders.id });
    await tx.insert(regularOrderItems).values(lines.map((l) => ({ regularOrderId: created.id, productId: l.productId, qtyMilli: l.qty })));
    return created.id;
  });
}

export type RegularOrderView = {
  id: string;
  name: string;
  weekday: number;
  supplierOrgId: string;
  supplierName: string;
  itemNames: string[];
  /** Today (buyer's calendar) is its weekday. */
  dueToday: boolean;
};

export async function listRegularOrders(ctx: OrgCtx, now: Date = new Date()): Promise<RegularOrderView[]> {
  assertBuyer(ctx);
  const db = getDb();
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const rows = await db
    .select({
      id: regularOrders.id,
      name: regularOrders.name,
      weekday: regularOrders.weekday,
      supplierOrgId: regularOrders.supplierOrgId,
      supplierName: organizations.name,
    })
    .from(regularOrders)
    .innerJoin(organizations, eq(organizations.id, regularOrders.supplierOrgId))
    .where(eq(regularOrders.buyerOrgId, ctx.orgId))
    .orderBy(asc(regularOrders.weekday), asc(regularOrders.name));
  if (rows.length === 0) return [];
  const items = await db
    .select({ regularOrderId: regularOrderItems.regularOrderId, name: products.name })
    .from(regularOrderItems)
    .innerJoin(products, eq(products.id, regularOrderItems.productId))
    .where(inArray(regularOrderItems.regularOrderId, rows.map((r) => r.id)))
    .orderBy(asc(products.name));
  const today = isoWeekdayIn(org?.timezone ?? "UTC", now);
  return rows.map((r) => ({
    ...r,
    itemNames: items.filter((i) => i.regularOrderId === r.id).map((i) => i.name),
    dueToday: r.weekday === today,
  }));
}

export async function deleteRegularOrder(ctx: OrgCtx, id: string): Promise<void> {
  assertBuyer(ctx);
  if (!isUuid(id)) throw new NotFoundError("regular order");
  const removed = await getDb()
    .delete(regularOrders)
    .where(and(eq(regularOrders.id, id), eq(regularOrders.buyerOrgId, ctx.orgId)))
    .returning({ id: regularOrders.id });
  if (removed.length === 0) throw new NotFoundError("regular order");
}

/** Puts a regular order's products in the cart at current prices; unavailable ones are skipped and named. */
export async function loadRegularOrderIntoCart(
  ctx: OrgCtx,
  id: string,
): Promise<{ supplierOrgId: string; added: number; skipped: string[] }> {
  assertBuyer(ctx);
  if (!isUuid(id)) throw new NotFoundError("regular order");
  const [regular] = await getDb()
    .select({ supplierOrgId: regularOrders.supplierOrgId })
    .from(regularOrders)
    .where(and(eq(regularOrders.id, id), eq(regularOrders.buyerOrgId, ctx.orgId)));
  if (!regular) throw new NotFoundError("regular order");
  const items = await getDb()
    .select({ productId: regularOrderItems.productId, qtyMilli: regularOrderItems.qtyMilli, name: products.name })
    .from(regularOrderItems)
    .innerJoin(products, eq(products.id, regularOrderItems.productId))
    .where(eq(regularOrderItems.regularOrderId, id));
  const result = await putItemsInCart(ctx, regular.supplierOrgId, items);
  return { supplierOrgId: regular.supplierOrgId, ...result };
}

/**
 * Reminder pass, called by the cron route every minute. For every regular
 * order whose weekday is today in the buyer's timezone, from REMINDER_HOUR on,
 * and not yet reminded today, claim it (at most once per day, even with two
 * cron runs at once) and email the buyer organization's members who have
 * order-update emails on. One email per organization, listing what is due.
 * `send` is injected so tests don't need a mail provider.
 */
export async function sendRegularOrderReminders(
  send: (to: string, names: string[]) => Promise<void>,
  now: Date = new Date(),
): Promise<{ claimed: number; emails: number }> {
  const db = getDb();
  const candidates = await db
    .select({
      id: regularOrders.id,
      buyerOrgId: regularOrders.buyerOrgId,
      name: regularOrders.name,
      weekday: regularOrders.weekday,
      timezone: organizations.timezone,
    })
    .from(regularOrders)
    .innerJoin(organizations, eq(organizations.id, regularOrders.buyerOrgId))
    .where(and(eq(organizations.status, "active")));

  const claimedByOrg = new Map<string, string[]>();
  let claimed = 0;
  for (const c of candidates) {
    if (isoWeekdayIn(c.timezone, now) !== c.weekday || hourIn(c.timezone, now) < REMINDER_HOUR) continue;
    const today = todayIn(c.timezone, now);
    const won = await db
      .update(regularOrders)
      .set({ lastRemindedOn: today })
      .where(and(eq(regularOrders.id, c.id), or(isNull(regularOrders.lastRemindedOn), lt(regularOrders.lastRemindedOn, today))))
      .returning({ id: regularOrders.id });
    if (won.length === 0) continue;
    claimed++;
    claimedByOrg.set(c.buyerOrgId, [...(claimedByOrg.get(c.buyerOrgId) ?? []), c.name]);
  }

  let emails = 0;
  for (const [orgId, names] of claimedByOrg) {
    const recipients = await db
      .select({ email: authUsers.email, pref: notificationPreferences.emailOrderUpdates })
      .from(organizationMemberships)
      .innerJoin(authUsers, eq(authUsers.id, organizationMemberships.userId))
      .leftJoin(notificationPreferences, eq(notificationPreferences.userId, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, orgId));
    for (const r of recipients) {
      if (!r.email || r.pref === false) continue;
      try {
        await send(r.email, names);
        emails++;
      } catch (error) {
        console.error("[regular-orders] reminder email failed", { message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { claimed, emails };
}

