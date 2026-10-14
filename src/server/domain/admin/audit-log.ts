import "server-only";
import { and, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { getDb } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { assertAdmin, type AdminCtx } from "@/server/domain/context";
import { escapeLike } from "@/server/domain/search/translit";

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = {
  /** Part of the actor's email or label. */
  actor?: string;
  /** Exact action name, e.g. "supplier.suspend". */
  action?: string;
  /** Inclusive start day and inclusive end day, as YYYY-MM-DD (UTC). */
  from?: string;
  to?: string;
  page?: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayStart(day: string | undefined): Date | undefined {
  if (!day || !DAY.test(day)) return undefined;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function listAuditLog(ctx: AdminCtx, filters: AuditFilters) {
  assertAdmin(ctx);
  const from = dayStart(filters.from);
  const toDay = dayStart(filters.to);
  const toExclusive = toDay ? new Date(toDay.getTime() + 24 * 60 * 60 * 1000) : undefined;
  const actor = filters.actor?.trim().slice(0, 100);
  const where = and(
    filters.action ? eq(auditLogs.action, filters.action.slice(0, 100)) : undefined,
    from ? gte(auditLogs.createdAt, from) : undefined,
    toExclusive ? lt(auditLogs.createdAt, toExclusive) : undefined,
    actor
      ? or(ilike(authUsers.email, `%${escapeLike(actor)}%`), ilike(auditLogs.actorLabel, `%${escapeLike(actor)}%`))
      : undefined,
  ) as SQL | undefined;

  const db = getDb();
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogs)
    .leftJoin(authUsers, eq(authUsers.id, auditLogs.actorUserId))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1) || 1), pageCount);
  const items = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      actorEmail: authUsers.email,
      actorLabel: auditLogs.actorLabel,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      data: auditLogs.data,
    })
    .from(auditLogs)
    .leftJoin(authUsers, eq(authUsers.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset((page - 1) * AUDIT_PAGE_SIZE);
  return { items, total, page, pageCount };
}

export async function listAuditActions(ctx: AdminCtx): Promise<string[]> {
  assertAdmin(ctx);
  const rows = await getDb().selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(sql`1`);
  return rows.map((r) => r.action);
}
