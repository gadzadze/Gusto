"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { reviewSupplierRequest, type RequestError } from "@/server/domain/admin/supplier-requests";
import { ensureAuthUser } from "@/server/supabase/admin";

const inputSchema = z.object({
  id: z.uuid(),
  action: z.enum(["contacted", "approve", "reject"]),
  note: z.string().max(500).optional(),
});

export type ReviewRequestResult = { ok: true; authUserFailed?: boolean } | ActionError<RequestError>;

export async function reviewRequestAction(raw: unknown): Promise<ReviewRequestResult> {
  const ctx = await requireAdmin();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<ReviewRequestResult, RequestError>("reviewRequest", async () => {
    const { email } = await reviewSupplierRequest(ctx, parsed.data.id, parsed.data.action, parsed.data.note);
    let authUserFailed = false;
    if (parsed.data.action === "approve") {
      // Best effort, as when registering an address: the sign-in action creates the user if this fails.
      authUserFailed = await ensureAuthUser(email).then(
        () => false,
        () => true,
      );
    }
    refresh();
    return { ok: true, authUserFailed };
  });
}
