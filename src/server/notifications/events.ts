import "server-only";
import { eq, inArray } from "drizzle-orm";
import { planRecipients, type EmailPreferences } from "@/lib/notifications/plan";
import type { Tx } from "@/server/db/client";
import {
  notificationPreferences,
  orders,
  organizationMemberships,
  type NotificationEvent,
} from "@/server/db/schema";
import { channels as defaultChannels, type Channel } from "./channels";

// Domain events → notification rows. recordOrderEvent() takes the caller's
// transaction, so the rows commit or roll back together with the change that
// caused them. Delivery happens later (see process.ts).
//
// Not covered here, on purpose: `invitation.created`. An invitation email
// carries the raw token, which Gusto never stores (only its hash), and the
// outbox persists its payload. That email is sent directly from the action
// that creates the invitation instead (supplier/customers/actions.ts).

export type OrderEventInput = {
  orderId: string;
  event: NotificationEvent;
  /** Who caused it; never notified about their own action. */
  actor: { userId: string; orgId: string };
};

export async function recordOrderEvent(
  tx: Tx,
  input: OrderEventInput,
  channels: readonly Channel[] = defaultChannels,
): Promise<{ notified: number }> {
  const [order] = await tx
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      buyerOrgId: orders.buyerOrgId,
      supplierOrgId: orders.supplierOrgId,
      buyerName: orders.buyerName,
      supplierName: orders.supplierName,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId));
  if (!order) throw new Error("recordOrderEvent: order not found");

  const members = await tx
    .select({ userId: organizationMemberships.userId, orgId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(inArray(organizationMemberships.organizationId, [order.buyerOrgId, order.supplierOrgId]));

  const prefRows = members.length
    ? await tx
        .select()
        .from(notificationPreferences)
        .where(inArray(notificationPreferences.userId, members.map((m) => m.userId)))
    : [];
  const preferences = new Map<string, EmailPreferences>(prefRows.map((p) => [p.userId, p]));

  const planned = planRecipients({
    event: input.event,
    order,
    actor: input.actor,
    members,
    preferences,
  });

  const inApp = channels.find((c) => c.name === "in_app");
  const email = channels.find((c) => c.name === "email");
  if (!inApp) throw new Error("in-app channel is required");

  let notified = 0;
  for (const recipient of planned) {
    const draft = {
      userId: recipient.userId,
      event: input.event,
      orderId: order.id,
      orderNumber: order.number,
      counterpartyName: recipient.orgId === order.supplierOrgId ? order.buyerName : order.supplierName,
      status: order.status,
    };
    const notificationId = await inApp.enqueue(tx, draft);
    if (!notificationId) continue; // already recorded: replays add nothing
    notified += 1;
    if (email && recipient.channels.includes("email")) {
      await email.enqueue(tx, { ...draft, notificationId });
    }
  }
  return { notified };
}
