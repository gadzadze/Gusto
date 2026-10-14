import "server-only";
import type { User } from "@supabase/supabase-js";
import { ensureProfile } from "@/server/domain/profiles";
import { takeNextPath } from "./next-cookie";

/** Shared tail of every sign-in route: create the profile, pick the destination. */
export async function completeSignIn(user: User): Promise<string> {
  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  await ensureProfile(user.id, fullName);
  return (await takeNextPath()) ?? "/start";
}
