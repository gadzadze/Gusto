import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { DEFAULT_PREFERENCES, type EmailPreferences } from "@/lib/notifications/plan";
import { getDb } from "@/server/db/client";
import { notificationPreferences, notifications } from "@/server/db/schema";
import { NotFoundError } from "@/server/domain/errors";

// Everything here is scoped to one user, taken from the guard's context.

export const NOTIFICATIONS_PAGE_SIZE = 20;

export async function countUnread(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function listNotifications(userId: string, page = 1) {
  const db = getDb();
  const where = eq(notifications.userId, userId);
  const [{ total }] = await db.select({ total: count() }).from(notifications).where(where);
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const items = await db
    .select({
      id: notifications.id,
      event: notifications.event,
      orderNumber: notifications.orderNumber,
      counterpartyName: notifications.counterpartyName,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATIONS_PAGE_SIZE)
    .offset((current - 1) * NOTIFICATIONS_PAGE_SIZE);
  return { items, total, page: current, pageCount };
}

/** Marks one of the user's own notifications read; returns its order number. Others' ids are "not found". */
export async function markRead(userId: string, notificationId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(notificationId)) throw new NotFoundError("notification");
  const db = getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)));
  const [row] = await db
    .select({ orderNumber: notifications.orderNumber })
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  if (!row) throw new NotFoundError("notification");
  return row.orderNumber;
}

export async function markAllRead(userId: string): Promise<void> {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function getPreferences(userId: string): Promise<EmailPreferences> {
  const [row] = await getDb().select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  return row ? { emailNewOrders: row.emailNewOrders, emailOrderUpdates: row.emailOrderUpdates } : DEFAULT_PREFERENCES;
}

export async function setPreferences(userId: string, prefs: EmailPreferences): Promise<void> {
  await getDb()
    .insert(notificationPreferences)
    .values({ userId, ...prefs })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: { ...prefs, updatedAt: new Date() } });
}
