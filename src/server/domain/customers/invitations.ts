import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import type { OnboardingValues } from "@/lib/validation/onboarding";
import { getDb, type Tx } from "@/server/db/client";
import { connectionRequests, invitations, organizations, supplierCustomers } from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { StateError } from "@/server/domain/errors";
import { convertOpenInvitationsQuietly } from "@/server/domain/connections/convert";
import { createOrganizationInTx, type CreateOptions } from "@/server/domain/onboarding/create-organization";
import { hashInviteToken, isInvitationUsable, looksLikeInviteToken } from "./invite-token";
import { recordSubjectEvent } from "@/server/notifications/events";
import { deliverAfterResponse } from "@/server/notifications/process";

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
  // A connection request waiting between the same two businesses (an invitation that was turned into one)
  // is settled by this connection.
  await tx
    .update(connectionRequests)
    .set({ status: "approved", decidedAt: now, decidedByUserId: userId })
    .where(
      and(
        eq(connectionRequests.status, "pending"),
        or(
          and(eq(connectionRequests.fromOrgId, row.supplierOrgId), eq(connectionRequests.toOrgId, buyerOrgId)),
          and(eq(connectionRequests.fromOrgId, buyerOrgId), eq(connectionRequests.toOrgId, row.supplierOrgId)),
        ),
      ),
    );
  // The supplier hears that the customer joined.
  const [buyer] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, buyerOrgId));
  await recordSubjectEvent(tx, {
    event: "customer_connected",
    subjectId: row.customerId,
    recipientOrgId: row.supplierOrgId,
    counterpartyName: buyer?.name ?? "",
    link: `/supplier/customers/${row.customerId}`,
    actor: { userId },
  });
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
  }).then((result) => {
    deliverAfterResponse();
    return result;
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
  }).then(async (result) => {
    deliverAfterResponse();
    // Other suppliers may have invited this business by its code.
    await convertOpenInvitationsQuietly(result.orgId);
    return result;
  });
}
