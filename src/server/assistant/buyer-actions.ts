import "server-only";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { ApplyResult } from "@/lib/assistant/snapshots";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { setCartQuantity } from "@/server/domain/orders/cart";
import { reorder } from "@/server/domain/orders/queries";
import { createRegularOrderFromOrder } from "@/server/domain/orders/regular";

// The changes a buyer can confirm on a card. Each calls the very function the matching button calls, with the buyer's own context, so
// every rule (connection, availability, step and minimum, limits) is checked again here no matter what the browser sent.

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cart_set"), supplierId: uuid, productId: uuid, qtyMilli: z.number().int().min(0).max(1_000_000_000) }),
  z.object({ type: z.literal("reorder"), orderId: uuid }),
  z.object({ type: z.literal("regular_create"), orderId: uuid, weekday: z.number().int().min(1).max(7), name: z.string().trim().min(1).max(80) }),
]);

export async function applyBuyerAction(ctx: OrgCtx, raw: unknown): Promise<ApplyResult> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const t = await getTranslations("buyer.assistant.applied");
  const action = parsed.data;
  try {
    switch (action.type) {
      case "cart_set":
        await setCartQuantity(ctx, action.supplierId, action.productId, action.qtyMilli);
        return { ok: true, message: action.qtyMilli === 0 ? t("cartRemoved") : t("cartSet"), href: "/buyer/cart" };
      case "reorder": {
        const result = await reorder(ctx, action.orderId);
        return { ok: true, message: result.skipped.length > 0 ? t("reorderSkipped", { added: result.added, skipped: result.skipped.join(", ") }) : t("reorder", { added: result.added }), href: "/buyer/cart" };
      }
      case "regular_create":
        await createRegularOrderFromOrder(ctx, action.orderId, { name: action.name, weekday: action.weekday });
        return { ok: true, message: t("regular"), href: "/buyer/regular" };
    }
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "not_found" };
    if (error instanceof StateError) return { ok: false, error: error.code };
    console.error("assistant action failed:", action.type, error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}
