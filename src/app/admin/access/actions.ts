"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { registerEmail } from "@/server/auth/register-email";
import { revokeEmail, allowEmail, type AccessError } from "@/server/domain/admin/access";
import { ensureAuthUser } from "@/server/supabase/admin";

export type AllowActionResult =
  | { ok: true; status: "allowed" | "restored" | "already_allowed"; authUserFailed: boolean }
  | ActionError<AccessError>;

const allowSchema = z.object({ email: z.string().max(254), note: z.string().max(200).optional() });

export async function allowEmailAction(raw: unknown): Promise<AllowActionResult> {
  const ctx = await requireAdmin();
  const parsed = allowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return runAction<AllowActionResult, AccessError>("allowEmail", async () => {
    const result = await registerEmail({ userId: ctx.userId }, parsed.data.email, parsed.data.note);
    refresh();
    return { ok: true, status: result.status, authUserFailed: result.authUser === "failed" };
  });
}

export async function revokeEmailAction(id: string): Promise<{ ok: true } | ActionError<AccessError>> {
  const ctx = await requireAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, AccessError>("revokeEmail", async () => {
    await revokeEmail(ctx, id);
    refresh();
    return { ok: true };
  });
}

/** Lifts a revocation: same as allowing the address again. */
export async function restoreEmailAction(email: string): Promise<{ ok: true } | ActionError<AccessError>> {
  const ctx = await requireAdmin();
  return runAction<{ ok: true }, AccessError>("restoreEmail", async () => {
    await allowEmail({ userId: ctx.userId }, email);
    // Best effort, as in registerEmail: the sign-in action creates the user if this fails.
    await ensureAuthUser(email.trim().toLowerCase()).catch(() => undefined);
    refresh();
    return { ok: true };
  });
}
