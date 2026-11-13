import "server-only";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db/client";
import {
  buyerSupplierInvites,
  connectionRequests,
  invitations,
  organizations,
  supplierCustomers,
} from "@/server/db/schema";
import { isUniqueViolation } from "@/server/domain/errors";
import { recordSubjectEvent } from "@/server/notifications/events";
import { deliverAfterResponse } from "@/server/notifications/process";
import { COOLDOWN_DAYS, REQUEST_LIFETIME_DAYS } from "./connections";

// Invitations that carry an identification code are matched when the business with that code becomes
// active on 202: each one turns into a connection request waiting in that business's inbox, so a partner
// who invited it by link does not have to be chased again, and the business answers all of them in one place.
//
// Rules: only an `active`, `findable` business with that code is matched (the same rule as the lookup, so
// a business that switched this off is never contacted this way); an invitation is converted once
// (`converted_at`); a pair that is already connected, blocked, waiting, or recently declined is skipped. The
// invitation link itself keeps working until the request is answered or the link is used.

const DAY = 24 * 60 * 60 * 1000;
// Nobody caused these notifications, so nobody is excluded from them.
const NO_ACTOR = "00000000-0000-0000-0000-000000000000";

type PairState = "free" | "taken";

/** Whether a request between this supplier and buyer would be pointless or unwelcome right now. */
async function pairState(tx: Tx, supplierOrgId: string, buyerOrgId: string, askedBy: "supplier" | "buyer"): Promise<PairState> {
  const [connection] = await tx
    .select({ id: supplierCustomers.id })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.supplierOrgId, supplierOrgId), eq(supplierCustomers.buyerOrgId, buyerOrgId)));
  if (connection) return "taken"; // connected or blocked
  const now = new Date();
  const [pending] = await tx
    .select({ id: connectionRequests.id })
    .from(connectionRequests)
    .where(
      and(
        eq(connectionRequests.status, "pending"),
        gt(connectionRequests.expiresAt, now),
        or(
          and(eq(connectionRequests.fromOrgId, supplierOrgId), eq(connectionRequests.toOrgId, buyerOrgId)),
          and(eq(connectionRequests.fromOrgId, buyerOrgId), eq(connectionRequests.toOrgId, supplierOrgId)),
        ),
      ),
    );
  if (pending) return "taken";
  const fromOrgId = askedBy === "supplier" ? supplierOrgId : buyerOrgId;
  const toOrgId = askedBy === "supplier" ? buyerOrgId : supplierOrgId;
  const [declined] = await tx
    .select({ id: connectionRequests.id })
    .from(connectionRequests)
    .where(
      and(
        eq(connectionRequests.fromOrgId, fromOrgId),
        eq(connectionRequests.toOrgId, toOrgId),
        eq(connectionRequests.status, "declined"),
        gt(connectionRequests.decidedAt, new Date(now.getTime() - COOLDOWN_DAYS * DAY)),
      ),
    )
    .limit(1);
  return declined ? "taken" : "free";
}

/**
 * Turns the open invitations addressed to this business's code into connection requests. Safe to call at
 * any time and as often as wanted: it only acts on invitations not converted yet. Returns how many requests it made.
 */
