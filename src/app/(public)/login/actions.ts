"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/lib/safe-next";
import { completeSignIn } from "@/server/auth/complete-sign-in";
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
  // Signed in: the client navigates (a hard navigation, since "/start" is a Route Handler).
  | { status: "redirect"; to: string }
  | { status: "error"; error: "invalid_email" | "rate_limited" | "not_allowed" | "wrong_credentials" | "unknown" };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * One form, three buttons: "password" signs in with email + password, "link"
 * emails a one-time sign-in link (first sign-in), "reset" emails the same link
 * and lands on the change-password page (forgotten password).
 */
export async function submitLogin(prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const intent = formData.get("intent");
  if (intent === "reset") formData.set("next", "/account/password");
  if (intent === "link" || intent === "reset") return sendMagicLink(prev, formData);
  return signInWithPassword(formData);
}

async function signInWithPassword(formData: FormData): Promise<MagicLinkState> {
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { status: "error", error: "invalid_email" };
  const password = String(formData.get("password") ?? "");
  // The same answer for a wrong password, an unknown address and a revoked one.
  if (!password || password.length > 200) return { status: "error", error: "wrong_credentials" };

  try {
    await consumeRateLimit(RATE_LIMITS.passwordSignIn, await clientIp(), { hash: true });
  } catch (error) {
    if (error instanceof StateError && error.code === "rate_limited") return { status: "error", error: "rate_limited" };
    throw error;
  }

  await rememberNextPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.user) {
    if (error?.status === 429) return { status: "error", error: "rate_limited" };
    return { status: "error", error: "wrong_credentials" };
  }
  // Re-checks the allow-list (revoked people are signed out again) and picks the destination.
  return { status: "redirect", to: await completeSignIn(data.user) };
}

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", error: "invalid_email" };

  // Link requests are limited per client IP (stored hashed).
  try {
    await consumeRateLimit(RATE_LIMITS.signInRequest, await clientIp(), { hash: true });
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
