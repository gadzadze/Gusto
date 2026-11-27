import "server-only";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { ApplyResult } from "@/lib/assistant/snapshots";
import type { ProductValues } from "@/lib/validation/product";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { bulkSetActive, getSupplierProduct, updateProduct } from "@/server/domain/catalog/products";
import { confirmOrder, markDelivered, rejectOrder } from "@/server/domain/orders/transitions";

// The changes a supplier can confirm on a card. Each calls the function the matching button calls, with the supplier's own context, so
// every rule (status, ownership, stock, rate limits) is checked again here whatever the browser sent. Orders are confirmed as ordered
// (every line at its ordered quantity); changing quantities or the delivery day stays in the order's own screen.

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("orders_confirm"), orderIds: z.array(uuid).min(1).max(20) }),
  z.object({ type: z.literal("order_reject"), orderId: uuid, reason: z.string().trim().min(3).max(500) }),
  z.object({ type: z.literal("orders_deliver"), orderIds: z.array(uuid).min(1).max(20) }),
  z.object({ type: z.literal("products_active"), productIds: z.array(uuid).min(1).max(50), active: z.boolean() }),
  z.object({ type: z.literal("product_price"), productId: uuid, priceMinor: z.number().int().min(0).max(100_000_000) }),
]);

export async function applySupplierAction(ctx: OrgCtx, raw: unknown): Promise<ApplyResult> {
  if (ctx.orgType !== "supplier") throw new NotFoundError();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const t = await getTranslations("supplierAssistant.applied");
  const action = parsed.data;
  try {
    switch (action.type) {
      case "orders_confirm":
        return await eachOrder(action.orderIds, (id) => confirmOrder(ctx, id, []), (done) => t("confirmed", { count: done }), t, "/supplier/orders");
      case "orders_deliver":
        return await eachOrder(action.orderIds, (id) => markDelivered(ctx, id), (done) => t("delivered", { count: done }), t, "/supplier/orders");
      case "order_reject":
        await rejectOrder(ctx, action.orderId, action.reason);
        return { ok: true, message: t("rejected"), href: "/supplier/orders" };
      case "products_active": {
        const changed = await bulkSetActive(ctx, action.productIds, action.active);
        return { ok: true, message: action.active ? t("shown", { count: changed }) : t("hidden", { count: changed }), href: "/supplier/products" };
      }
      case "product_price": {
        const p = await getSupplierProduct(ctx, action.productId);
        const values: ProductValues = {
          name: p.name,
          description: p.description ?? null,
          brand: p.brand ?? null,
          sku: p.sku ?? null,
          barcode: p.barcode ?? null,
          categoryId: p.categoryId,
          unit: p.unit,
          packDescription: p.packDescription ?? null,
          basePrice: action.priceMinor,
          vatRate: p.vatRateBp,
          minQty: p.minQtyMilli,
          qtyStep: p.qtyStepMilli,
          stock: p.stockMilli,
        } as ProductValues;
        await updateProduct(ctx, p.id, values);
        return { ok: true, message: t("price"), href: `/supplier/products/${p.id}` };
      }
    }
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "not_found" };
    if (error instanceof StateError) return { ok: false, error: error.code };
    console.error("supplier assistant action failed:", action.type, error instanceof Error ? error.message : "unknown");
    return { ok: false, error: "failed" };
  }
}

/** One by one (each its own transaction): an order someone else already answered is skipped and reported, the rest still go through. */
async function eachOrder(
  ids: string[],
  run: (id: string) => Promise<void>,
  done: (count: number) => string,
  t: Awaited<ReturnType<typeof getTranslations>>,
  href: string,
): Promise<ApplyResult> {
  let ok = 0;
  let skipped = 0;
  for (const id of new Set(ids)) {
    try {
      await run(id);
      ok += 1;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof StateError) skipped += 1;
      else throw error;
    }
  }
  if (ok === 0) return { ok: false, error: "stale_status" };
  return { ok: true, message: skipped > 0 ? `${done(ok)} ${t("skipped", { count: skipped })}` : done(ok), href };
}
