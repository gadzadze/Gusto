import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { SupplierInviteValues } from "@/lib/validation/supplier-invite";
import { getDb, type Tx } from "@/server/db/client";
import {
  buyerInviteLinks,
  buyerSupplierInvites,
  organizations,
  priceLists,
  supplierCustomers,
  supplierRequests,
  type SupplierRequestStatus,
} from "@/server/db/schema";
import { assertCatalogWritable, isUuid } from "@/server/domain/catalog/products";
import { assertSupplier, type OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { generateInviteToken, hashInviteToken, looksLikeInviteToken } from "@/server/domain/customers/invite-token";

// A buyer invites a supplier it already works with. The link opens the public join
// form (/suppliers/invite/<token>) with the names filled in, and grants nothing:
// the admin still approves the business like any other request. After approval and
// onboarding the supplier sees the buyer under "buyers who invited you" and can
// connect them as a customer in one step. The buyer sees nothing of the supplier
// until the supplier does that (a supplier decides who sees its catalog and prices).

export type SupplierInviteError = "not_active" | "too_many_open" | "stale_status" | "already_connected" | "suspended";

export const SUPPLIER_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_OPEN_INVITES = 30;

function assertActiveBuyer(ctx: OrgCtx) {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  if (ctx.orgStatus !== "active") throw new StateError<SupplierInviteError>("not_active");
}

const isOpen = and(
  isNull(buyerSupplierInvites.revokedAt),
  isNull(buyerSupplierInvites.usedAt),
  gt(buyerSupplierInvites.expiresAt, sql`now()`),
);

/** Returns the raw token (shown once, never stored). */
export async function createSupplierInvite(ctx: OrgCtx, values: SupplierInviteValues): Promise<{ inviteId: string; token: string }> {
  assertActiveBuyer(ctx);
  await consumeRateLimit(RATE_LIMITS.supplierInviteCreate, ctx.orgId);
  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(buyerSupplierInvites)
    .where(and(eq(buyerSupplierInvites.buyerOrgId, ctx.orgId), isOpen));
  if (n >= MAX_OPEN_INVITES) throw new StateError<SupplierInviteError>("too_many_open");
  const { token, hash } = generateInviteToken();
  const [row] = await db
    .insert(buyerSupplierInvites)
    .values({
      buyerOrgId: ctx.orgId,
      supplierName: values.supplierName,
      contactPhone: values.phone,
      contactEmail: values.email,
      legalId: values.legalId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + SUPPLIER_INVITE_TTL_MS),
      createdByUserId: ctx.userId,
    })
    .returning({ id: buyerSupplierInvites.id });
  return { inviteId: row.id, token };
}

export type SupplierInviteState = "open" | "expired" | "revoked" | "joined" | "connected";

export type SupplierInviteItem = {
  id: string;
  supplierName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  state: SupplierInviteState;
  /** What happened to the supplier's join request (only once they sent one). */
  requestStatus: SupplierRequestStatus | null;
  expiresAt: Date;
  createdAt: Date;
};

export async function listSupplierInvites(ctx: OrgCtx): Promise<SupplierInviteItem[]> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const rows = await getDb()
    .select({
      id: buyerSupplierInvites.id,
      supplierName: buyerSupplierInvites.supplierName,
      contactPhone: buyerSupplierInvites.contactPhone,
      contactEmail: buyerSupplierInvites.contactEmail,
      revokedAt: buyerSupplierInvites.revokedAt,
      usedAt: buyerSupplierInvites.usedAt,
      connectedAt: buyerSupplierInvites.connectedAt,
      expiresAt: buyerSupplierInvites.expiresAt,
      createdAt: buyerSupplierInvites.createdAt,
      requestStatus: supplierRequests.status,
    })
    .from(buyerSupplierInvites)
    .leftJoin(supplierRequests, eq(supplierRequests.inviteId, buyerSupplierInvites.id))
    .where(eq(buyerSupplierInvites.buyerOrgId, ctx.orgId))
    .orderBy(desc(buyerSupplierInvites.createdAt))
    .limit(100);
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    supplierName: r.supplierName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    requestStatus: r.requestStatus,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    state: r.connectedAt
      ? "connected"
      : r.usedAt
        ? "joined"
        : r.revokedAt
          ? "revoked"
          : r.expiresAt.getTime() <= now
            ? "expired"
            : "open",
  }));
}

