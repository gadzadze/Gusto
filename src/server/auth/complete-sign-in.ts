import "server-only";
import type { User } from "@supabase/supabase-js";
import { ensureProfile } from "@/server/domain/profiles";
import { claimTeamInvites } from "@/server/domain/team/team";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { isEmailAllowed } from "./allow-list";
import { takeNextPath } from "./next-cookie";

/**
 * Shared tail of every sign-in route: check the address is allowed (a second
 * line of defence behind the sign-in form, and the only one for Google), create
 * the profile, pick the destination.
 */
export async function completeSignIn(user: User): Promise<string> {
  const next = await takeNextPath();
  if (!user.email || !(await isEmailAllowed(user.email))) {
    // Not invited (or revoked): end the session before anything is created for them.
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    return "/login?error=not_allowed";
  }
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  await ensureProfile(user.id, fullName);
  // A colleague added by a company owner joins that company now.
  await claimTeamInvites(user.id, user.email);
  return next ?? "/start";
}
