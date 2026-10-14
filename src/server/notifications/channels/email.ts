import "server-only";
import { eq } from "drizzle-orm";
import { counterpartyRoleFor, renderOrderEmail } from "@/lib/notifications/templates";
import { dedupeKey } from "@/lib/notifications/plan";
import { getDb } from "@/server/db/client";
import {
  notificationDeliveries,
  notifications,
  orderItems,
  orders,
  organizationMemberships,
} from "@/server/db/schema";
import { authUsers } from "drizzle-orm/supabase";
import { count } from "drizzle-orm";
import { sendEmail } from "../email";
import { appUrl } from "../links";
import type { Channel } from "./types";

/**
 * Email through the outbox. `enqueue` writes a pending delivery; `send`
 * renders the message from the persisted order and hands it to Resend.
 */
export const emailChannel: Channel = {
  name: "email",

  async enqueue(tx, draft) {
    if (!draft.notificationId) throw new Error("email channel needs the in-app notification id");
    const [row] = await tx
      .insert(notificationDeliveries)
      .values({
        notificationId: draft.notificationId,
        channel: "email",
        recipientUserId: draft.userId,
        payload: { event: draft.event, orderId: draft.orderId },
        dedupeKey: dedupeKey(draft.orderId, draft.status, "email", draft.userId),
      })
      .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
      .returning({ id: notificationDeliveries.id });
    return row?.id ?? null;
  },

  async send(delivery) {
    const db = getDb();
    const [notification] = await db
      .select({
        event: notifications.event,
        orderNumber: notifications.orderNumber,
        counterpartyName: notifications.counterpartyName,
      })
      .from(notifications)
      .where(eq(notifications.id, delivery.notificationId));
    if (!notification) return { status: "skipped", note: "notification no longer exists" };

    const [order] = await db
      .select({
        number: orders.number,
        buyerOrgId: orders.buyerOrgId,
        totalMinor: orders.totalMinor,
        currency: orders.currency,
      })
      .from(orders)
      .where(eq(orders.id, delivery.payload.orderId));
    if (!order) return { status: "skipped", note: "order no longer exists" };

    const [{ itemCount }] = await db
      .select({ itemCount: count() })
      .from(orderItems)
      .where(eq(orderItems.orderId, delivery.payload.orderId));

    const [user] = await db
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, delivery.recipientUserId));
    if (!user?.email) return { status: "skipped", note: "recipient has no email address" };

    // Which side the recipient is on decides what the counterparty is called.
    const [membership] = await db
      .select({ orgId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, delivery.recipientUserId));
    const recipientType = membership?.orgId === order.buyerOrgId ? "buyer" : "supplier";

    const email = renderOrderEmail({
      event: notification.event,
      orderNumber: order.number,
      counterpartyName: notification.counterpartyName,
      counterpartyRole: counterpartyRoleFor(recipientType),
      itemCount,
      totalMinor: order.totalMinor,
      currency: order.currency,
      link: `${appUrl()}/o/${order.number}`,
    });
    const result = await sendEmail({ to: user.email, ...email });
    return { status: result };
  },
};
