import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { isValidLegalId, normalizeLegalId } from "@/lib/legal-id";
import { getDb, type Tx } from "@/server/db/client";
import {
  connectionRequests,
  invitations,
  organizationMemberships,
  organizations,
  priceLists,
  supplierCustomers,
} from "@/server/db/schema";
import type { OrgCtx } from "@/server/domain/context";
import { NotFoundError, StateError, isUniqueViolation } from "@/server/domain/errors";
import { recordSubjectEvent } from "@/server/notifications/events";
import { deliverAfterResponse } from "@/server/notifications/process";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

// Connecting two businesses without an invitation link. A business finds another by its identification
// code (never by browsing), asks to connect, and the other side approves, like a friend request. Only an
// approval creates the supplier_customers row, so until then nothing of either side is visible to the other.
//
// Privacy rules, all enforced here:
//  - a lookup needs the full code; it answers with the name and city only (no contact, no catalog, no prices);
//  - a business that is not approved by the admin, or has switched "findable" off, answers exactly like one
//    that does not exist (state "not_found"), so a lookup cannot tell them apart;
//  - a supplier that blocked a buyer is also "not found" to that buyer.

export type ConnectionError =
  | "invalid_code"
  | "not_active"
  | "not_found"
  | "already_connected"
  | "already_pending"
  | "declined_recently"
  | "blocked"
  | "request_not_pending"
  | "invalid_list"
  | "rate_limited";

export const REQUEST_LIFETIME_DAYS = 30;
export const COOLDOWN_DAYS = 14;
export const MESSAGE_MAX = 300;

const DAY = 24 * 60 * 60 * 1000;

function assertActive(ctx: OrgCtx) {
  if (ctx.orgStatus !== "active") throw new StateError<ConnectionError>("not_active");
}

const targetType = (ctx: OrgCtx) => (ctx.orgType === "supplier" ? "buyer" : "supplier");

export type Relation = "none" | "connected" | "pending_outgoing" | "pending_incoming" | "blocked_by_you" | "cooldown";
export type LookupResult =
  | { state: "not_found" }
  | { state: "self" }
  | { state: "found"; orgId: string; name: string; city: string; relation: Relation; requestId?: string; customerId?: string };

/** The relation between the asking organization and one target organization. */
async function relationTo(db: Tx | ReturnType<typeof getDb>, ctx: OrgCtx, targetOrgId: string): Promise<{ relation: Relation; requestId?: string; customerId?: string; hidden?: boolean }> {
  const supplierOrgId = ctx.orgType === "supplier" ? ctx.orgId : targetOrgId;
  const buyerOrgId = ctx.orgType === "buyer" ? ctx.orgId : targetOrgId;
  const [connection] = await db
    .select({ id: supplierCustomers.id, status: supplierCustomers.status })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.supplierOrgId, supplierOrgId), eq(supplierCustomers.buyerOrgId, buyerOrgId)));
  if (connection?.status === "active") return { relation: "connected", customerId: connection.id };
  if (connection?.status === "blocked") {
    // The supplier that blocked sees it; the blocked buyer sees nothing (same as "not found").
    return ctx.orgType === "supplier" ? { relation: "blocked_by_you", customerId: connection.id } : { relation: "none", hidden: true };
  }
  const now = new Date();
  const [pending] = await db
    .select({ id: connectionRequests.id, fromOrgId: connectionRequests.fromOrgId })
    .from(connectionRequests)
    .where(
      and(
        eq(connectionRequests.status, "pending"),
        gt(connectionRequests.expiresAt, now),
        or(
          and(eq(connectionRequests.fromOrgId, ctx.orgId), eq(connectionRequests.toOrgId, targetOrgId)),
          and(eq(connectionRequests.fromOrgId, targetOrgId), eq(connectionRequests.toOrgId, ctx.orgId)),
        ),
      ),
    );
  if (pending) return { relation: pending.fromOrgId === ctx.orgId ? "pending_outgoing" : "pending_incoming", requestId: pending.id };
  const [declined] = await db
    .select({ id: connectionRequests.id })
    .from(connectionRequests)
    .where(
      and(
        eq(connectionRequests.fromOrgId, ctx.orgId),
        eq(connectionRequests.toOrgId, targetOrgId),
        eq(connectionRequests.status, "declined"),
        gt(connectionRequests.decidedAt, new Date(now.getTime() - COOLDOWN_DAYS * DAY)),
      ),
    )
    .limit(1);
  return declined ? { relation: "cooldown" } : { relation: "none" };
}

