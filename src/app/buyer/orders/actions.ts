"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireBuyer } from "@/server/auth/guards";
import { reorder } from "@/server/domain/orders/queries";
import { cancelByBuyer, type TransitionError } from "@/server/domain/orders/transitions";

const id = z.uuid();

export async function cancelOrderAction(orderId: string): Promise<{ ok: true } | ActionError<TransitionError>> {
  const ctx = await requireBuyer();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, TransitionError>("buyerCancel", async () => {
    await cancelByBuyer(ctx, orderId);
    refresh();
    return { ok: true };
  });
}

/** "Order again": copies the order into the cart at current prices, then opens the cart. */
export async function reorderAction(orderId: string): Promise<ActionError<never>> {
  const ctx = await requireBuyer();
  if (!id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  let target: string | null = null;
  const result = await runAction<{ ok: true }, never>("reorder", async () => {
    const r = await reorder(ctx, orderId);
    const search = new URLSearchParams({ reordered: String(r.added) });
    if (r.skipped.length) search.set("skipped", r.skipped.join("|"));
    target = `/buyer/cart?${search.toString()}#${r.supplierOrgId}`;
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect(target!);
}
