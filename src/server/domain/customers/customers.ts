import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { CustomerValues } from "@/lib/validation/customer";
import { getDb, type Tx } from "@/server/db/client";
import {
  invitations,
  organizations,
  priceLists,
  supplierCustomers,
  type CustomerStatus,
} from "@/server/db/schema";
import { assertCatalogWritable, isUuid } from "@/server/domain/catalog/products";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { INVITE_TTL_MS, generateInviteToken } from "./invite-token";

export type CustomerError = "not_active" | "suspended" | "price_list_unavailable" | "not_invited" | "stale_status";

export type CustomerListItem = {
  id: string;
  businessName: string;
  contactName: string | null;
  contactPhone: string | null;
  status: CustomerStatus;
  buyerOrgName: string | null;
  /** The connected buyer is still waiting for Gusto's verification. */
  buyerUnverified: boolean;
  priceListId: string | null;
  priceListName: string | null;
  inviteExpiresAt: Date | null;
  createdAt: Date;
};

/** An open (unaccepted, unrevoked, unexpired) invitation's expiry, if any. */
const openInviteExpiry = sql<Date | null>`(
  select max(${invitations.expiresAt}) from ${invitations}
  where ${invitations.supplierCustomerId} = ${supplierCustomers.id}
    and ${invitations.revokedAt} is null
    and ${invitations.acceptedAt} is null
    and ${invitations.expiresAt} > now()
)`.mapWith((v: string | Date | null) => (v === null ? null : new Date(v)));

const buyerUnverified = sql<boolean>`coalesce((
  select ${organizations.status} = 'pending_review' from ${organizations} where ${organizations.id} = ${supplierCustomers.buyerOrgId}
), false)`;

const buyerOrg = sql<string | null>`(
  select ${organizations.name} from ${organizations} where ${organizations.id} = ${supplierCustomers.buyerOrgId}
)`;

export async function listCustomers(ctx: OrgCtx): Promise<CustomerListItem[]> {
  assertSupplier(ctx);
  return getDb()
    .select({
      id: supplierCustomers.id,
      businessName: supplierCustomers.businessName,
      contactName: supplierCustomers.contactName,
      contactPhone: supplierCustomers.contactPhone,
      status: supplierCustomers.status,
      buyerOrgName: buyerOrg,
      buyerUnverified,
      priceListId: supplierCustomers.priceListId,
      priceListName: priceLists.name,
      inviteExpiresAt: openInviteExpiry,
      createdAt: supplierCustomers.createdAt,
    })
    .from(supplierCustomers)
    .leftJoin(priceLists, eq(priceLists.id, supplierCustomers.priceListId))
    .where(eq(supplierCustomers.supplierOrgId, ctx.orgId))
    .orderBy(
      sql`case ${supplierCustomers.status} when 'active' then 0 when 'invited' then 1 else 2 end`,
      asc(supplierCustomers.businessName),
    )
    .limit(1000);
}

export type CustomerDetail = CustomerListItem & { contactEmail: string | null; connectedAt: Date | null };

export async function getCustomer(ctx: OrgCtx, customerId: string): Promise<CustomerDetail> {
  assertSupplier(ctx);
  if (!isUuid(customerId)) throw new NotFoundError("customer");
  const [row] = await getDb()
    .select({
      id: supplierCustomers.id,
      businessName: supplierCustomers.businessName,
      contactName: supplierCustomers.contactName,
      contactPhone: supplierCustomers.contactPhone,
      contactEmail: supplierCustomers.contactEmail,
      status: supplierCustomers.status,
      buyerOrgName: buyerOrg,
      buyerUnverified,
      priceListId: supplierCustomers.priceListId,
      priceListName: priceLists.name,
      inviteExpiresAt: openInviteExpiry,
      connectedAt: supplierCustomers.connectedAt,
      createdAt: supplierCustomers.createdAt,
    })
    .from(supplierCustomers)
    .leftJoin(priceLists, eq(priceLists.id, supplierCustomers.priceListId))
    .where(and(eq(supplierCustomers.id, customerId), eq(supplierCustomers.supplierOrgId, ctx.orgId)));
  if (!row) throw new NotFoundError("customer");
  return row;
}

async function assertOwnPriceList(tx: Tx, ctx: OrgCtx, priceListId: string | null) {
  if (!priceListId) return;
  const [list] = await tx
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.id, priceListId), eq(priceLists.supplierOrgId, ctx.orgId)));
  if (!list) throw new StateError<CustomerError>("price_list_unavailable");
}

/** Inviting requires an approved supplier (pending ones can prepare, not invite). */
function assertCanInvite(ctx: OrgCtx) {
  assertCatalogWritable(ctx);
  if (ctx.orgStatus !== "active") throw new StateError<CustomerError>("not_active");
}

