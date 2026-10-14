import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { completeSignIn } from "@/server/auth/complete-sign-in";
import { createSupabaseServerClient } from "@/server/supabase/server";

// OAuth (Google) returns here with a PKCE code.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) redirect("/login?error=auth");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth] code exchange failed", { code: error?.code, status: error?.status });
    redirect("/login?error=auth");
  }
  redirect(await completeSignIn(data.user));
}
