import type { NotificationEvent } from "@/server/db/schema";

// Who hears about an order event, and over which channels. Pure: the database
// side (server/notifications/events.ts) feeds it members and preferences and
// writes whatever it returns.

export type ChannelName = "in_app" | "email";
export type EventGroup = "new_orders" | "order_updates";
export type EmailPreferences = { emailNewOrders: boolean; emailOrderUpdates: boolean };

export const DEFAULT_PREFERENCES: EmailPreferences = { emailNewOrders: true, emailOrderUpdates: true };

export type PlanInput = {
  event: NotificationEvent;
  order: { buyerOrgId: string; supplierOrgId: string };
  actor: { userId: string; orgId: string };
  /** Members of the buyer and supplier organizations (others are ignored). */
  members: { userId: string; orgId: string }[];
  /** Missing entry = defaults (email on). */
  preferences: ReadonlyMap<string, EmailPreferences>;
};

export type PlannedRecipient = { userId: string; orgId: string; channels: ChannelName[] };

export function eventGroup(event: NotificationEvent): EventGroup {
  return event === "order_submitted" ? "new_orders" : "order_updates";
}

/** The organization an event is addressed to: always the other side from the actor. */
export function recipientOrgId(
  event: NotificationEvent,
  order: { buyerOrgId: string; supplierOrgId: string },
  actorOrgId: string,
): string {
  if (event === "order_submitted") return order.supplierOrgId;
  return actorOrgId === order.buyerOrgId ? order.supplierOrgId : order.buyerOrgId;
}

/**
 * - `order_submitted` → every supplier member.
 * - confirmed / rejected / delivered → every buyer member.
 * - cancelled → every member of the other side from whoever cancelled (a
 *   buyer cancelling is news to the supplier).
 * The actor never notifies themselves. In-app is always on; email follows
 * the user's preference for the event's group.
 */
export function planRecipients(input: PlanInput): PlannedRecipient[] {
  const orgId = recipientOrgId(input.event, input.order, input.actor.orgId);
  const group = eventGroup(input.event);
  return input.members
    .filter((m) => m.orgId === orgId && m.userId !== input.actor.userId)
    .map((m) => {
      const prefs = input.preferences.get(m.userId) ?? DEFAULT_PREFERENCES;
      const emailOn = group === "new_orders" ? prefs.emailNewOrders : prefs.emailOrderUpdates;
      return { userId: m.userId, orgId: m.orgId, channels: emailOn ? (["in_app", "email"] as ChannelName[]) : ["in_app" as ChannelName] };
    });
}

export function dedupeKey(orderId: string, status: string, channel: ChannelName, userId: string): string {
  return `order:${orderId}:status:${status}:${channel === "in_app" ? "inapp" : channel}:${userId}`;
}
