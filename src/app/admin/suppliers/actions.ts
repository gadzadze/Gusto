"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { reviewSupplier, type ReviewError } from "@/server/domain/admin/suppliers";

const inputSchema = z.object({
  orgId: z.uuid(),
  action: z.enum(["approve", "suspend", "reactivate"]),
  reason: z.string().max(500).optional(),
});

export async function reviewSupplierAction(raw: unknown): Promise<{ ok: true } | ActionError<ReviewError>> {
  const ctx = await requireAdmin();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, ReviewError>("reviewSupplier", async () => {
    await reviewSupplier(ctx, parsed.data.orgId, parsed.data.action, parsed.data.reason);
    refresh();
    return { ok: true };
  });
}
