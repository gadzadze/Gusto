import "server-only";
import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  orders,
  organizationMemberships,
  organizations,
  profiles,
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
  status: OrgStatus;
  createdAt: Date;
};

export async function listOrganizations(
  ctx: AdminCtx,
  filters: { q?: string; type?: OrgType; page?: number },
) {
  assertAdmin(ctx);
  const q = filters.q?.trim().slice(0, 100);
  const where = and(
    filters.type ? eq(organizations.type, filters.type) : undefined,
    q
      ? or(
          ilike(organizations.name, `%${escapeLike(q)}%`),
          ilike(organizations.city, `%${escapeLike(q)}%`),
          ilike(organizations.phone, `%${escapeLike(q)}%`),
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
      status: organizations.status,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(where)
    .orderBy(desc(organizations.createdAt), asc(organizations.id))
    .limit(ADMIN_ORGS_PAGE_SIZE)
    .offset((page - 1) * ADMIN_ORGS_PAGE_SIZE);
  return { items, total, page, pageCount };
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
 * Suspends or reactivates a buyer organization (reason required, audited,
 * conditional on the current status). Suppliers have their own review flow
 * in suppliers.ts.
 */
export async function reviewBuyer(
  ctx: AdminCtx,
  orgId: string,
  action: "suspend" | "reactivate",
  reason?: string,
): Promise<void> {
  assertAdmin(ctx);
  const parsed = reasonSchema.safeParse(reason ?? "");
  if (!parsed.success) throw new StateError<ReviewError>("reason_required");
  const from: OrgStatus = action === "suspend" ? "active" : "suspended";
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
      data: { before: before.status, after: to, reason: parsed.data },
    });
  });
}

