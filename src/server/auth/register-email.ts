import "server-only";
import { allowEmail, type Actor, type AllowResult, type IntendedRole, type VerifiedCompany } from "@/server/domain/admin/access";
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
): Promise<AllowResult & { authUser: "created" | "exists" | "failed" }> {
  const result = await allowEmail(actor, email, note, role, company);
  try {
    return { ...result, authUser: await ensureAuthUser(result.email) };
  } catch (error) {
    console.error("[access] could not create auth user", { message: error instanceof Error ? error.message : String(error) });
    return { ...result, authUser: "failed" };
  }
}
