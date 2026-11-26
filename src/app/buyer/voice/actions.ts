"use server";

import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireBuyer } from "@/server/auth/guards";
import { loadVoiceCatalog } from "@/server/domain/buyer/voice-catalog";
import { StateError } from "@/server/domain/errors";
import { putItemsInCart } from "@/server/domain/orders/cart";
import { getDb } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { and, inArray } from "drizzle-orm";
import { buildLiveSetup, LIVE_MAX_SECONDS, LIVE_MODEL } from "@/lib/voice/live";
import type { CatalogItem, VoiceRef } from "@/lib/voice/order-parse";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { mintLiveToken } from "@/server/voice/gemini";
import { voiceOrderEnabled } from "@/server/voice/config";

export type VoiceError = "not_configured" | "rate_limited" | "no_products" | "pending";

export type BuyerVoiceSession =
  | {
      ok: true;
      token: string;
      setup: ReturnType<typeof buildLiveSetup>;
      items: CatalogItem[];
      refs: Record<string, VoiceRef>;
      suppliers: { name: string; count: number }[];
      maxSeconds: number;
    }
  | ActionError<VoiceError>;

/**
 * Starts a voice session for the signed-in buyer: a one-use token and the opening message for Google's live endpoint. The assistant
 * only ever sees this buyer's orderable product names (no prices, no other business), and it can only propose lines.
 */
export async function startBuyerVoiceAction(): Promise<BuyerVoiceSession> {
  const ctx = await requireBuyer();
  return runAction<BuyerVoiceSession, VoiceError>("startBuyerVoice", async () => {
    if (!voiceOrderEnabled()) throw new StateError<VoiceError>("not_configured");
    if (ctx.orgStatus !== "active") throw new StateError<VoiceError>("pending");
    const catalog = await loadVoiceCatalog(ctx);
    if (catalog.items.length === 0) throw new StateError<VoiceError>("no_products");
    await consumeRateLimit(RATE_LIMITS.voiceBuyer, ctx.userId);
    const model = process.env.GEMINI_LIVE_MODEL || LIVE_MODEL;
    const token = await mintLiveToken(LIVE_MAX_SECONDS + 60);
    return { ok: true as const, token, setup: buildLiveSetup(catalog.items, model, "buyer"), items: catalog.items, refs: catalog.refs, suppliers: catalog.suppliers, maxSeconds: LIVE_MAX_SECONDS };
  });
}

const fillSchema = z.object({
  lines: z.array(z.object({ productId: z.string().uuid(), qtyMilli: z.number().int().positive().max(1_000_000_000) })).min(1).max(100),
});

export type FillResult = { ok: true; added: number; skipped: string[] } | ActionError<VoiceError>;

/**
 * Puts the reviewed lines into the buyer's carts, one cart per supplier. The supplier of each product comes from the database, not from
 * the browser, and `putItemsInCart` re-checks the connection, the assortment and the quantity rules. Nothing is ordered here: the buyer
 * still reviews each cart and sends it through the normal checkout.
 */
export async function fillCartsFromVoiceAction(input: unknown): Promise<FillResult> {
  const ctx = await requireBuyer();
  const parsed = fillSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<FillResult, VoiceError>("fillCartsFromVoice", async () => {
    if (!voiceOrderEnabled()) throw new StateError<VoiceError>("not_configured");
    await consumeRateLimit(RATE_LIMITS.voiceFill, ctx.userId);
    const ids = [...new Set(parsed.data.lines.map((l) => l.productId))];
    const rows = await getDb().select({ id: products.id, supplierOrgId: products.supplierOrgId, name: products.name }).from(products).where(and(inArray(products.id, ids)));
    const info = new Map(rows.map((r) => [r.id, r]));
    const bySupplier = new Map<string, { productId: string; qtyMilli: number; name: string }[]>();
    const skipped: string[] = [];
    for (const line of parsed.data.lines) {
      const row = info.get(line.productId);
      if (!row) continue;
      bySupplier.set(row.supplierOrgId, [...(bySupplier.get(row.supplierOrgId) ?? []), { productId: line.productId, qtyMilli: line.qtyMilli, name: row.name }]);
    }
    let added = 0;
    for (const [supplierOrgId, list] of bySupplier) {
      const result = await putItemsInCart(ctx, supplierOrgId, list);
      added += result.added;
      skipped.push(...result.skipped);
    }
    return { ok: true as const, added, skipped };
  });
}
