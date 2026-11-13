import "server-only";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_PREFERENCES, eventGroup, planRecipients, type EmailPreferences } from "@/lib/notifications/plan";
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
// carries the raw token, which 202 never stores (only its hash), and the
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

export type SubjectEventInput = {
  event: Extract<
    NotificationEvent,
    | "terms_requested"
    | "terms_approved"
    | "terms_declined"
    | "customer_connected"
    | "connection_requested"
    | "connection_approved"
    | "connection_declined"
  >;
  /** The request or customer the event is about: part of the dedupe key, so a replay adds nothing. */
  subjectId: string;
  /** The organization that hears about it, and the other side's name shown to them. */
  recipientOrgId: string;
  counterpartyName: string;
  /** An internal path (built by the server) that opening the notification goes to. */
  link: string;
  /** Who caused it; never notified about their own action. */
  actor: { userId: string };
};

/**
 * Like recordOrderEvent, for things that are not about an order: a customer asks for payment terms, the
 * supplier decides, a customer joins. Every member of the recipient organization gets the in-app
 * notification, and an email when their preference for the group is on. Runs inside the caller's
 * transaction.
 */
export async function recordSubjectEvent(
  tx: Tx,
  input: SubjectEventInput,
  channels: readonly Channel[] = defaultChannels,
): Promise<{ notified: number }> {
  const members = await tx
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.organizationId, input.recipientOrgId));
  const recipients = members.filter((m) => m.userId !== input.actor.userId);
  if (recipients.length === 0) return { notified: 0 };
  const prefRows = await tx
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, recipients.map((m) => m.userId)));
  const preferences = new Map<string, EmailPreferences>(prefRows.map((p) => [p.userId, p]));

  const inApp = channels.find((c) => c.name === "in_app");
  const email = channels.find((c) => c.name === "email");
  if (!inApp) throw new Error("in-app channel is required");
  const group = eventGroup(input.event);

  let notified = 0;
  for (const member of recipients) {
    const draft = {
      userId: member.userId,
      event: input.event,
      orderId: null,
      orderNumber: null,
      counterpartyName: input.counterpartyName,
      status: input.event,
      subjectId: input.subjectId,
      link: input.link,
    };
    const notificationId = await inApp.enqueue(tx, draft);
    if (!notificationId) continue;
    notified += 1;
    const prefs = preferences.get(member.userId) ?? DEFAULT_PREFERENCES;
    const emailOn = group === "new_orders" ? prefs.emailNewOrders : prefs.emailOrderUpdates;
    if (email && emailOn) await email.enqueue(tx, { ...draft, notificationId });
  }
  return { notified };
}