async function issueInvitation(tx: Tx, ctx: OrgCtx, customerId: string): Promise<string> {
  // A new link replaces any open one.
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.supplierCustomerId, customerId),
        isNull(invitations.revokedAt),
        isNull(invitations.acceptedAt),
      ),
    );
  const { token, hash } = generateInviteToken();
  await tx.insert(invitations).values({
    supplierCustomerId: customerId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    createdByUserId: ctx.userId,
  });
  return token;
}

/**
 * Adds a customer the supplier already serves and issues an invitation.
 * Returns the raw token: it is shown once and never stored.
 */
export async function createCustomer(
  ctx: OrgCtx,
  values: CustomerValues,
): Promise<{ customerId: string; token: string }> {
  assertCanInvite(ctx);
  await consumeRateLimit(RATE_LIMITS.inviteCreate, ctx.orgId);
  return getDb().transaction(async (tx) => {
    await assertOwnPriceList(tx, ctx, values.priceListId);
    const [row] = await tx
      .insert(supplierCustomers)
      .values({
        supplierOrgId: ctx.orgId,
        businessName: values.businessName,
        contactName: values.contactName,
        contactPhone: values.phone,
        contactEmail: values.email,
        priceListId: values.priceListId,
        status: "invited",
      })
      .returning({ id: supplierCustomers.id });
    const token = await issueInvitation(tx, ctx, row.id);
    return { customerId: row.id, token };
  });
}

/** Issues a fresh link for a customer who hasn't joined yet, revoking older ones. */
export async function regenerateInvitation(ctx: OrgCtx, customerId: string): Promise<string> {
  assertCanInvite(ctx);
  await consumeRateLimit(RATE_LIMITS.inviteCreate, ctx.orgId);
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ status: supplierCustomers.status })
      .from(supplierCustomers)
      .where(and(eq(supplierCustomers.id, customerId), eq(supplierCustomers.supplierOrgId, ctx.orgId)))
      .for("update");
    if (!row) throw new NotFoundError("customer");
    if (row.status !== "invited") throw new StateError<CustomerError>("not_invited");
    return issueInvitation(tx, ctx, customerId);
  });
}

export async function revokeInvitations(ctx: OrgCtx, customerId: string): Promise<void> {
  assertCatalogWritable(ctx);
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ id: supplierCustomers.id })
      .from(supplierCustomers)
      .where(and(eq(supplierCustomers.id, customerId), eq(supplierCustomers.supplierOrgId, ctx.orgId)));
    if (!row) throw new NotFoundError("customer");
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.supplierCustomerId, customerId),
          isNull(invitations.revokedAt),
          isNull(invitations.acceptedAt),
        ),
      );
  });
}

export async function setCustomerPriceList(ctx: OrgCtx, customerId: string, priceListId: string | null): Promise<void> {
  assertCatalogWritable(ctx);
  await getDb().transaction(async (tx) => {
    await assertOwnPriceList(tx, ctx, priceListId);
    const updated = await tx
      .update(supplierCustomers)
      .set({ priceListId })
      .where(and(eq(supplierCustomers.id, customerId), eq(supplierCustomers.supplierOrgId, ctx.orgId)))
      .returning({ id: supplierCustomers.id });
    if (updated.length === 0) throw new NotFoundError("customer");
  });
}

/**
 * Blocking ends the buyer's access to this supplier's catalog immediately and
 * revokes open invitations. Unblocking restores a connected buyer; a never-
 * connected customer goes back to "invited" and needs a new link.
 */
export async function setCustomerBlocked(ctx: OrgCtx, customerId: string, blocked: boolean): Promise<void> {
  assertCatalogWritable(ctx);
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ status: supplierCustomers.status, buyerOrgId: supplierCustomers.buyerOrgId })
      .from(supplierCustomers)
      .where(and(eq(supplierCustomers.id, customerId), eq(supplierCustomers.supplierOrgId, ctx.orgId)))
      .for("update");
    if (!row) throw new NotFoundError("customer");
    if (blocked) {
      if (row.status === "blocked") return;
      await tx.update(supplierCustomers).set({ status: "blocked" }).where(eq(supplierCustomers.id, customerId));
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.supplierCustomerId, customerId),
            isNull(invitations.revokedAt),
            isNull(invitations.acceptedAt),
          ),
        );
    } else {
      if (row.status !== "blocked") return;
      await tx
        .update(supplierCustomers)
        .set({ status: row.buyerOrgId ? "active" : "invited" })
        .where(eq(supplierCustomers.id, customerId));
    }
  });
}
