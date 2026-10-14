"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireBuyer } from "@/server/auth/guards";
import { setCartQuantity, type CartError } from "@/server/domain/orders/cart";

const input = z.object({
  supplierOrgId: z.uuid(),
  productId: z.uuid(),
  qtyMilli: z.number().int().min(0).max(1_000_000_000),
});

/** Sets one product's quantity in the cart with that supplier (0 removes it). */
export async function setCartQuantityAction(raw: unknown): Promise<{ ok: true } | ActionError<CartError>> {
  const ctx = await requireBuyer();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, CartError>("setCartQuantity", async () => {
    await setCartQuantity(ctx, parsed.data.supplierOrgId, parsed.data.productId, parsed.data.qtyMilli);
    refresh();
    return { ok: true };
  });
}
