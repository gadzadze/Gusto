"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { parseBulkAccess } from "@/lib/access/bulk";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireAdmin } from "@/server/auth/guards";
import { registerEmail } from "@/server/auth/register-email";
import { revokeEmail, allowEmail, type AccessError } from "@/server/domain/admin/access";
import { sendWelcomeEmail } from "@/server/auth/welcome-email";
import { ensureAuthUser } from "@/server/supabase/admin";

export type AllowActionResult =
  | { ok: true; status: "allowed" | "restored" | "updated" | "already_allowed"; authUserFailed: boolean; welcome: "sent" | "skipped" | "failed" | "none" }
  | ActionError<AccessError>;

const allowSchema = z.object({
  email: z.string().max(254),
  note: z.string().max(200).optional(),
  // "" = either.
  role: z.enum(["", "buyer", "supplier"]).optional(),
  // Both or neither: together they mean "I verified this business".
  businessName: z.string().max(160).optional(),
  legalId: z.string().max(40).optional(),
});

export async function allowEmailAction(raw: unknown): Promise<AllowActionResult> {
  const ctx = await requireAdmin();
  const parsed = allowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const businessName = parsed.data.businessName?.trim() ?? "";
  const legalId = parsed.data.legalId?.trim() ?? "";
  if (Boolean(businessName) !== Boolean(legalId)) return { ok: false, error: "invalid" };
  return runAction<AllowActionResult, AccessError>("allowEmail", async () => {
    const result = await registerEmail(
      { userId: ctx.userId },
      parsed.data.email,
      parsed.data.note,
      parsed.data.role === undefined ? undefined : parsed.data.role === "" ? null : parsed.data.role,
      businessName ? { businessName, legalId } : undefined,
    );
    refresh();
    return { ok: true, status: result.status, authUserFailed: result.authUser === "failed", welcome: result.welcome };
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
    await sendWelcomeEmail(email.trim().toLowerCase());
    refresh();
    return { ok: true };
  });
}

export type BulkResult =
  | {
      ok: true;
      /** One outcome per input line that passed parsing, in order. */
      results: { line: number; email: string; outcome: "allowed" | "restored" | "updated" | "already_allowed" | "error"; error?: string; welcome?: "sent" | "skipped" | "failed" | "none" }[];
      parseErrors: { line: number; key: "columns" | "role" | "name_or_id" }[];
      tooMany: boolean;
    }
  | ActionError<AccessError>;

/** Adds many addresses at once (one line each); every line is independent and audited like a single add. */
export async function bulkAllowAction(text: string): Promise<BulkResult> {
  const ctx = await requireAdmin();
  if (typeof text !== "string" || text.length > 20_000) return { ok: false, error: "invalid" };
  const { entries, errors, tooMany } = parseBulkAccess(text);
  if (entries.length === 0 && errors.length === 0) return { ok: false, error: "invalid" };
  const results: Extract<BulkResult, { ok: true }>["results"] = [];
  for (const entry of entries) {
    const outcome = await runAction<AllowActionResult, AccessError>("bulkAllowEmail", async () => {
      const r = await registerEmail(
        { userId: ctx.userId },
        entry.email,
        undefined,
        entry.role === "" ? undefined : entry.role,
        entry.businessName ? { businessName: entry.businessName, legalId: entry.legalId } : undefined,
      );
      return { ok: true, status: r.status, authUserFailed: r.authUser === "failed", welcome: r.welcome };
    });
    results.push(
      outcome.ok
        ? { line: entry.line, email: entry.email, outcome: outcome.status, welcome: outcome.welcome }
        : { line: entry.line, email: entry.email, outcome: "error", error: outcome.error },
    );
  }
  refresh();
  return { ok: true, results, parseErrors: errors, tooMany };
}
