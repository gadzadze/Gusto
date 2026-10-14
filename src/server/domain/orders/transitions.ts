import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { computeTotals } from "@/lib/orders/totals";
import { TRANSITIONS, type OrderAction } from "@/lib/orders/transitions";
import { getDb, type Tx } from "@/server/db/client";
import { orderItems, orders, orderStatusHistory } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { recordOrderEvent } from "@/server/notifications/events";
import { deliverAfterResponse } from "@/server/notifications/process";
import type { NotificationEvent } from "@/server/db/schema";

// Every status change goes through applyTransition(): role check →
// conditional UPDATE on the expected current status → history row, in one
// transaction. Two people clicking at once: exactly one UPDATE matches.

export type TransitionError = "stale_status" | "reason_required" | "nothing_confirmed" | "invalid_lines" | "suspended";

export const reasonSchema = z.string().trim().min(3).max(500);

const EVENT_FOR_ACTION: Record<OrderAction, NotificationEvent> = {
  confirm: "order_confirmed",
  reject: "order_rejected",
  deliver: "order_delivered",
  buyer_cancel: "order_cancelled",
  supplier_cancel: "order_cancelled",
};

async function applyTransition(
  tx: Tx,
  ctx: OrgCtx,
  orderId: string,
  action: OrderAction,
  note: string | null,
): Promise<void> {
  const rule = TRANSITIONS[action];
  if (ctx.orgType !== rule.actor) throw new NotFoundError("order");
  const scope = rule.actor === "buyer" ? orders.buyerOrgId : orders.supplierOrgId;

  const updated = await tx
    .update(orders)
    .set({ status: rule.to })
    .where(and(eq(orders.id, orderId), eq(scope, ctx.orgId), eq(orders.status, rule.from)))
    .returning({ id: orders.id });
  if (updated.length === 0) {
    const [exists] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(scope, ctx.orgId)));
    if (!exists) throw new NotFoundError("order");
    throw new StateError<TransitionError>("stale_status");
  }
  await tx.insert(orderStatusHistory).values({
    orderId,
    fromStatus: rule.from,
    toStatus: rule.to,
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    note,
  });
  // Same transaction: no status change without its notifications, and none without the change.
  await recordOrderEvent(tx, {
    orderId,
    event: EVENT_FOR_ACTION[action],
    actor: { userId: ctx.userId, orgId: ctx.orgId },
  });
}

function cleanReason(action: OrderAction, reason: string | undefined): string | null {
  if (!TRANSITIONS[action].reasonRequired) return reason?.trim() || null;
  const parsed = reasonSchema.safeParse(reason ?? "");
  if (!parsed.success) throw new StateError<TransitionError>("reason_required");
  return parsed.data;
}

function assertSupplierCanAct(ctx: OrgCtx) {
  if (ctx.orgType !== "supplier") throw new NotFoundError("order");
  if (ctx.orgStatus === "suspended") throw new StateError<TransitionError>("suspended");
}

function isUuid(v: string) {
  return z.uuid().safeParse(v).success;
}

/**
 * Confirms a pending order. `lines` may change confirmed quantities (0 =
 * unavailable); lines not mentioned are confirmed as ordered. Totals are
 * recomputed from the snapshot prices.
 */
export async function confirmOrder(
  ctx: OrgCtx,
  orderId: string,
  lines: { itemId: string; confirmedQtyMilli: number }[],
  note?: string,
): Promise<void> {
  assertSupplierCanAct(ctx);
  if (!isUuid(orderId)) throw new NotFoundError("order");
  await getDb().transaction(async (tx) => {
    const [order] = await tx
      .select({ pricesIncludeVat: orders.pricesIncludeVat })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.supplierOrgId, ctx.orgId)))
      .for("update");
    if (!order) throw new NotFoundError("order");

    await applyTransition(tx, ctx, orderId, "confirm", note?.trim() || null);

    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.lineNo));
    const overrides = new Map(lines.map((l) => [l.itemId, l.confirmedQtyMilli]));
    if ([...overrides.keys()].some((id) => !items.some((i) => i.id === id))) {
      throw new StateError<TransitionError>("invalid_lines");
    }
    if ([...overrides.values()].some((q) => !Number.isSafeInteger(q) || q < 0 || q > 1_000_000_000)) {
      throw new StateError<TransitionError>("invalid_lines");
    }
    const confirmed = items.map((i) => ({ ...i, qty: overrides.get(i.id) ?? i.orderedQtyMilli }));
    if (confirmed.every((i) => i.qty === 0)) throw new StateError<TransitionError>("nothing_confirmed");

    const totals = computeTotals(
      confirmed.map((i) => ({ unitPriceMinor: i.unitPriceMinor, vatRateBp: i.vatRateBp, qtyMilli: i.qty })),
      order.pricesIncludeVat,
    );
    for (const [index, item] of confirmed.entries()) {
      await tx
        .update(orderItems)
        .set({ confirmedQtyMilli: item.qty, lineTotalMinor: totals.lines[index].lineTotalMinor })
        .where(eq(orderItems.id, item.id));
    }
    await tx
      .update(orders)
      .set({ subtotalMinor: totals.subtotalMinor, vatMinor: totals.vatMinor, totalMinor: totals.totalMinor })
      .where(eq(orders.id, orderId));
  });
  deliverAfterResponse(orderId);
}

export async function rejectOrder(ctx: OrgCtx, orderId: string, reason: string): Promise<void> {
  assertSupplierCanAct(ctx);
  if (!isUuid(orderId)) throw new NotFoundError("order");
  const note = cleanReason("reject", reason);
  await getDb().transaction((tx) => applyTransition(tx, ctx, orderId, "reject", note));
  deliverAfterResponse(orderId);
}

export async function markDelivered(ctx: OrgCtx, orderId: string): Promise<void> {
  assertSupplierCanAct(ctx);
  if (!isUuid(orderId)) throw new NotFoundError("order");
  await getDb().transaction((tx) => applyTransition(tx, ctx, orderId, "deliver", null));
  deliverAfterResponse(orderId);
}

export async function cancelBySupplier(ctx: OrgCtx, orderId: string, reason: string): Promise<void> {
  assertSupplierCanAct(ctx);
  if (!isUuid(orderId)) throw new NotFoundError("order");
  const note = cleanReason("supplier_cancel", reason);
  await getDb().transaction((tx) => applyTransition(tx, ctx, orderId, "supplier_cancel", note));
  deliverAfterResponse(orderId);
}

/** Buyers may cancel only while the order is still pending. */
export async function cancelByBuyer(ctx: OrgCtx, orderId: string, reason?: string): Promise<void> {
  if (ctx.orgType !== "buyer") throw new NotFoundError("order");
  if (!isUuid(orderId)) throw new NotFoundError("order");
  const note = cleanReason("buyer_cancel", reason);
  await getDb().transaction((tx) => applyTransition(tx, ctx, orderId, "buyer_cancel", note));
  deliverAfterResponse(orderId);
}
