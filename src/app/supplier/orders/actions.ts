"use server";

import { refresh } from "next/cache";
import { z } from "zod";
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
});

/** Confirm with optional quantity changes ("8", "2,5"; "0" = not available). */
export async function confirmOrderAction(orderId: string, raw: unknown): Promise<Result> {
  const ctx = await requireSupplier();
  const parsed = confirmInput.safeParse(raw);
  if (!parsed.success || !id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  const lines = parsed.data.lines.map((l) => ({ itemId: l.itemId, confirmedQtyMilli: parseQuantityInput(l.qty) }));
  if (lines.some((l) => l.confirmedQtyMilli === null)) return { ok: false, error: "invalid_lines" };
  return runAction<{ ok: true }, TransitionError>("confirmOrder", async () => {
    await confirmOrder(ctx, orderId, lines as { itemId: string; confirmedQtyMilli: number }[], parsed.data.note);
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
