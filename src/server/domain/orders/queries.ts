import "server-only";
import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { orderItems, orders, orderStatusHistory, organizations, type Order, type OrderItem, type OrderStatus } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { putItemsInCart } from "./cart";

export const ORDERS_PAGE_SIZE = 20;

export const SUPPLIER_TABS = {
  new: ["pending"],
  confirmed: ["confirmed"],
  done: ["delivered", "rejected", "cancelled"],
} as const satisfies Record<string, readonly OrderStatus[]>;
export type SupplierTab = keyof typeof SUPPLIER_TABS;

export type OrderListItem = Pick<
  Order,
  "id" | "number" | "status" | "buyerName" | "supplierName" | "supplierOrgId" | "currency" | "totalMinor" | "createdAt"
> & { itemCount: number };

const listColumns = {
  id: orders.id,
  number: orders.number,
  status: orders.status,
  buyerName: orders.buyerName,
  supplierName: orders.supplierName,
  supplierOrgId: orders.supplierOrgId,
  currency: orders.currency,
  totalMinor: orders.totalMinor,
  createdAt: orders.createdAt,
};

async function paged(where: SQL | undefined, page: number) {
  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(orders).where(where);
  const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const rows = await db
    .select(listColumns)
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt), desc(orders.number))
    .limit(ORDERS_PAGE_SIZE)
    .offset((current - 1) * ORDERS_PAGE_SIZE);
  const counts = rows.length
    ? await db
        .select({ orderId: orderItems.orderId, n: count() })
        .from(orderItems)
        .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
        .groupBy(orderItems.orderId)
    : [];
  const byOrder = new Map(counts.map((c) => [c.orderId, c.n]));
  return {
    items: rows.map((r) => ({ ...r, itemCount: byOrder.get(r.id) ?? 0 })),
    total,
    page: current,
    pageCount,
  };
}

export async function listSupplierOrders(ctx: OrgCtx, tab: SupplierTab, page = 1) {
  if (ctx.orgType !== "supplier") throw new NotFoundError();
  return paged(and(eq(orders.supplierOrgId, ctx.orgId), inArray(orders.status, [...SUPPLIER_TABS[tab]])), page);
}

export async function countSupplierOrders(ctx: OrgCtx): Promise<Record<SupplierTab, number>> {
  if (ctx.orgType !== "supplier") throw new NotFoundError();
  const rows = await getDb()
    .select({ status: orders.status, n: count() })
    .from(orders)
    .where(eq(orders.supplierOrgId, ctx.orgId))
    .groupBy(orders.status);
  const out: Record<SupplierTab, number> = { new: 0, confirmed: 0, done: 0 };
  for (const r of rows) {
    for (const [tab, statuses] of Object.entries(SUPPLIER_TABS) as [SupplierTab, readonly OrderStatus[]][]) {
      if (statuses.includes(r.status)) out[tab] += r.n;
    }
  }
  return out;
}

export async function listBuyerOrders(ctx: OrgCtx, page = 1, pageSize?: number) {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  if (pageSize) {
    const rows = await getDb()
      .select(listColumns)
      .from(orders)
      .where(eq(orders.buyerOrgId, ctx.orgId))
      .orderBy(desc(orders.createdAt), desc(orders.number))
      .limit(pageSize);
    return { items: rows.map((r) => ({ ...r, itemCount: 0 })), total: rows.length, page: 1, pageCount: 1 };
  }
  return paged(eq(orders.buyerOrgId, ctx.orgId), page);
}

/** Pending and confirmed orders of this buyer, newest first. */
export async function listOpenBuyerOrders(ctx: OrgCtx, limit = 20) {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  return getDb()
    .select(listColumns)
    .from(orders)
    .where(and(eq(orders.buyerOrgId, ctx.orgId), inArray(orders.status, ["pending", "confirmed"])))
    .orderBy(desc(orders.createdAt), desc(orders.number))
    .limit(limit);
}

export type OrderDetail = {
  order: Order;
  items: OrderItem[];
  /** Contact phone of the other organization, for the "send on WhatsApp" buttons. */
  counterpartyPhone: string | null;
  history: { fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string | null; createdAt: Date; byBuyer: boolean }[];
};

/** An order seen from one side. Other organizations get NotFoundError. */
export async function getOrder(ctx: OrgCtx, orderId: string): Promise<OrderDetail> {
  const scope = ctx.orgType === "buyer" ? orders.buyerOrgId : orders.supplierOrgId;
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new NotFoundError("order");
  const db = getDb();
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(scope, ctx.orgId)));
  if (!order) throw new NotFoundError("order");
  const otherOrgId = ctx.orgType === "buyer" ? order.supplierOrgId : order.buyerOrgId;
  const [[other], items, history] = await Promise.all([
    db.select({ phone: organizations.phone }).from(organizations).where(eq(organizations.id, otherOrgId)),
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.lineNo)),
    db
      .select({
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        note: orderStatusHistory.note,
        createdAt: orderStatusHistory.createdAt,
        actorOrgId: orderStatusHistory.actorOrgId,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.createdAt)),
  ]);
  return {
    order,
    items,
    counterpartyPhone: other?.phone ?? null,
    history: history.map(({ actorOrgId, ...h }) => ({ ...h, byBuyer: actorOrgId === order.buyerOrgId })),
  };
}

/**
 * Where `/o/<number>` should go for this viewer: their own side of the
 * order, or null (→ 404) if they are on neither side.
 */
export async function orderLinkTarget(ctx: OrgCtx, number: number): Promise<string | null> {
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const scope = ctx.orgType === "buyer" ? orders.buyerOrgId : orders.supplierOrgId;
  const [row] = await getDb()
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.number, number), eq(scope, ctx.orgId)));
  if (!row) return null;
  return `/${ctx.orgType}/orders/${row.id}`;
}

/**
 * "Order again": puts the order's products back in the cart at the
 * originally ordered quantities. Prices are whatever applies now (the cart
 * always resolves current prices); unavailable products are skipped.
 */
export async function reorder(
  ctx: OrgCtx,
  orderId: string,
): Promise<{ supplierOrgId: string; added: number; skipped: string[] }> {
  if (ctx.orgType !== "buyer") throw new NotFoundError("order");
  const { order, items } = await getOrder(ctx, orderId);
  const withProduct = items.filter((i): i is OrderItem & { productId: string } => i.productId !== null);
  const result = await putItemsInCart(
    ctx,
    order.supplierOrgId,
    withProduct.map((i) => ({ productId: i.productId, qtyMilli: i.orderedQtyMilli, name: i.name })),
  );
  const lost = items.filter((i) => i.productId === null).map((i) => i.name);
  return { supplierOrgId: order.supplierOrgId, added: result.added, skipped: [...result.skipped, ...lost] };
}
