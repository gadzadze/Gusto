"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireBuyer } from "@/server/auth/guards";
import {
  createRegularOrderFromOrder,
  deleteRegularOrder,
  loadRegularOrderIntoCart,
  regularOrderInputSchema,
  type RegularOrderError,
} from "@/server/domain/orders/regular";

type Err = ActionError<RegularOrderError>;
const id = z.uuid();

export async function saveRegularOrderAction(orderId: string, raw: unknown): Promise<{ ok: true } | Err> {
  const ctx = await requireBuyer();
  const parsed = regularOrderInputSchema.safeParse(raw);
  if (!parsed.success || !id.safeParse(orderId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, RegularOrderError>("saveRegularOrder", async () => {
    await createRegularOrderFromOrder(ctx, orderId, parsed.data);
    refresh();
    return { ok: true };
  });
}

export async function deleteRegularOrderAction(regularId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireBuyer();
  if (!id.safeParse(regularId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, RegularOrderError>("deleteRegularOrder", async () => {
    await deleteRegularOrder(ctx, regularId);
    refresh();
    return { ok: true };
  });
}

/** Puts the regular order in the cart at current prices, then opens the cart (like "order again"). */
export async function loadRegularOrderAction(regularId: string): Promise<Err> {
  const ctx = await requireBuyer();
  if (!id.safeParse(regularId).success) return { ok: false, error: "invalid" };
  let target: string | null = null;
  const result = await runAction<{ ok: true }, RegularOrderError>("loadRegularOrder", async () => {
    const r = await loadRegularOrderIntoCart(ctx, regularId);
    const search = new URLSearchParams({ reordered: String(r.added) });
    if (r.skipped.length) search.set("skipped", r.skipped.join("|"));
    target = `/buyer/cart?${search.toString()}#${r.supplierOrgId}`;
    return { ok: true };
  });
  if (!result.ok) return result;
  redirect(target!);
}
