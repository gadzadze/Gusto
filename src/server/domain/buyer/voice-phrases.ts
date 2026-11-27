import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { MAX_HINTS_PER_PRODUCT, MAX_PHRASES_PER_BUYER, phraseToLearn } from "@/lib/voice/phrases";
import { getDb } from "@/server/db/client";
import { buyerVoicePhrases, products } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError } from "@/server/domain/errors";
import { availableToBuyerSql } from "@/server/domain/pricing/resolve";

/**
 * Remembers how this buyer names the products they just sent to the cart. Only products this buyer may order are accepted (the
 * product id came from the browser), the phrase must pass `phraseToLearn`, and the table is capped per buyer (least recently used
 * go first). Plain text of the buyer's own words: no audio, no transcript, never another business's data.
 */
export async function recordVoicePhrases(ctx: OrgCtx, lines: { productId: string; productName: string; phrase: string | null | undefined }[]): Promise<number> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const wanted = lines.flatMap((l) => {
    const phrase = phraseToLearn(l.phrase, l.productName);
    return phrase ? [{ productId: l.productId, phrase }] : [];
  });
  if (wanted.length === 0) return 0;
  const db = getDb();
  const allowed = await db
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, [...new Set(wanted.map((w) => w.productId))]), eq(products.isActive, true), availableToBuyerSql(ctx.orgId)));
  const ok = new Set(allowed.map((r) => r.id));
  const rows = wanted.filter((w) => ok.has(w.productId));
  if (rows.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(buyerVoicePhrases)
        .values({ buyerOrgId: ctx.orgId, productId: row.productId, phrase: row.phrase })
        .onConflictDoUpdate({
          target: [buyerVoicePhrases.buyerOrgId, buyerVoicePhrases.productId, buyerVoicePhrases.phrase],
          set: { uses: sql`${buyerVoicePhrases.uses} + 1`, lastUsedAt: sql`now()` },
        });
    }
    await tx.execute(sql`
      delete from buyer_voice_phrases where id in (
        select id from buyer_voice_phrases where buyer_org_id = ${ctx.orgId}
        order by last_used_at desc offset ${MAX_PHRASES_PER_BUYER}
      )`);
  });
  return rows.length;
}

/** The remembered phrases of this buyer, most used first, a few per product, keyed by real product id. */
export async function voicePhrasesByProduct(ctx: OrgCtx, productIds: string[]): Promise<Map<string, string[]>> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const out = new Map<string, string[]>();
  if (productIds.length === 0) return out;
  const rows = await getDb()
    .select({ productId: buyerVoicePhrases.productId, phrase: buyerVoicePhrases.phrase })
    .from(buyerVoicePhrases)
    .where(and(eq(buyerVoicePhrases.buyerOrgId, ctx.orgId), inArray(buyerVoicePhrases.productId, productIds)))
    .orderBy(desc(buyerVoicePhrases.uses), desc(buyerVoicePhrases.lastUsedAt));
  for (const r of rows) {
    const list = out.get(r.productId) ?? [];
    if (list.length < MAX_HINTS_PER_PRODUCT) out.set(r.productId, [...list, r.phrase]);
  }
  return out;
}

/** Forgets everything this buyer organization taught the assistant. */
export async function clearVoicePhrases(ctx: OrgCtx): Promise<void> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  await getDb().delete(buyerVoicePhrases).where(eq(buyerVoicePhrases.buyerOrgId, ctx.orgId));
}