/** Looks one business up by its full identification code. */
export async function findBusinessByCode(ctx: OrgCtx, rawCode: string): Promise<LookupResult> {
  assertActive(ctx);
  const code = normalizeLegalId(rawCode);
  if (!isValidLegalId(code)) throw new StateError<ConnectionError>("invalid_code");
  await consumeRateLimit(RATE_LIMITS.connectionSearch, ctx.orgId);
  const db = getDb();
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, city: organizations.city })
    .from(organizations)
    .where(
      and(
        eq(organizations.type, targetType(ctx)),
        eq(organizations.legalId, code),
        eq(organizations.status, "active"),
        eq(organizations.findable, true),
      ),
    );
  if (!org) return { state: "not_found" };
  // A business with both sides finds its own other side: say so instead of offering a request.
  const [mine] = await db
    .select({ id: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, ctx.userId), eq(organizationMemberships.organizationId, org.id)));
  if (mine) return { state: "self" };
  const rel = await relationTo(db, ctx, org.id);
  if (rel.hidden) return { state: "not_found" };
  return { state: "found", orgId: org.id, name: org.name, city: org.city, relation: rel.relation, requestId: rel.requestId, customerId: rel.customerId };
}

type OrgRow = { id: string; type: "buyer" | "supplier"; status: string; name: string; contactName: string; phone: string; legalId: string | null };

/**
 * Creates the connection (an active supplier_customers row) for an approved request. Returns its id.
 * When the supplier had already invited this business with its code (an invited row with no buyer yet),
 * that row is the one connected, so the supplier keeps one customer with its own name, contact and note,
 * and the invitation links of that row stop working.
 */
async function connect(tx: Tx, request: { id: string; fromOrgId: string; toOrgId: string; priceListId: string | null; customerId: string | null }, from: OrgRow, to: OrgRow, decidedBy: string, chosenListId: string | null | undefined) {
  const supplier = from.type === "supplier" ? from : to;
  const buyer = from.type === "buyer" ? from : to;
  const [existing] = await tx
    .select({ id: supplierCustomers.id, status: supplierCustomers.status })
    .from(supplierCustomers)
    .where(and(eq(supplierCustomers.supplierOrgId, supplier.id), eq(supplierCustomers.buyerOrgId, buyer.id)));
  if (existing?.status === "blocked") throw new StateError<ConnectionError>("blocked");

  // The invited row this business replaces, if any.
  let invited: { id: string; priceListId: string | null } | undefined;
  if (!existing) {
    const candidates = await tx
      .select({ id: supplierCustomers.id, priceListId: supplierCustomers.priceListId })
      .from(supplierCustomers)
      .where(
        and(
          eq(supplierCustomers.supplierOrgId, supplier.id),
          eq(supplierCustomers.status, "invited"),
          isNull(supplierCustomers.buyerOrgId),
          request.customerId
            ? eq(supplierCustomers.id, request.customerId)
            : buyer.legalId
              ? eq(supplierCustomers.legalId, buyer.legalId)
              : sql`false`,
        ),
      )
      .limit(1);
    invited = candidates[0];
  }

  let priceListId: string | null = chosenListId ?? request.priceListId ?? invited?.priceListId ?? null;
  if (priceListId) {
    const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, priceListId), eq(priceLists.supplierOrgId, supplier.id)));
    if (!list) throw new StateError<ConnectionError>("invalid_list");
  } else {
    const [def] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.supplierOrgId, supplier.id), eq(priceLists.isDefault, true)));
    priceListId = def?.id ?? null;
  }

  let customerId: string;
  if (existing) {
    customerId = existing.id;
  } else if (invited) {
    customerId = invited.id;
    await tx
      .update(supplierCustomers)
      .set({ buyerOrgId: buyer.id, status: "active", connectedAt: new Date(), priceListId, convertedAt: new Date() })
      .where(eq(supplierCustomers.id, invited.id));
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.supplierCustomerId, invited.id), isNull(invitations.revokedAt), isNull(invitations.acceptedAt)));
  } else {
    const [created] = await tx
      .insert(supplierCustomers)
      .values({
        supplierOrgId: supplier.id,
        buyerOrgId: buyer.id,
        status: "active",
        businessName: buyer.name,
        contactName: buyer.contactName,
        contactPhone: buyer.phone,
        priceListId,
        connectedAt: new Date(),
      })
      .returning({ id: supplierCustomers.id });
    customerId = created.id;
  }
  await tx
    .update(connectionRequests)
    .set({ status: "approved", decidedAt: new Date(), decidedByUserId: decidedBy })
    .where(eq(connectionRequests.id, request.id));
  return { customerId, supplierOrgId: supplier.id };
}

