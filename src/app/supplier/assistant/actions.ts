"use server";

import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { StateError } from "@/server/domain/errors";
import { buildSupplierLiveSetup } from "@/lib/voice/live-supplier";
import { LIVE_MAX_SECONDS, LIVE_MODEL } from "@/lib/voice/live";
import { mintLiveToken } from "@/server/voice/gemini";
import type { ApplyResult, ToolResult } from "@/lib/assistant/snapshots";
import { requireSupplier } from "@/server/auth/guards";
import { applySupplierAction } from "@/server/assistant/supplier-actions";
import { runSupplierTool } from "@/server/assistant/supplier-tools";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { voiceOrderEnabled } from "@/server/voice/config";

const input = z.object({ name: z.string().max(40), args: z.unknown() });

/** One lookup or proposal for the assistant on behalf of the signed-in supplier. Guarded like any supplier page; read only. */
export async function runSupplierToolAction(raw: unknown): Promise<ToolResult> {
  const ctx = await requireSupplier();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!voiceOrderEnabled() || ctx.orgStatus !== "active") return { ok: false, error: "not_available" };
  try {
    await consumeRateLimit(RATE_LIMITS.assistantTool, ctx.userId);
  } catch {
    return { ok: false, error: "rate_limited" };
  }
  return runSupplierTool(ctx, parsed.data.name, parsed.data.args);
}

/** The supplier tapped Confirm on a card: checked again with their own permissions, then the same function the page buttons call. */
export async function applySupplierActionAction(raw: unknown): Promise<ApplyResult> {
  const ctx = await requireSupplier();
  if (!voiceOrderEnabled() || ctx.orgStatus !== "active") return { ok: false, error: "not_available" };
  try {
    await consumeRateLimit(RATE_LIMITS.assistantApply, ctx.userId);
  } catch {
    return { ok: false, error: "rate_limited" };
  }
  return applySupplierAction(ctx, raw);
}

export type SupplierVoiceError = "not_configured" | "rate_limited" | "pending";
export type SupplierVoiceSession =
  | { ok: true; token: string; setup: ReturnType<typeof buildSupplierLiveSetup>; items: never[]; refs: Record<string, never>; maxSeconds: number }
  | ActionError<SupplierVoiceError>;

/** Starts the supplier's assistant: a one-use token and the opening message. The assistant has no data in its prompt; it asks the lookups above. */
export async function startSupplierAssistantAction(): Promise<SupplierVoiceSession> {
  const ctx = await requireSupplier();
  return runAction<SupplierVoiceSession, SupplierVoiceError>("startSupplierAssistant", async () => {
    if (!voiceOrderEnabled()) throw new StateError<SupplierVoiceError>("not_configured");
    if (ctx.orgStatus !== "active") throw new StateError<SupplierVoiceError>("pending");
    await consumeRateLimit(RATE_LIMITS.voiceBuyer, ctx.userId);
    const model = process.env.GEMINI_LIVE_MODEL || LIVE_MODEL;
    const token = await mintLiveToken(LIVE_MAX_SECONDS + 60);
    return { ok: true as const, token, setup: buildSupplierLiveSetup(model), items: [], refs: {}, maxSeconds: LIVE_MAX_SECONDS };
  });
}
