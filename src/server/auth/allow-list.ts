import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { inviteTokenFromPath, normalizeEmail } from "@/lib/auth/invite-path";
import { getDb } from "@/server/db/client";
import { allowedEmails, invitations, organizations, supplierCustomers } from "@/server/db/schema";
import { isInvitationUsable } from "@/server/domain/customers/invite-token";
import { previewInvitation } from "@/server/domain/customers/invitations";

// Sign-in is invite-only. An address may sign in if:
//  1. it has an allow-list row that is not revoked; or, when it has NO row,
//  2. the person is following a valid invitation link (`next` = /invite/<token>:
//     the single-use token is the capability, so a WhatsApp-only invite works); or
//  3. a valid invitation was addressed to this email by a supplier.
// A revoked row always wins: an admin's revocation is not undone by an invitation.

export async function isEmailAllowed(rawEmail: string, nextPath: string | null = null): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  const db = getDb();

  const [row] = await db.select({ revokedAt: allowedEmails.revokedAt }).from(allowedEmails).where(eq(allowedEmails.email, email));
  if (row) return row.revokedAt === null;

  const token = inviteTokenFromPath(nextPath);
  if (token && (await previewInvitation(token)).status === "valid") return true;

  const open = await db
    .select({
      expiresAt: invitations.expiresAt,
      revokedAt: invitations.revokedAt,
      acceptedAt: invitations.acceptedAt,
      customerStatus: supplierCustomers.status,
      supplierStatus: organizations.status,
    })
    .from(invitations)
    .innerJoin(supplierCustomers, eq(supplierCustomers.id, invitations.supplierCustomerId))
    .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
    .where(and(sql`lower(${supplierCustomers.contactEmail}) = ${email}`));
  return open.some((i) => isInvitationUsable(i) && i.customerStatus === "invited" && i.supplierStatus === "active");
}
