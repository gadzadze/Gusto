import "server-only";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import {
  auditLogs,
  organizationMemberships,
  organizations,
  products,
  profiles,
  supplierSettings,
  type OrgStatus,
} from "@/server/db/schema";
import { writeAudit } from "@/server/domain/audit";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { NotFoundError, StateError } from "@/server/domain/errors";

export const reasonSchema = z.string().trim().min(3, "required").max(500, "too_long");

export type SupplierReviewAction = "approve" | "suspend" | "reactivate";

// Allowed status changes per action. Anything else is a stale click
// (someone else acted first) and is reported, not applied.
const TRANSITIONS: Record<SupplierReviewAction, { from: OrgStatus[]; to: OrgStatus; needsReason: boolean }> = {
  approve: { from: ["pending_review"], to: "active", needsReason: false },
  suspend: { from: ["pending_review", "active"], to: "suspended", needsReason: true },
  reactivate: { from: ["suspended"], to: "active", needsReason: true },
};

export type SupplierListItem = {
  id: string;
  name: string;
  city: string;
  status: OrgStatus;
  createdAt: Date;
  productCount: number;
};

export async function listSuppliersForAdmin(ctx: AdminCtx, status?: OrgStatus): Promise<SupplierListItem[]> {
  assertAdmin(ctx);
  return getDb()
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      status: organizations.status,
      createdAt: organizations.createdAt,
      productCount: sql<number>`(select count(*)::int from ${products} where ${products.supplierOrgId} = ${organizations.id})`,
    })
    .from(organizations)
    .where(and(eq(organizations.type, "supplier"), status ? eq(organizations.status, status) : undefined))
    // Pending first: that's the queue an admin works through.
    .orderBy(
      sql`case ${organizations.status} when 'pending_review' then 0 when 'active' then 1 else 2 end`,
      asc(organizations.createdAt),
    )
    .limit(500);
}

export async function countSuppliersByStatus(ctx: AdminCtx): Promise<Record<OrgStatus, number>> {
  assertAdmin(ctx);
  const rows = await getDb()
    .select({ status: organizations.status, n: count() })
    .from(organizations)
    .where(eq(organizations.type, "supplier"))
    .groupBy(organizations.status);
  const out: Record<OrgStatus, number> = { pending_review: 0, active: 0, suspended: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export type SupplierDetail = {
  org: typeof organizations.$inferSelect;
  settings: typeof supplierSettings.$inferSelect | null;
  owners: { fullName: string | null; phone: string | null }[];
  productCounts: { active: number; inactive: number };
  history: { action: string; createdAt: Date; data: Record<string, unknown> | null }[];
};

export async function getSupplierForAdmin(ctx: AdminCtx, orgId: string): Promise<SupplierDetail> {
  assertAdmin(ctx);
  const db = getDb();
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.type, "supplier")));
  if (!org) throw new NotFoundError("supplier");

  const [settings] = await db.select().from(supplierSettings).where(eq(supplierSettings.organizationId, orgId));
  const owners = await db
    .select({ fullName: profiles.fullName, phone: profiles.phone })
    .from(organizationMemberships)
    .innerJoin(profiles, eq(profiles.id, organizationMemberships.userId))
    .where(eq(organizationMemberships.organizationId, orgId));
  const counts = await db
    .select({ isActive: products.isActive, n: count() })
    .from(products)
    .where(eq(products.supplierOrgId, orgId))
    .groupBy(products.isActive);
  const history = await db
    .select({ action: auditLogs.action, createdAt: auditLogs.createdAt, data: auditLogs.data })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.targetType, "organization"),
        eq(auditLogs.targetId, orgId),
        inArray(auditLogs.action, ["organization.created", "supplier.approve", "supplier.suspend", "supplier.reactivate"]),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);

  return {
    org,
    settings: settings ?? null,
    owners,
    productCounts: {
      active: counts.find((c) => c.isActive)?.n ?? 0,
      inactive: counts.find((c) => !c.isActive)?.n ?? 0,
    },
    history,
  };
}

export type ReviewError = "stale_status" | "reason_required";

/** Approve, suspend or reactivate a supplier. Conditional on the current status; audited. */
export async function reviewSupplier(
  ctx: AdminCtx,
  orgId: string,
  action: SupplierReviewAction,
  reason?: string,
): Promise<void> {
  assertAdmin(ctx);
  const rule = TRANSITIONS[action];
  let cleanReason: string | null = null;
  if (rule.needsReason) {
    const parsed = reasonSchema.safeParse(reason ?? "");
    if (!parsed.success) throw new StateError<ReviewError>("reason_required");
    cleanReason = parsed.data;
  }

  await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select({ status: organizations.status })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.type, "supplier")))
      .for("update");
    if (!before) throw new NotFoundError("supplier");
    if (!rule.from.includes(before.status)) throw new StateError<ReviewError>("stale_status");

    await tx.update(organizations).set({ status: rule.to }).where(eq(organizations.id, orgId));
    await writeAudit(tx, {
      actorUserId: ctx.userId,
      action: `supplier.${action}`,
      targetType: "organization",
      targetId: orgId,
      data: { before: before.status, after: rule.to, reason: cleanReason },
    });
  });
}