async function loadOrgs(tx: Tx, ids: string[]): Promise<Map<string, OrgRow>> {
  const rows = await tx
    .select({ id: organizations.id, type: organizations.type, status: organizations.status, name: organizations.name, contactName: organizations.contactName, phone: organizations.phone, legalId: organizations.legalId })
    .from(organizations)
    .where(inArray(organizations.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** After a connection: tell the one who asked. */
async function notifyAnswer(tx: Tx, event: "connection_approved" | "connection_declined", request: { id: string; fromOrgId: string }, answering: OrgRow, link: string, actorUserId: string) {
  await recordSubjectEvent(tx, {
    event,
    subjectId: request.id,
    recipientOrgId: request.fromOrgId,
    counterpartyName: answering.name,
    link,
    actor: { userId: actorUserId },
  });
}

const inboxPath = (orgType: "buyer" | "supplier") => (orgType === "supplier" ? "/supplier/customers#requests" : "/buyer/suppliers#requests");

/** Sends a request, or, when the other business already asked this one, approves theirs. */
export async function sendConnectionRequest(
  ctx: OrgCtx,
  targetOrgId: string,
  options: { message?: string | null; priceListId?: string | null } = {},
): Promise<{ status: "sent" | "connected"; requestId: string; customerId?: string }> {
  assertActive(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(targetOrgId)) throw new StateError<ConnectionError>("not_found");
  await consumeRateLimit(RATE_LIMITS.connectionRequest, ctx.orgId);
  const message = options.message?.trim() ? options.message.trim().slice(0, MESSAGE_MAX) : null;
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const orgs = await loadOrgs(tx, [ctx.orgId, targetOrgId]);
      const me = orgs.get(ctx.orgId);
      const target = orgs.get(targetOrgId);
      if (!me || !target || target.status !== "active" || target.type !== targetType(ctx)) throw new StateError<ConnectionError>("not_found");
      const [findable] = await tx.select({ findable: organizations.findable }).from(organizations).where(eq(organizations.id, targetOrgId));
      if (!findable?.findable) throw new StateError<ConnectionError>("not_found");
      const [mine] = await tx
        .select({ id: organizationMemberships.organizationId })
        .from(organizationMemberships)
        .where(and(eq(organizationMemberships.userId, ctx.userId), eq(organizationMemberships.organizationId, targetOrgId)));
      if (mine) throw new StateError<ConnectionError>("not_found");

      // Requests that ran out are closed first, so they never block a new one.
      await tx
        .update(connectionRequests)
        .set({ status: "expired" })
        .where(and(eq(connectionRequests.status, "pending"), lte(connectionRequests.expiresAt, new Date())));

      const rel = await relationTo(tx, ctx, targetOrgId);
      if (rel.hidden) throw new StateError<ConnectionError>("not_found");
      if (rel.relation === "connected") throw new StateError<ConnectionError>("already_connected");
      if (rel.relation === "blocked_by_you") throw new StateError<ConnectionError>("blocked");
      if (rel.relation === "pending_outgoing") throw new StateError<ConnectionError>("already_pending");
      if (rel.relation === "cooldown") throw new StateError<ConnectionError>("declined_recently");

      if (rel.relation === "pending_incoming" && rel.requestId) {
        // They already asked: asking back is agreeing.
        const [request] = await tx.select().from(connectionRequests).where(eq(connectionRequests.id, rel.requestId)).for("update");
        if (!request || request.status !== "pending") throw new StateError<ConnectionError>("request_not_pending");
        const connected = await connect(tx, request, target, me, ctx.userId, ctx.orgType === "supplier" ? (options.priceListId ?? null) : null);
        await notifyAnswer(
          tx,
          "connection_approved",
          request,
          me,
          target.type === "supplier" ? `/buyer/suppliers/${connected.supplierOrgId}` : `/supplier/customers/${connected.customerId}`,
          ctx.userId,
        );
        return { status: "connected" as const, requestId: request.id, customerId: connected.customerId };
      }

      let priceListId: string | null = null;
      if (options.priceListId) {
        if (ctx.orgType !== "supplier") throw new StateError<ConnectionError>("invalid_list");
        const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, options.priceListId), eq(priceLists.supplierOrgId, ctx.orgId)));
        if (!list) throw new StateError<ConnectionError>("invalid_list");
        priceListId = list.id;
      }
      const [created] = await tx
        .insert(connectionRequests)
        .values({
          fromOrgId: ctx.orgId,
          toOrgId: targetOrgId,
          message,
          priceListId,
          requestedByUserId: ctx.userId,
          expiresAt: new Date(Date.now() + REQUEST_LIFETIME_DAYS * DAY),
        })
        .returning({ id: connectionRequests.id });
      await recordSubjectEvent(tx, {
        event: "connection_requested",
        subjectId: created.id,
        recipientOrgId: targetOrgId,
        counterpartyName: me.name,
        link: inboxPath(target.type),
        actor: { userId: ctx.userId },
      });
      return { status: "sent" as const, requestId: created.id };
    });
    deliverAfterResponse();
    return result;
  } catch (error) {
    if (isUniqueViolation(error, "connection_requests_one_pending")) throw new StateError<ConnectionError>("already_pending");
    throw error;
  }
}

