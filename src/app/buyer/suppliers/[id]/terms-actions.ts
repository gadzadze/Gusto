"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireBuyer } from "@/server/auth/guards";
import { requestTerms, type ConditionsError } from "@/server/domain/pricing/conditions";

const input = z.object({
  supplierOrgId: z.uuid(),
  method: z.enum(["cash", "transfer"]).nullable(),
  intervalDays: z.number().int().min(0).max(365).nullable(),
});

/** The buyer asks to pay a supplier a certain way. Nothing changes until the supplier approves. */
export async function requestTermsAction(raw: unknown): Promise<{ ok: true } | ActionError<ConditionsError | "invalid">> {
  const ctx = await requireBuyer();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { supplierOrgId, method, intervalDays } = parsed.data;
  return runAction<{ ok: true }, ConditionsError | "invalid">("requestTerms", async () => {
    await requestTerms(ctx, supplierOrgId, { method, intervalDays });
    refresh();
    return { ok: true };
  });
}
