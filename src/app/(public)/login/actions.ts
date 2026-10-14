"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/safe-next";
import { isEmailAllowed } from "@/server/auth/allow-list";
import { rememberNextPath } from "@/server/auth/next-cookie";
import { StateError } from "@/server/domain/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { ensureAuthUser } from "@/server/supabase/admin";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; error: "invalid_email" | "rate_limited" | "not_allowed" | "unknown" };

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", error: "invalid_email" };

  // Link requests are limited per client IP (stored hashed).
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    await consumeRateLimit(RATE_LIMITS.signInRequest, ip, { hash: true });
  } catch (error) {
    if (error instanceof StateError && error.code === "rate_limited") return { status: "error", error: "rate_limited" };
    throw error;
  }

  // Invite-only: unknown addresses get no account and no email.
  const next = safeNextPath(formData.get("next"));
  if (!(await isEmailAllowed(parsed.data, next))) return { status: "error", error: "not_allowed" };
  try {
    // Sign-ups are off in Supabase, so the auth user is created here, by us, for allowed addresses only.
    await ensureAuthUser(parsed.data);
  } catch (error) {
    console.error("[auth] ensureAuthUser failed", { message: error instanceof Error ? error.message : String(error) });
    return { status: "error", error: "unknown" };
  }

  await rememberNextPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${serverEnv().NEXT_PUBLIC_APP_URL}/auth/confirm`,
    },
  });
  if (error) {
    if (error.status === 429) return { status: "error", error: "rate_limited" };
    // Log the code only — never the address or the link.
    console.error("[auth] signInWithOtp failed", { code: error.code, status: error.status });
    return { status: "error", error: "unknown" };
  }
  return { status: "sent", email: parsed.data };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  await rememberNextPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${serverEnv().NEXT_PUBLIC_APP_URL}/auth/callback` },
  });
  if (error || !data.url) {
    console.error("[auth] signInWithOAuth failed", { code: error?.code, status: error?.status });
    redirect("/login?error=auth");
  }
  redirect(data.url);
}
