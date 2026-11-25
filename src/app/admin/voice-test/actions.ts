"use server";

import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { MAX_CATALOG_CHARS, MAX_CATALOG_LINES, normalizeResult, parseCatalog, type ParsedLine } from "@/lib/voice/order-parse";
import { looksLikeWav, MAX_WAV_BYTES } from "@/lib/voice/wav";
import { StateError } from "@/server/domain/errors";
import { getFormats } from "@/server/i18n/formats";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { callGeminiForOrder, geminiConfigured } from "@/server/voice/gemini";

export type VoiceTestError = "not_configured" | "rate_limited" | "too_large" | "bad_audio" | "bad_catalog" | "upstream";

export type VoiceTestLine = ParsedLine & { qtyText: string | null };

export type VoiceTestResult =
  | {
      ok: true;
      transcript: string;
      lines: VoiceTestLine[];
      deliveryDay: string | null;
      questions: string[];
      model: string;
      ms: number;
      promptTokens: number | null;
      outputTokens: number | null;
    }
  | ActionError<VoiceTestError>;

const catalogSchema = z.string().max(MAX_CATALOG_CHARS);

/**
 * Experiment: a spoken order (WAV from the browser) plus a pasted made-up catalogue goes to Gemini,
 * and the proposed lines come back for the tester to read. Admin only, rate limited, and it never
 * touches a real catalogue, a cart or an order.
 */
export async function parseVoiceOrderAction(formData: FormData): Promise<VoiceTestResult> {
  const ctx = await requireAdmin();
  const audio = formData.get("audio");
  const catalog = catalogSchema.safeParse(formData.get("catalog"));
  if (!(audio instanceof File) || !catalog.success) return { ok: false, error: "invalid" };
  return runAction<VoiceTestResult, VoiceTestError>("parseVoiceOrder", async () => {
    if (!geminiConfigured()) throw new StateError<VoiceTestError>("not_configured");
    if (audio.size > MAX_WAV_BYTES) throw new StateError<VoiceTestError>("too_large");
    const wav = new Uint8Array(await audio.arrayBuffer());
    if (!looksLikeWav(wav)) throw new StateError<VoiceTestError>("bad_audio");
    const { items, badLines } = parseCatalog(catalog.data);
    if (items.length === 0 || items.length > MAX_CATALOG_LINES || badLines.length > 0) throw new StateError<VoiceTestError>("bad_catalog");
    await consumeRateLimit(RATE_LIMITS.voiceTest, ctx.userId);
    const call = await callGeminiForOrder(wav, items);
    const parsed = normalizeResult(call.raw, items);
    const formats = await getFormats();
    return {
      ok: true as const,
      transcript: parsed.transcript,
      lines: parsed.lines.map((l) => ({ ...l, qtyText: l.quantityMilli === null ? null : formats.qty(l.quantityMilli) })),
      deliveryDay: parsed.deliveryDay,
      questions: parsed.questions,
      model: call.model,
      ms: call.ms,
      promptTokens: call.usage.promptTokens,
      outputTokens: call.usage.outputTokens,
    };
  });
}
