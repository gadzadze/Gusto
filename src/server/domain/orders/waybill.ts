import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { computeTotals } from "@/lib/orders/totals";
import { getDb } from "@/server/db/client";
import { orderItems, orders, organizations, products, type OrderStatus } from "@/server/db/schema";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";

// Phase 1 of e-waybills: the supplier gets a sheet with everything 202 already knows about one confirmed
// order, in the order a waybill asks for it, to copy into the RS.ge portal. 202 sends nothing to RS.ge
// and stores nothing about the waybill. Seller side only; other organizations get NotFoundError.

const SHEET_STATUSES: readonly OrderStatus[] = ["confirmed", "delivered"];

export type WaybillLine = {
  lineNo: number;
  name: string;
  /** The supplier's product code, else the barcode. */
  code: string | null;
  unit: string;
  qtyMilli: number;
  unitPriceMinor: number;
  vatRateBp: number;
  lineTotalMinor: number;
  lineVatMinor: number;
};

export type WaybillSheet = {
  orderId: string;
  number: number;
  status: OrderStatus;
  currency: string;
  pricesIncludeVat: boolean;
  seller: { name: string; legalId: string | null; city: string };
  buyer: { name: string; legalId: string | null };
  deliveryAddress: string;
  deliveryCity: string;
  deliveryInstructions: string | null;
  note: string | null;
  /** The day agreed when confirming ("YYYY-MM-DD"), else null. */
  deliveryDate: string | null;
  lines: WaybillLine[];
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
};

export async function getWaybillSheet(ctx: OrgCtx, orderId: string): Promise<WaybillSheet> {
  assertSupplier(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new NotFoundError("order");
  const db = getDb();
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.supplierOrgId, ctx.orgId), inArray(orders.status, [...SHEET_STATUSES])));
  if (!order) throw new NotFoundError("order");
  const [[seller], [buyer], items] = await Promise.all([
    db.select({ legalId: organizations.legalId, city: organizations.city }).from(organizations).where(eq(organizations.id, order.supplierOrgId)),
    db.select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, order.buyerOrgId)),
    db
      .select({ item: orderItems, barcode: products.barcode })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.lineNo)),
  ]);
  // What goes out is what the supplier confirmed: lines at 0 ("unavailable") are not shipped.
  const shipped = items.filter((row) => (row.item.confirmedQtyMilli ?? 0) > 0);
  const totals = computeTotals(
    shipped.map((row) => ({ unitPriceMinor: row.item.unitPriceMinor, vatRateBp: row.item.vatRateBp, qtyMilli: row.item.confirmedQtyMilli ?? 0 })),
    order.pricesIncludeVat,
  );
  return {
    orderId: order.id,
    number: order.number,
    status: order.status,
    currency: order.currency,
    pricesIncludeVat: order.pricesIncludeVat,
    seller: { name: order.supplierName, legalId: seller?.legalId ?? null, city: seller?.city ?? "" },
    buyer: { name: order.buyerName, legalId: buyer?.legalId ?? null },
    deliveryAddress: order.deliveryAddress,
    deliveryCity: order.deliveryCity,
    deliveryInstructions: order.deliveryInstructions,
    note: order.note,
    deliveryDate: order.deliveryDate,
    lines: shipped.map((row, index) => ({
      lineNo: index + 1,
      name: row.item.name,
      code: row.item.sku ?? row.barcode ?? null,
      unit: row.item.unit,
      qtyMilli: row.item.confirmedQtyMilli ?? 0,
      unitPriceMinor: row.item.unitPriceMinor,
      vatRateBp: row.item.vatRateBp,
      lineTotalMinor: totals.lines[index].lineTotalMinor,
      lineVatMinor: totals.lines[index].vatMinor,
    })),
    subtotalMinor: totals.subtotalMinor,
    vatMinor: totals.vatMinor,
    totalMinor: totals.totalMinor,
  };
}
