import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { orderItems, orders, orderStatusHistory } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import type { OrderDetail } from "@/server/domain/orders/queries";

/**
 * Support lookup of one order by its GST- number: read-only, and every view is
 * written to the audit log (who, which order). Returns the same shape the
 * buyer and supplier pages render. The audit row is written in the same
 * transaction as the read, so there is no unaudited view.
 */
export async function viewOrderForAdmin(ctx: AdminCtx, number: number): Promise<OrderDetail> {
  assertAdmin(ctx);
  if (!Number.isSafeInteger(number) || number <= 0) throw new NotFoundError("order");
  return getDb().transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.number, number));
    if (!order) throw new NotFoundError("order");
    const [items, history] = await Promise.all([
      tx.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.lineNo)),
      tx
        .select({
          fromStatus: orderStatusHistory.fromStatus,
          toStatus: orderStatusHistory.toStatus,
          note: orderStatusHistory.note,
          createdAt: orderStatusHistory.createdAt,
          actorOrgId: orderStatusHistory.actorOrgId,
        })
        .from(orderStatusHistory)
        .where(eq(orderStatusHistory.orderId, order.id))
        .orderBy(asc(orderStatusHistory.createdAt)),
    ]);
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: "order.view",
      targetType: "order",
      targetId: order.id,
      data: { number: order.number },
    });
    return {
      order,
      items,
      counterpartyPhone: null,
      history: history.map(({ actorOrgId, ...h }) => ({ ...h, byBuyer: actorOrgId === order.buyerOrgId })),
    };
  });
}
