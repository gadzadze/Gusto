import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { completeSignIn } from "@/server/auth/complete-sign-in";
import { createSupabaseServerClient } from "@/server/supabase/server";

// Magic links land here. The Supabase email templates must point at
// {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// (README, "Supabase Auth setup"). Verifying the token hash server-side works
// even when the link is opened in a different browser than the one that
// requested it.
const ALLOWED_TYPES: ReadonlySet<EmailOtpType> = new Set(["email", "magiclink", "signup"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (!tokenHash || !type || !ALLOWED_TYPES.has(type)) redirect("/login?error=auth");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    console.error("[auth] verifyOtp failed", { code: error?.code, status: error?.status });
    redirect("/login?error=auth");
  }
  redirect(await completeSignIn(data.user));
}