export async function revokeSupplierInvite(ctx: OrgCtx, inviteId: string): Promise<void> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  if (!isUuid(inviteId)) throw new NotFoundError("invite");
  const updated = await getDb()
    .update(buyerSupplierInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(buyerSupplierInvites.id, inviteId), eq(buyerSupplierInvites.buyerOrgId, ctx.orgId), isOpen))
    .returning({ id: buyerSupplierInvites.id });
  if (updated.length === 0) throw new StateError<SupplierInviteError>("stale_status");
}

export type SupplierInvitePreview = { buyerName: string; supplierName: string } | null;

/** Public: who is inviting whom. null for every unusable token alike (forged, expired, revoked, used). */
export async function previewSupplierInvite(token: string): Promise<SupplierInvitePreview> {
  if (!looksLikeInviteToken(token)) return null;
  const [row] = await getDb()
    .select({ buyerName: organizations.name, supplierName: buyerSupplierInvites.supplierName })
    .from(buyerSupplierInvites)
    .innerJoin(organizations, eq(organizations.id, buyerSupplierInvites.buyerOrgId))
    .where(and(eq(buyerSupplierInvites.tokenHash, hashInviteToken(token)), isOpen, eq(organizations.status, "active")));
  if (row) return row;
  // The buyer's reusable personal link: no supplier name known yet.
  const [personal] = await getDb()
    .select({ buyerName: organizations.name })
    .from(buyerInviteLinks)
    .innerJoin(organizations, eq(organizations.id, buyerInviteLinks.buyerOrgId))
    .where(and(eq(buyerInviteLinks.token, token), eq(organizations.status, "active")));
  return personal ? { buyerName: personal.buyerName, supplierName: "" } : null;
}

/**
 * Inside the transaction that stores a public join request: claims the invitation for it
 * (single use) and returns its id, or null when the token isn't usable (the request is
 * then stored as a plain one). Locks the row so two submissions can't both claim it.
 */
export async function claimSupplierInvite(tx: Tx, token: string | null | undefined, supplierName = ""): Promise<string | null> {
  if (!token || !looksLikeInviteToken(token)) return null;
  const [row] = await tx
    .select({ id: buyerSupplierInvites.id })
    .from(buyerSupplierInvites)
    .innerJoin(organizations, eq(organizations.id, buyerSupplierInvites.buyerOrgId))
    .where(and(eq(buyerSupplierInvites.tokenHash, hashInviteToken(token)), isOpen, eq(organizations.status, "active")))
    .for("update", { of: buyerSupplierInvites });
  if (row) {
    await tx.update(buyerSupplierInvites).set({ usedAt: new Date() }).where(eq(buyerSupplierInvites.id, row.id));
    return row.id;
  }
  // A personal link can be used by any number of suppliers: each request gets its own
  // (already used) invitation row, so everything after this works as for a named invitation.
  const [link] = await tx
    .select({ buyerOrgId: buyerInviteLinks.buyerOrgId })
    .from(buyerInviteLinks)
    .innerJoin(organizations, eq(organizations.id, buyerInviteLinks.buyerOrgId))
    .where(and(eq(buyerInviteLinks.token, token), eq(organizations.status, "active")));
  if (!link) return null;
  const now = new Date();
  const [child] = await tx
    .insert(buyerSupplierInvites)
    .values({
      buyerOrgId: link.buyerOrgId,
      supplierName: supplierName || "-",
      tokenHash: generateInviteToken().hash, // never used: the personal link is the way in
      expiresAt: new Date(now.getTime() + SUPPLIER_INVITE_TTL_MS),
      usedAt: now,
    })
    .returning({ id: buyerSupplierInvites.id });
  return child.id;
}

/** The buyer's reusable invitation token, or null before the first one is made. */
export async function getInviteLink(ctx: OrgCtx): Promise<string | null> {
  if (ctx.orgType !== "buyer") throw new NotFoundError();
  const [row] = await getDb().select({ token: buyerInviteLinks.token }).from(buyerInviteLinks).where(eq(buyerInviteLinks.buyerOrgId, ctx.orgId));
  return row?.token ?? null;
}

/** The buyer's reusable invitation token, created on first use. */
export async function getOrCreateInviteLink(ctx: OrgCtx): Promise<string> {
  assertActiveBuyer(ctx);
  const db = getDb();
  const [existing] = await db.select({ token: buyerInviteLinks.token }).from(buyerInviteLinks).where(eq(buyerInviteLinks.buyerOrgId, ctx.orgId));
  if (existing) return existing.token;
  const token = randomBytes(32).toString("base64url");
  await db.insert(buyerInviteLinks).values({ buyerOrgId: ctx.orgId, token }).onConflictDoNothing();
  const [row] = await db.select({ token: buyerInviteLinks.token }).from(buyerInviteLinks).where(eq(buyerInviteLinks.buyerOrgId, ctx.orgId));
  return row.token;
}

