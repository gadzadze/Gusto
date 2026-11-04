import "server-only";
import { allowEmail, type Actor, type AllowResult, type IntendedRole, type VerifiedCompany } from "@/server/domain/admin/access";
import { sendWelcomeEmail, type WelcomeResult } from "@/server/auth/welcome-email";
import { ensureAuthUser } from "@/server/supabase/admin";

/**
 * Registers an address for sign-in: allow-list row plus the Supabase auth user
 * (so Google and magic links both work with sign-ups switched off). The auth
 * user step is best effort here: if it fails the address is still allowed, and
 * the sign-in action creates the user on the first link request.
 */
export async function registerEmail(
  actor: Actor,
  email: string,
  note?: string,
  role?: IntendedRole,
  company?: VerifiedCompany,
): Promise<AllowResult & { authUser: "created" | "exists" | "failed"; welcome: WelcomeResult | "none" }> {
  const result = await allowEmail(actor, email, note, role, company);
  let authUser: "created" | "exists" | "failed";
  try {
    authUser = await ensureAuthUser(result.email);
  } catch (error) {
    console.error("[access] could not create auth user", { message: error instanceof Error ? error.message : String(error) });
    authUser = "failed";
  }
  // A newly accepted (or restored) address gets the welcome email with its first sign-in link.
  // Re-adding an address that is already allowed sends nothing, so retries never spam.
  const isNew = result.status === "allowed" || result.status === "restored";
  const welcome = isNew && authUser !== "failed" ? await sendWelcomeEmail(result.email) : "none";
  return { ...result, authUser, welcome };
}