/** The business that received a request approves or declines it. */
export async function decideConnectionRequest(
  ctx: OrgCtx,
  requestId: string,
  approve: boolean,
  options: { priceListId?: string | null } = {},
): Promise<{ customerId?: string }> {
  assertActive(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new NotFoundError("request");
  const result = await getDb().transaction(async (tx) => {
    const [request] = await tx.select().from(connectionRequests).where(eq(connectionRequests.id, requestId)).for("update");
    // Someone else's request is "not found", not "forbidden".
    if (!request || request.toOrgId !== ctx.orgId) throw new NotFoundError("request");
    if (request.status !== "pending") throw new StateError<ConnectionError>("request_not_pending");
    if (request.expiresAt <= new Date()) {
      await tx.update(connectionRequests).set({ status: "expired" }).where(eq(connectionRequests.id, requestId));
      throw new StateError<ConnectionError>("request_not_pending");
    }
    const orgs = await loadOrgs(tx, [request.fromOrgId, request.toOrgId]);
    const from = orgs.get(request.fromOrgId);
    const to = orgs.get(request.toOrgId);
    if (!from || !to) throw new NotFoundError("request");
    if (from.status !== "active") {
      // The one who asked was suspended meanwhile: nothing to approve.
      await tx.update(connectionRequests).set({ status: "expired" }).where(eq(connectionRequests.id, requestId));
      throw new StateError<ConnectionError>("request_not_pending");
    }
    if (!approve) {
      await tx
        .update(connectionRequests)
        .set({ status: "declined", decidedAt: new Date(), decidedByUserId: ctx.userId })
        .where(eq(connectionRequests.id, requestId));
      await notifyAnswer(tx, "connection_declined", request, to, inboxPath(from.type), ctx.userId);
      return {};
    }
    // Only the supplier side can pick a list; a buyer approving takes what the supplier offered (or its default).
    const chosen = to.type === "supplier" ? (options.priceListId ?? null) : null;
    const connected = await connect(tx, request, from, to, ctx.userId, chosen);
    await notifyAnswer(
      tx,
      "connection_approved",
      request,
      to,
      from.type === "supplier" ? `/supplier/customers/${connected.customerId}` : `/buyer/suppliers/${connected.supplierOrgId}`,
      ctx.userId,
    );
    return { customerId: connected.customerId };
  });
  deliverAfterResponse();
  return result;
}

/** The business that asked takes its request back. */
export async function withdrawConnectionRequest(ctx: OrgCtx, requestId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new NotFoundError("request");
  const updated = await getDb()
    .update(connectionRequests)
    .set({ status: "withdrawn", decidedAt: new Date(), decidedByUserId: ctx.userId })
    .where(and(eq(connectionRequests.id, requestId), eq(connectionRequests.fromOrgId, ctx.orgId), eq(connectionRequests.status, "pending")))
    .returning({ id: connectionRequests.id });
  if (updated.length === 0) throw new NotFoundError("request");
}

export type RequestRow = {
  id: string;
  orgName: string;
  city: string;
  message: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** The list a supplier offered (only on requests a supplier sent). */
  offeredListName: string | null;
};

/** Open requests this organization received and sent. */
export async function listConnectionRequests(ctx: OrgCtx): Promise<{ incoming: RequestRow[]; outgoing: RequestRow[] }> {
  const db = getDb();
  const now = new Date();
  const live = and(eq(connectionRequests.status, "pending"), gt(connectionRequests.expiresAt, now));
  const incoming = await db
    .select({
      id: connectionRequests.id,
      orgName: organizations.name,
      city: organizations.city,
      message: connectionRequests.message,
      createdAt: connectionRequests.createdAt,
      expiresAt: connectionRequests.expiresAt,
      offeredListName: priceLists.name,
    })
    .from(connectionRequests)
    .innerJoin(organizations, eq(organizations.id, connectionRequests.fromOrgId))
    .leftJoin(priceLists, eq(priceLists.id, connectionRequests.priceListId))
    .where(and(eq(connectionRequests.toOrgId, ctx.orgId), live))
    .orderBy(asc(connectionRequests.createdAt));
  const outgoing = await db
    .select({
      id: connectionRequests.id,
      orgName: organizations.name,
      city: organizations.city,
      message: connectionRequests.message,
      createdAt: connectionRequests.createdAt,
      expiresAt: connectionRequests.expiresAt,
      offeredListName: sql<string | null>`null`,
    })
    .from(connectionRequests)
    .innerJoin(organizations, eq(organizations.id, connectionRequests.toOrgId))
    .where(and(eq(connectionRequests.fromOrgId, ctx.orgId), live))
    .orderBy(desc(connectionRequests.createdAt));
  return { incoming, outgoing };
}

export async function countIncomingRequests(ctx: OrgCtx): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(connectionRequests)
    .where(and(eq(connectionRequests.toOrgId, ctx.orgId), eq(connectionRequests.status, "pending"), gt(connectionRequests.expiresAt, new Date())));
  return row?.n ?? 0;
}

export async function getFindable(ctx: OrgCtx): Promise<boolean> {
  const [row] = await getDb().select({ findable: organizations.findable }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return row?.findable ?? true;
}

/** Turns "other businesses can find us by our code" on or off for the acting organization. */
export async function setFindable(ctx: OrgCtx, findable: boolean): Promise<void> {
  await getDb().update(organizations).set({ findable }).where(eq(organizations.id, ctx.orgId));
}
