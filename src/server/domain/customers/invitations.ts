import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { OnboardingValues } from "@/lib/validation/onboarding";
import { getDb, type Tx } from "@/server/db/client";
import { invitations, organizations, supplierCustomers } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { createOrganizationInTx, type CreateOptions } from "@/server/domain/onboarding/create-organization";
import { hashInviteToken, isInvitationUsable, looksLikeInviteToken } from "./invite-token";

// Every way an invitation can't be used — never existed, forged, expired,
// revoked, already accepted, customer blocked, supplier not active — is the
// same "unavailable" to the caller, so links can't be probed.

export type InvitationError = "unavailable" | "already_connected" | "not_a_buyer";

export type InvitationPreview =
  | {
      status: "valid";
      supplierName: string;
      businessName: string;
      contactName: string | null;
      contactPhone: string | null;
    }
  | { status: "unavailable" };

type Loaded = {
  invitationId: string;
  customerId: string;
  supplierOrgId: string;
  supplierName: string;
  businessName: string;
  contactName: string | null;
  contactPhone: string | null;
};

async function loadUsable(db: ReturnType<typeof getDb> | Tx, token: string, lock: boolean): Promise<Loaded | null> {
  if (!looksLikeInviteToken(token)) return null;
  const query = db
    .select({
      invitationId: invitations.id,
      expiresAt: invitations.expiresAt,
      revokedAt: invitations.revokedAt,
      acceptedAt: invitations.acceptedAt,
      customerId: supplierCustomers.id,
      customerStatus: supplierCustomers.status,
      supplierOrgId: supplierCustomers.supplierOrgId,
      supplierName: organizations.name,
      supplierStatus: organizations.status,
      businessName: supplierCustomers.businessName,
      contactName: supplierCustomers.contactName,
      contactPhone: supplierCustomers.contactPhone,
    })
    .from(invitations)
    .innerJoin(supplierCustomers, eq(supplierCustomers.id, invitations.supplierCustomerId))
    .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
    .where(eq(invitations.tokenHash, hashInviteToken(token)));
  const [row] = lock ? await query.for("update", { of: [invitations, supplierCustomers] }) : await query;
  if (!row) return null;
  if (!isInvitationUsable(row)) return null;
  if (row.customerStatus !== "invited" || row.supplierStatus !== "active") return null;
  return row;
}

/** What the invite page shows. Reveals nothing about tokens that don't work. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const row = await loadUsable(getDb(), token, false);
  if (!row) return { status: "unavailable" };
  return {
    status: "valid",
    supplierName: row.supplierName,
    businessName: row.businessName,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
  };
}

async function connect(tx: Tx, row: Loaded, buyerOrgId: string, userId: string) {
  const now = new Date();
  await tx
    .update(supplierCustomers)
    .set({ buyerOrgId, status: "active", connectedAt: now })
    .where(and(eq(supplierCustomers.id, row.customerId), eq(supplierCustomers.status, "invited")));
  await tx
    .update(invitations)
    .set({ acceptedAt: now, acceptedByUserId: userId })
    .where(and(eq(invitations.id, row.invitationId), isNull(invitations.acceptedAt)));
}

/** An existing buyer organization accepts. */
export async function acceptInvitationAsBuyer(ctx: OrgCtx, token: string): Promise<{ supplierOrgId: string }> {
  if (ctx.orgType !== "buyer") throw new StateError<InvitationError>("not_a_buyer");
  return getDb().transaction(async (tx) => {
    const row = await loadUsable(tx, token, true);
    if (!row) throw new StateError<InvitationError>("unavailable");
    const [existing] = await tx
      .select({ id: supplierCustomers.id })
      .from(supplierCustomers)
      .where(and(eq(supplierCustomers.supplierOrgId, row.supplierOrgId), eq(supplierCustomers.buyerOrgId, ctx.orgId)));
    if (existing) throw new StateError<InvitationError>("already_connected");
    await connect(tx, row, ctx.orgId, ctx.userId);
    return { supplierOrgId: row.supplierOrgId };
  });
}

/**
 * A signed-in person without an organization accepts: their buyer
 * organization is created and connected in one transaction, so a failure
 * leaves neither behind.
 */
export async function acceptInvitationWithNewBuyer(
  userId: string,
  token: string,
  onboarding: Extract<OnboardingValues, { kind: "buyer" }>,
  options: CreateOptions = {},
): Promise<{ orgId: string; supplierOrgId: string }> {
  return getDb().transaction(async (tx) => {
    const row = await loadUsable(tx, token, true);
    if (!row) throw new StateError<InvitationError>("unavailable");
    const { orgId } = await createOrganizationInTx(tx, userId, onboarding, options);
    await connect(tx, row, orgId, userId);
    return { orgId, supplierOrgId: row.supplierOrgId };
  });
}