/** Replaces the link: the old one stops working at once. */
export async function regenerateInviteLink(ctx: OrgCtx): Promise<string> {
  assertActiveBuyer(ctx);
  await consumeRateLimit(RATE_LIMITS.supplierInviteCreate, ctx.orgId);
  const token = randomBytes(32).toString("base64url");
  await getDb()
    .insert(buyerInviteLinks)
    .values({ buyerOrgId: ctx.orgId, token })
    .onConflictDoUpdate({ target: buyerInviteLinks.buyerOrgId, set: { token, createdAt: new Date() } });
  return token;
}

/**
 * When a supplier's organization is created (onboarding), attaches the invitations that
 * came with their approved join request, matched by the address they signed in with.
 */
export async function linkInvitesToSupplier(tx: Tx, email: string | null | undefined, supplierOrgId: string): Promise<void> {
  const address = email?.trim().toLowerCase();
  if (!address) return;
  await tx.execute(sql`
    update buyer_supplier_invites
       set supplier_org_id = ${supplierOrgId}
     where supplier_org_id is null
       and id in (select invite_id from supplier_requests
                   where email = ${address} and status = 'approved' and invite_id is not null)
  `);
}

export type InvitingBuyer = { inviteId: string; buyerName: string; invitedAt: Date };

/** Buyers who invited this supplier and aren't connected yet. */
export async function listInvitingBuyers(ctx: OrgCtx): Promise<InvitingBuyer[]> {
  assertSupplier(ctx);
  const rows = await getDb()
    .select({ inviteId: buyerSupplierInvites.id, buyerName: organizations.name, invitedAt: buyerSupplierInvites.createdAt })
    .from(buyerSupplierInvites)
    .innerJoin(organizations, eq(organizations.id, buyerSupplierInvites.buyerOrgId))
    .where(
      and(
        eq(buyerSupplierInvites.supplierOrgId, ctx.orgId),
        isNull(buyerSupplierInvites.connectedAt),
        sql`not exists (select 1 from supplier_customers sc where sc.supplier_org_id = ${ctx.orgId} and sc.buyer_org_id = ${buyerSupplierInvites.buyerOrgId})`,
      ),
    )
    .orderBy(desc(buyerSupplierInvites.createdAt));
  return rows;
}

/**
 * The supplier accepts a buyer who invited them: the buyer becomes an active customer,
 * on the supplier's default price list if they have one (otherwise the buyer sees no
 * products until the supplier assigns a list, as for every customer).
 */
export async function connectInvitingBuyer(ctx: OrgCtx, inviteId: string): Promise<{ customerId: string }> {
  assertCatalogWritable(ctx);
  if (ctx.orgStatus !== "active") throw new StateError<SupplierInviteError>("suspended");
  if (!isUuid(inviteId)) throw new NotFoundError("invite");
  return getDb().transaction(async (tx) => {
    const [invite] = await tx
      .select({ id: buyerSupplierInvites.id, buyerOrgId: buyerSupplierInvites.buyerOrgId, connectedAt: buyerSupplierInvites.connectedAt })
      .from(buyerSupplierInvites)
      .where(and(eq(buyerSupplierInvites.id, inviteId), eq(buyerSupplierInvites.supplierOrgId, ctx.orgId)))
      .for("update");
    if (!invite) throw new NotFoundError("invite");
    const [existing] = await tx
      .select({ id: supplierCustomers.id })
      .from(supplierCustomers)
      .where(and(eq(supplierCustomers.supplierOrgId, ctx.orgId), eq(supplierCustomers.buyerOrgId, invite.buyerOrgId)));
    if (invite.connectedAt || existing) throw new StateError<SupplierInviteError>("already_connected");
    const [buyer] = await tx
      .select({ name: organizations.name, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, invite.buyerOrgId));
    if (!buyer || buyer.status === "suspended") throw new NotFoundError("invite");
    const [defaultList] = await tx
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.supplierOrgId, ctx.orgId), eq(priceLists.isDefault, true)));
    const now = new Date();
    const [customer] = await tx
      .insert(supplierCustomers)
      .values({
        supplierOrgId: ctx.orgId,
        buyerOrgId: invite.buyerOrgId,
        businessName: buyer.name,
        status: "active",
        connectedAt: now,
        priceListId: defaultList?.id ?? null,
      })
      .returning({ id: supplierCustomers.id });
    await tx.update(buyerSupplierInvites).set({ connectedAt: now }).where(eq(buyerSupplierInvites.id, invite.id));
    return { customerId: customer.id };
  });
}
