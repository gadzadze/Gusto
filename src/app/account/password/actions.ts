"use server";

import { redirect } from "next/navigation";
import { homePathFor } from "@/server/auth/access";
import { newPasswordSchema } from "@/lib/validation/password";
import { getAccessState } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { profiles } from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { sql } from "drizzle-orm";

export type PasswordState = { error: "too_short" | "too_long" | "mismatch" | "same_password" | "weak" | "unknown" | null };

/**
 * Sets (first sign-in) or changes the signed-in person's own password. The
 * password goes straight to Supabase Auth and is never stored or logged here.
 */
export async function savePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const state = await getAccessState();
  if (!state.signedIn) redirect("/login");

  const parsed = newPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    return { error: code === "too_short" || code === "too_long" || code === "mismatch" ? code : "too_short" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // Codes only: the message can echo policy details, never the password.
    console.error("[auth] updateUser(password) failed", { code: error.code, status: error.status });
    if (error.code === "same_password") return { error: "same_password" };
    if (error.code === "weak_password") return { error: "weak" };
    return { error: "unknown" };
  }

  await getDb().transaction(async (tx) => {
    await tx
      .insert(profiles)
      .values({ id: state.userId, passwordSetAt: new Date() })
      .onConflictDoUpdate({ target: profiles.id, set: { passwordSetAt: sql`now()` } });
    await writeAudit(tx, {
      actorUserId: state.userId,
      action: state.passwordSet ? "auth.password_changed" : "auth.password_set",
      targetType: "profile",
      targetId: state.userId,
    });
  });
  // Not "/start": a Server Action can't client-navigate to a Route Handler. The
  // state was loaded before the password was saved, so mark it as set here.
  redirect(homePathFor({ ...state, passwordSet: true }));
}
