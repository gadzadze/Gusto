"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { reviewBuyer } from "@/server/domain/admin/organizations";
import type { ReviewError } from "@/server/domain/admin/suppliers";

const inputSchema = z.object({
  orgId: z.uuid(),
  action: z.enum(["suspend", "reactivate"]),
  reason: z.string().max(500).optional(),
});

export async function reviewBuyerAction(raw: unknown): Promise<{ ok: true } | ActionError<ReviewError>> {
  const ctx = await requireAdmin();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ReviewError>("reviewBuyer", async () => {
    await reviewBuyer(ctx, parsed.data.orgId, parsed.data.action, parsed.data.reason);
    refresh();
    return { ok: true };
  });
}
