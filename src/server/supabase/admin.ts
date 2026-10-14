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
 * Turns Supabase's reply into a message that says what to do. The Auth admin API
 * needs the JWT-style service-role key (starts with "eyJ"); the newer "sb_secret_"
 * keys are not JWTs and are refused with "invalid JWT ... invalid number of segments".
 */
export function explainAdminApiError(message: string, key: string): string {
  if (/jwt|segments|apikey|api key/i.test(message) && !key.startsWith("eyJ")) {
    return (
      `${message}. SUPABASE_SERVICE_ROLE_KEY does not look like a JWT (it should start with "eyJ"). ` +
      `The Auth admin API rejects the newer "sb_secret_" keys: use the service_role JWT key instead ` +
      `(local: "npx supabase status -o env" prints SERVICE_ROLE_KEY; hosted: Project Settings → API Keys → Legacy).`
    );
  }
  return message;
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
  throw new Error(`could not create the sign-in account: ${explainAdminApiError(error.message, serviceRoleKey())}`);
}
