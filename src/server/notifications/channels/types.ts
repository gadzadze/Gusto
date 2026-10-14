import type { Tx } from "@/server/db/client";
import type { ChannelName } from "@/lib/notifications/plan";
import type { NotificationEvent } from "@/server/db/schema";

/** One notification for one recipient, as the event layer produces it. */
export type NotificationDraft = {
  userId: string;
  event: NotificationEvent;
  orderId: string;
  orderNumber: number;
  /** The other organization's name, from the recipient's side. */
  counterpartyName: string;
  /** Order status the event moved to; part of every dedupe key. */
  status: string;
  /** Set by the in-app channel; outbox channels reference it. */
  notificationId?: string;
};

export type ClaimedDelivery = {
  id: string;
  notificationId: string;
  recipientUserId: string;
  payload: { event: string; orderId: string };
  attempts: number;
};

export type DeliveryOutcome = { status: "sent" | "skipped"; note?: string };

/**
 * A way to tell someone about an event. Channels have two halves:
 *
 * - `enqueue` runs inside the transaction that caused the event and only
 *   writes rows (so a rollback leaves nothing behind). It must be idempotent
 *   on the draft's dedupe key. It returns the notification id when it created
 *   the notification, null when it already existed.
 * - `send` (outbox channels only) runs later, outside any transaction, for
 *   one claimed delivery. It throws to ask for a retry.
 *
 * A future WhatsApp Business API channel implements this same interface
 * (docs/whatsapp-business-api.md). It does not exist yet.
 */
export interface Channel {
  readonly name: ChannelName;
  enqueue(tx: Tx, draft: NotificationDraft): Promise<string | null>;
  send?(delivery: ClaimedDelivery): Promise<DeliveryOutcome>;
}
