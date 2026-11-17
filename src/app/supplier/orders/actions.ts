"use server";

import { refresh } from "next/cache";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";
import { addDays, MAX_DELIVERY_DAYS_AHEAD, todayIn } from "@/lib/dates";
import { availableActions, type OrderAction } from "@/lib/orders/transitions";
import { NotFoundError } from "@/server/domain/errors";
import { getOrder } from "@/server/domain/orders/queries";
import { getFormats } from "@/server/i18n/formats";
import { parseQuantityInput } from "@/lib/quantity";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier } from "@/server/auth/guards";
import {
  cancelBySupplier,
  confirmOrder,
  markDelivered,
  rejectOrder,
  type TransitionError,
} from "@/server/domain/orders/transitions";

type Result = { ok: true } | ActionError<TransitionError>;
const id = z.uuid();

const confirmInput = z.object({
  lines: z.array(z.object({ itemId: z.uuid(), qty: z.string().max(20) })).max(500),
  note: z.string().max(500).optional(),
  deliveryDate: z.string().max(10).optional(),
});

/** Confirm with optional quantity changes ("8", "2,5"; "0" = not available). */
export async function confirmOrderAction(orderId: string, raw: unknown): Promise<Result> {
  const ctx = await requireSupplier();
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success || !id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  const lines = parsed.data.lines.map((l) => ({ itemId: l.itemId, confirmedQtyMilli: parseQuantityInput(l.qty) }));
  if (lines.some((l) => l.confirmedQtyMilli === null)) return { ok: false, error: "invalid_lines" };
  return runAction<{ ok: true }, TransitionError>("confirmOrder", async () => {
    await confirmOrder(ctx, orderId, lines as { itemId: string; confirmedQtyMilli: number }[], parsed.data.note, parsed.data.deliveryDate || undefined);
    refresh();
    return { ok: true };
  });
}

export async function rejectOrderAction(orderId: string, reason: string): Promise<Result> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, TransitionError>("rejectOrder", async () => {
    await rejectOrder(ctx, orderId, String(reason ?? ""));
    refresh();
    return { ok: true };
  });
}

export async function deliverOrderAction(orderId: string): Promise<Result> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, TransitionError>("deliverOrder", async () => {
    await markDelivered(ctx, orderId);
    refresh();
    return { ok: true };
  });
}

export async function cancelOrderBySupplierAction(orderId: string, reason: string): Promise<Result> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, TransitionError>("supplierCancel", async () => {
    await cancelBySupplier(ctx, orderId, String(reason ?? ""));
    refresh();
    return { ok: true };
  });
}

/** Everything the review side panel shows, already formatted on the server. */
export type ReviewData = {
  number: number;
  buyerName: string;
  placedAt: string;
  address: string;
  instructions: string | null;
  note: string | null;
  requestedDay: string | null;
  lines: { id: string; name: string; qty: string; price: string; total: string }[];
  totals: { subtotal: string; vat: string; total: string };
  pricesIncludeVat: boolean;
  actions: OrderAction[];
  actionLines: { itemId: string; name: string; orderedQty: string; unit: string }[];
  requestedDate: string | null;
  minDate: string;
  maxDate: string;
};

/** Loads one of this company's orders for the review panel. Another company's order is "not found". */
export async function loadOrderReviewAction(orderId: string): Promise<{ ok: true; data: ReviewData } | { ok: false }> {
  const ctx = await requireSupplier();
  if (!id.safeParse(orderId).success) return { ok: false };
  try {
    const detail = await getOrder(ctx, orderId);
    const fmt = await getFormats();
    const format = await getFormatter();
    const tu = await getTranslations("units");
    const { order, items } = detail;
    const today = todayIn(detail.supplierTimezone);
    const day = (d: string) => format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
    return {
      ok: true,
      data: {
        number: order.number,
        buyerName: order.buyerName,
        placedAt: format.dateTime(order.createdAt, { dateStyle: "medium", timeStyle: "short" }),
        address: `${order.deliveryAddress}, ${order.deliveryCity}`,
        instructions: order.deliveryInstructions,
        note: order.note,
        requestedDay: order.requestedDeliveryDate ? day(order.requestedDeliveryDate) : null,
        lines: items.map((i) => ({
          id: i.id,
          name: i.name,
          qty: `${fmt.input(i.confirmedQtyMilli ?? i.orderedQtyMilli)} ${tu(i.unit)}`,
          price: fmt.money(i.unitPriceMinor, order.currency),
          total: fmt.money(i.lineTotalMinor, order.currency),
        })),
        totals: {
          subtotal: fmt.money(order.subtotalMinor, order.currency),
          vat: fmt.money(order.vatMinor, order.currency),
          total: fmt.money(order.totalMinor, order.currency),
        },
        pricesIncludeVat: order.pricesIncludeVat,
        actions: ctx.orgStatus === "suspended" ? [] : availableActions(order.status, "supplier"),
        actionLines: items.map((i) => ({ itemId: i.id, name: i.name, orderedQty: fmt.input(i.orderedQtyMilli), unit: tu(i.unit) })),
        requestedDate: order.requestedDeliveryDate,
        minDate: today,
        maxDate: addDays(today, MAX_DELIVERY_DAYS_AHEAD),
      },
    };
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false };
    throw error;
  }
}
