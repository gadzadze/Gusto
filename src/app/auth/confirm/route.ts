import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/server/auth/complete-sign-in";
import { createSupabaseServerClient } from "@/server/supabase/server";

// Magic links land here. The Supabase email templates must point at
// {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// (README, "Supabase Auth setup"). Verifying the token hash server-side works
// even when the link is opened in a different browser than the one that
// requested it.
//
// Links Gusto makes itself (welcome email, "set or reset password", the admin's
// hand-over) point at /auth/continue instead, a page with one button that POSTs
// here: GET verifies at once, so anything that merely fetches the URL (a WhatsApp
// or mail link preview) would use up the one-time token before the person opens it.
const ALLOWED_TYPES: ReadonlySet<EmailOtpType> = new Set(["email", "magiclink", "signup"]);

async function verify(tokenHash: string | null, type: string | null): Promise<string> {
  if (!tokenHash || !type || !ALLOWED_TYPES.has(type as EmailOtpType)) return "/login?error=auth";
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
  if (error || !data.user) {
    console.error("[auth] verifyOtp failed", { code: error?.code, status: error?.status });
    return "/login?error=auth";
  }
  return completeSignIn(data.user);
}

export async function GET(request: NextRequest) {
  redirect(await verify(request.nextUrl.searchParams.get("token_hash"), request.nextUrl.searchParams.get("type")));
}

/** The button on /auth/continue. 303 so the browser follows with a GET, not another POST. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const field = (name: string) => (typeof form.get(name) === "string" ? (form.get(name) as string) : null);
  const path = await verify(field("token_hash"), field("type"));
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
}
