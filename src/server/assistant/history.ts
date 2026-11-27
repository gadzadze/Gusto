import "server-only";
import { sql } from "drizzle-orm";
import { HISTORY_ORDERS, type HistoryOrder } from "@/lib/assistant/history";
import { getDb } from "@/server/db/client";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";

/**
 * The buyer's last few orders per supplier (not cancelled or rejected) with their lines, newest first. Only this buyer's own orders;
 * lines whose product has since been deleted are left out.
 */
export async function loadOrderHistory(ctx: OrgCtx): Promise<Map<string, HistoryOrder[]>> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const rows = (await getDb().execute(sql`
    with recent as (
      select o.id, o.supplier_org_id, o.created_at,
             row_number() over (partition by o.supplier_org_id order by o.created_at desc) as rn
      from orders o
      where o.buyer_org_id = ${ctx.orgId} and o.status in ('pending', 'confirmed', 'delivered')
    )
    select r.supplier_org_id as supplier_id, r.id as order_id, r.created_at as at, oi.product_id, oi.ordered_qty_milli as qty
    from recent r
    join order_items oi on oi.order_id = r.id
    where r.rn <= ${HISTORY_ORDERS} and oi.product_id is not null
    order by r.created_at desc, oi.line_no asc
  `)) as unknown as { supplier_id: string; order_id: string; at: Date | string; product_id: string; qty: number }[];
  const out = new Map<string, HistoryOrder[]>();
  const orderIndex = new Map<string, HistoryOrder>();
  for (const r of rows) {
    let order = orderIndex.get(r.order_id);
    if (!order) {
      order = { at: new Date(r.at), lines: [] };
      orderIndex.set(r.order_id, order);
      out.set(r.supplier_id, [...(out.get(r.supplier_id) ?? []), order]);
    }
    order.lines.push({ productId: r.product_id, qtyMilli: Number(r.qty) });
  }
  return out;
}