export async function convertOpenInvitations(orgId: string): Promise<number> {
  const db = getDb();
  const [org] = await db
    .select({ id: organizations.id, type: organizations.type, status: organizations.status, legalId: organizations.legalId, findable: organizations.findable, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org || org.status !== "active" || !org.findable || !org.legalId) return 0;
  const now = new Date();
  let made = 0;

  if (org.type === "buyer") {
    // Suppliers that invited this buyer (by code) and whose invitation is still usable.
    const rows = await db
      .select({
        customerId: supplierCustomers.id,
        supplierOrgId: supplierCustomers.supplierOrgId,
        priceListId: supplierCustomers.priceListId,
        supplierName: organizations.name,
      })
      .from(supplierCustomers)
      .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
      .where(
        and(
          eq(supplierCustomers.legalId, org.legalId),
          eq(supplierCustomers.status, "invited"),
          isNull(supplierCustomers.buyerOrgId),
          isNull(supplierCustomers.convertedAt),
          eq(organizations.type, "supplier"),
          eq(organizations.status, "active"),
          sql`exists (select 1 from ${invitations} where ${invitations.supplierCustomerId} = ${supplierCustomers.id} and ${invitations.revokedAt} is null and ${invitations.acceptedAt} is null and ${invitations.expiresAt} > now())`,
        ),
      );
    for (const row of rows) {
      try {
        const done = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(supplierCustomers)
            .set({ convertedAt: now })
            .where(and(eq(supplierCustomers.id, row.customerId), isNull(supplierCustomers.convertedAt)))
            .returning({ id: supplierCustomers.id });
          if (claimed.length === 0) return false;
          if ((await pairState(tx, row.supplierOrgId, org.id, "supplier")) === "taken") return false;
          const [created] = await tx
            .insert(connectionRequests)
            .values({
              fromOrgId: row.supplierOrgId,
              toOrgId: org.id,
              priceListId: row.priceListId,
              customerId: row.customerId,
              expiresAt: new Date(now.getTime() + REQUEST_LIFETIME_DAYS * DAY),
            })
            .returning({ id: connectionRequests.id });
          await recordSubjectEvent(tx, {
            event: "connection_requested",
            subjectId: created.id,
            recipientOrgId: org.id,
            counterpartyName: row.supplierName,
            link: "/buyer/suppliers#requests",
            actor: { userId: NO_ACTOR },
          });
          return true;
        });
        if (done) made += 1;
      } catch (error) {
        if (!isUniqueViolation(error, "connection_requests_one_pending")) throw error;
      }
    }
  } else {
    // Buyers that invited this supplier (by code) and whose invitation is still usable.
    const rows = await db
      .select({ inviteId: buyerSupplierInvites.id, buyerOrgId: buyerSupplierInvites.buyerOrgId, buyerName: organizations.name })
      .from(buyerSupplierInvites)
      .innerJoin(organizations, eq(organizations.id, buyerSupplierInvites.buyerOrgId))
      .where(
        and(
          eq(buyerSupplierInvites.legalId, org.legalId),
          isNull(buyerSupplierInvites.revokedAt),
          isNull(buyerSupplierInvites.usedAt),
          isNull(buyerSupplierInvites.convertedAt),
          gt(buyerSupplierInvites.expiresAt, now),
          eq(organizations.type, "buyer"),
          eq(organizations.status, "active"),
        ),
      );
    for (const row of rows) {
      try {
        const done = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(buyerSupplierInvites)
            .set({ convertedAt: now })
            .where(and(eq(buyerSupplierInvites.id, row.inviteId), isNull(buyerSupplierInvites.convertedAt)))
            .returning({ id: buyerSupplierInvites.id });
          if (claimed.length === 0) return false;
          if ((await pairState(tx, org.id, row.buyerOrgId, "buyer")) === "taken") return false;
          const [created] = await tx
            .insert(connectionRequests)
            .values({
              fromOrgId: row.buyerOrgId,
              toOrgId: org.id,
              expiresAt: new Date(now.getTime() + REQUEST_LIFETIME_DAYS * DAY),
            })
            .returning({ id: connectionRequests.id });
          await recordSubjectEvent(tx, {
            event: "connection_requested",
            subjectId: created.id,
            recipientOrgId: org.id,
            counterpartyName: row.buyerName,
            link: "/supplier/customers#requests",
            actor: { userId: NO_ACTOR },
          });
          return true;
        });
        if (done) made += 1;
      } catch (error) {
        if (!isUniqueViolation(error, "connection_requests_one_pending")) throw error;
      }
    }
  }
  if (made > 0) deliverAfterResponse();
  return made;
}

/** Best effort: used after sign-up and approval, where a failure here must never break the main flow. */
export async function convertOpenInvitationsQuietly(orgId: string): Promise<void> {
  try {
    await convertOpenInvitations(orgId);
  } catch (error) {
    console.error("[connections] converting invitations failed", { message: error instanceof Error ? error.message : String(error) });
  }
}
