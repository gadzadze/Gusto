import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { isFreeMailAddress } from "@/lib/legal-id";
import { getDb } from "@/server/db/client";
import {
  auditLogs,
  orders,
  organizationMemberships,
  organizations,
  profiles,
  supplierCustomers,
  type OrgStatus,
  type OrgType,
} from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";
import { escapeLike } from "@/server/domain/search/translit";
import { reasonSchema, type ReviewError } from "./suppliers";

// Support tools for organizations of either kind. They deliberately expose
// contact and status information only: no price lists, no catalogs, no
// customer lists (CLAUDE.md: admins see what support needs).

export const ADMIN_ORGS_PAGE_SIZE = 25;

export type OrganizationListItem = {
  id: string;
  type: OrgType;
  name: string;
  city: string;
  legalId: string | null;
  status: OrgStatus;
  createdAt: Date;
};

export async function listOrganizations(
  ctx: AdminCtx,
  filters: { q?: string; type?: OrgType; status?: OrgStatus; page?: number },
) {
  assertAdmin(ctx);
  const q = filters.q?.trim().slice(0, 100);
  const where = and(
    filters.type ? eq(organizations.type, filters.type) : undefined,
    filters.status ? eq(organizations.status, filters.status) : undefined,
    q
      ? or(
          ilike(organizations.name, `%${escapeLike(q)}%`),
          ilike(organizations.city, `%${escapeLike(q)}%`),
          ilike(organizations.phone, `%${escapeLike(q)}%`),
          ilike(organizations.legalId, `%${escapeLike(q)}%`),
        )
      : undefined,
  ) as SQL | undefined;
  const db = getDb();
  const [{ total }] = await db.select({ total: count() }).from(organizations).where(where);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_ORGS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1) || 1), pageCount);
  const items: OrganizationListItem[] = await db
    .select({
      id: organizations.id,
      type: organizations.type,
      name: organizations.name,
      city: organizations.city,
      legalId: organizations.legalId,
      status: organizations.status,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(where)
    // Waiting for verification first: that is the queue an admin works through.
    .orderBy(sql`(${organizations.status} <> 'pending_review')`, desc(organizations.createdAt), asc(organizations.id))
    .limit(ADMIN_ORGS_PAGE_SIZE)
    .offset((page - 1) * ADMIN_ORGS_PAGE_SIZE);
  return { items, total, page, pageCount };
}

/** Buyers or suppliers waiting for verification (the admin nav badge). */
export async function countPendingOrganizations(ctx: AdminCtx, type: OrgType): Promise<number> {
  assertAdmin(ctx);
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(organizations)
    .where(and(eq(organizations.type, type), eq(organizations.status, "pending_review")));
  return n;
}

export type VerificationInfo = {
  legalId: string | null;
  /** Sign-in addresses of the organization's members. */
  ownerEmails: string[];
  /** Any of them is a personal mailbox (gmail.com, ...) rather than a company one. */
  freeMail: boolean;
  /** Suppliers who invited this buyer (the WhatsApp-link path). */
  invitedBy: string[];
  /** The admin vetted the business before it signed up. */
  preRegistered: boolean;
};

/** What the admin needs in front of them when deciding to approve. */
export async function getVerificationInfo(ctx: AdminCtx, orgId: string): Promise<VerificationInfo> {
  assertAdmin(ctx);
  const db = getDb();
  const [org] = await db.select({ legalId: organizations.legalId }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new NotFoundError("organization");
  const emails = await db
    .select({ email: authUsers.email })
    .from(organizationMemberships)
    .innerJoin(authUsers, eq(authUsers.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.organizationId, orgId));
  const ownerEmails = emails.map((e) => e.email).filter((e): e is string => Boolean(e));
  const inviters = await db
    .select({ name: organizations.name })
    .from(supplierCustomers)
    .innerJoin(organizations, eq(organizations.id, supplierCustomers.supplierOrgId))
    .where(eq(supplierCustomers.buyerOrgId, orgId));
  const [created] = await db
    .select({ data: auditLogs.data })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "organization.created"), eq(auditLogs.targetId, orgId)))
    .limit(1);
  return {
    legalId: org.legalId,
    ownerEmails,
    freeMail: ownerEmails.some((e) => isFreeMailAddress(e)),
    invitedBy: inviters.map((i) => i.name),
    preRegistered: created?.data?.preapproved === true,
  };
}

export type BuyerDetail = {
  org: typeof organizations.$inferSelect;
  owners: { fullName: string | null; phone: string | null }[];
  orderCount: number;
};

export async function getBuyerForAdmin(ctx: AdminCtx, orgId: string): Promise<BuyerDetail> {
  assertAdmin(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new NotFoundError("buyer");
  const db = getDb();
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.type, "buyer")));
  if (!org) throw new NotFoundError("buyer");
  const owners = await db
    .select({ fullName: profiles.fullName, phone: profiles.phone })
    .from(organizationMemberships)
    .innerJoin(profiles, eq(profiles.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.organizationId, orgId));
  const [{ n }] = await db.select({ n: count() }).from(orders).where(eq(orders.buyerOrgId, orgId));
  return { org, owners, orderCount: n };
}

/**
 * Approves, suspends or reactivates a buyer organization (reason required except for approval, audited,
 * conditional on the current status). Suppliers have their own review flow
 * in suppliers.ts.
 */
export async function reviewBuyer(
  ctx: AdminCtx,
  orgId: string,
  action: "approve" | "suspend" | "reactivate",
  reason?: string,
): Promise<void> {
  assertAdmin(ctx);
  // Approving needs no reason; the other two do.
  const parsed = reasonSchema.safeParse(reason ?? "");
  if (action !== "approve" && !parsed.success) throw new StateError<ReviewError>("reason_required");
  const cleanReason = parsed.success ? parsed.data : null;
  const from: OrgStatus = action === "approve" ? "pending_review" : action === "suspend" ? "active" : "suspended";
  const to: OrgStatus = action === "suspend" ? "suspended" : "active";

  await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select({ status: organizations.status })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.type, "buyer")))
      .for("update");
    if (!before) throw new NotFoundError("buyer");
    if (before.status !== from) throw new StateError<ReviewError>("stale_status");
    await tx.update(organizations).set({ status: to }).where(eq(organizations.id, orgId));
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: `buyer.${action}`,
      targetType: "organization",
      targetId: orgId,
      data: { before: before.status, after: to, reason: cleanReason },
    });
  });
}

