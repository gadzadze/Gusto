import "server-only";
import { eq, inArray } from "drizzle-orm";
import { counterpartyLine, counterpartyRoleFor, notificationTitle } from "@/lib/notifications/templates";
import { dedupeKey, subjectDedupeKey } from "@/lib/notifications/plan";
import { formatMoney } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { notificationDeliveries, notifications, orders, organizationMemberships, pushSubscriptions } from "@/server/db/schema";
import { pushConfigured, webPushTransport, type PushTransport } from "../push";
import type { Channel } from "./types";

/**
 * Web Push through the outbox, same as email: `enqueue` writes a pending delivery (only for people who turned
 * notifications on), `send` shows a short message on each of the person's browsers. The text is rendered at send time
 * from the persisted order, in Georgian like every message that leaves the app, and carries only the title, the other
 * side's name and the total.
 */
export function createPushChannel(transport: PushTransport): Channel {
  return {
    name: "push",

    async enqueue(tx, draft) {
      if (!draft.notificationId) throw new Error("push channel needs the in-app notification id");
      const [row] = await tx
        .insert(notificationDeliveries)
        .values({
          notificationId: draft.notificationId,
          channel: "push",
          recipientUserId: draft.userId,
          payload: draft.orderId ? { event: draft.event, orderId: draft.orderId } : { event: draft.event },
          dedupeKey: draft.orderId
            ? dedupeKey(draft.orderId, draft.status, "push", draft.userId)
            : subjectDedupeKey(draft.subjectId ?? "", draft.event, "push", draft.userId),
        })
        .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
        .returning({ id: notificationDeliveries.id });
      return row?.id ?? null;
    },

    async send(delivery) {
      if (!pushConfigured()) return { status: "skipped", note: "push is not configured" };
      const db = getDb();
      const [notification] = await db
        .select({ event: notifications.event, orderNumber: notifications.orderNumber, counterpartyName: notifications.counterpartyName, link: notifications.link })
        .from(notifications)
        .where(eq(notifications.id, delivery.notificationId));
      if (!notification) return { status: "skipped", note: "notification no longer exists" };

      const subscriptions = await db
        .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, delivery.recipientUserId));
      if (subscriptions.length === 0) return { status: "skipped", note: "recipient has no push subscription" };

      let body = notification.counterpartyName;
      let url = notification.link ?? "/start";
      if (delivery.payload.orderId) {
        const [order] = await db
          .select({ number: orders.number, buyerOrgId: orders.buyerOrgId, totalMinor: orders.totalMinor, currency: orders.currency })
          .from(orders)
          .where(eq(orders.id, delivery.payload.orderId));
        if (!order) return { status: "skipped", note: "order no longer exists" };
        const memberships = await db
          .select({ orgId: organizationMemberships.organizationId })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.userId, delivery.recipientUserId));
        const recipientType = memberships.some((m) => m.orgId === order.buyerOrgId) ? "buyer" : "supplier";
        body = `${counterpartyLine(counterpartyRoleFor(recipientType), notification.counterpartyName)} · ${formatMoney(order.totalMinor, order.currency)}`;
        url = `/o/${order.number}`;
      }
      const payload = { title: notificationTitle(notification.event, notification.orderNumber), body, url };

      let sent = 0;
      let failed = 0;
      const gone: string[] = [];
      for (const subscription of subscriptions) {
        const result = await transport(subscription, payload);
        if (result === "sent") sent += 1;
        else if (result === "gone") gone.push(subscription.id);
        else failed += 1;
      }
      // A browser that unsubscribed answers 404/410: forget it so it is not tried again.
      if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
      if (sent > 0) return { status: "sent" };
      if (failed > 0) throw new Error("push delivery failed on every browser"); // ask for a retry
      return { status: "skipped", note: "every subscription had expired" };
    },
  };
}

export const pushChannel = createPushChannel(webPushTransport);
