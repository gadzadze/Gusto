import "server-only";
import { eq } from "drizzle-orm";
import { normalizeEmail } from "@/lib/auth/invite-path";
import { getDb } from "@/server/db/client";
import { allowedEmails } from "@/server/db/schema";

// Sign-in is closed until the business is accepted. An address may get a
// sign-in link (or finish a Google sign-in) only if the admin has put it on the
// allow-list and has not revoked it. Nothing else opens the door: not an
// invitation link, not an invitation addressed to that email. An invitation
// only connects a buyer to a supplier AFTER the buyer is signed in, so an
// address nobody accepted never gets an email and never gets an account.

export async function isEmailAllowed(rawEmail: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ revokedAt: allowedEmails.revokedAt })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalizeEmail(rawEmail)));
  return row !== undefined && row.revokedAt === null;
}

/**
 * The kind of organization this address was registered for ("buyer" or
 * "supplier"), or null when the admin left it open or there is no row. Onboarding
 * offers only this kind and the server refuses the other.
 */
export async function pinnedRoleFor(rawEmail: string | null | undefined): Promise<"buyer" | "supplier" | null> {
  if (!rawEmail) return null;
  const [row] = await getDb()
    .select({ role: allowedEmails.intendedRole, revokedAt: allowedEmails.revokedAt })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalizeEmail(rawEmail)));
  return row && row.revokedAt === null ? row.role : null;
}

export type Registration = {
  role: "buyer" | "supplier" | null;
  businessName: string | null;
  /** Set when the admin verified the business before registering the address. */
  legalId: string | null;
};

/** What the admin recorded for this address, or null (no row, or revoked). */
export async function registrationFor(rawEmail: string | null | undefined): Promise<Registration | null> {
  if (!rawEmail) return null;
  const [row] = await getDb()
    .select({
      role: allowedEmails.intendedRole,
      businessName: allowedEmails.businessName,
      legalId: allowedEmails.legalId,
      revokedAt: allowedEmails.revokedAt,
    })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalizeEmail(rawEmail)));
  if (!row || row.revokedAt) return null;
  return { role: row.role, businessName: row.businessName, legalId: row.legalId };
}
