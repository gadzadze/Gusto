"use server";

import { z } from "zod";
import type { ToolResult } from "@/lib/assistant/snapshots";
import { requireBuyer } from "@/server/auth/guards";
import { runBuyerTool } from "@/server/assistant/buyer-tools";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { voiceOrderEnabled } from "@/server/voice/config";

const input = z.object({ name: z.string().max(40), args: z.unknown() });

/**
 * One lookup for the assistant on behalf of the signed-in buyer. Guarded like any buyer page; the buyer's own context scopes every
 * query, so the assistant sees what the buyer sees by hand. Read only.
 */
export async function runAssistantToolAction(raw: unknown): Promise<ToolResult> {
  const ctx = await requireBuyer();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!voiceOrderEnabled() || ctx.orgStatus !== "active") return { ok: false, error: "not_available" };
  try {
    await consumeRateLimit(RATE_LIMITS.assistantTool, ctx.userId);
  } catch {
    return { ok: false, error: "rate_limited" };
  }
  return runBuyerTool(ctx, parsed.data.name, parsed.data.args);
}
