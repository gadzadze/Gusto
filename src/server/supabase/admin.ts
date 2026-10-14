import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv, serviceRoleKey } from "@/server/env";

// Service-role client for Supabase Auth admin calls. Server only: it can do
// anything to any user. Request-bound sign-in uses supabase/server.ts instead.

function adminClient() {
  return createClient(serverEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Makes sure an auth user exists for this address (confirmed, so a sign-in link
 * works at once). Needed because sign-ups are switched off in Supabase: only
 * users we create can sign in. Idempotent.
 */
export async function ensureAuthUser(email: string): Promise<"created" | "exists"> {
  const { error } = await adminClient().auth.admin.createUser({ email, email_confirm: true });
  if (!error) return "created";
  // Supabase answers "already registered" (422, email_exists) for an existing address.
  if (error.status === 422 || error.code === "email_exists" || /already (been )?registered/i.test(error.message)) {
    return "exists";
  }
  throw new Error(`could not create the sign-in account: ${error.message}`);
}
