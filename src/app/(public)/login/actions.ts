"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { rememberNextPath } from "@/server/auth/next-cookie";
import { serverEnv } from "@/server/env";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; error: "invalid_email" | "rate_limited" | "unknown" };

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", error: "invalid_email" };

  await rememberNextPath(formData.get("next"));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: true,
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
