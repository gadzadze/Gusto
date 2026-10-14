import "server-only";
import { dedupeKey } from "@/lib/notifications/plan";
import { notifications } from "@/server/db/schema";
import type { Channel } from "./types";

/** In-app notifications are the rows themselves; there is nothing to send. */
export const inAppChannel: Channel = {
  name: "in_app",
  async enqueue(tx, draft) {
    const [row] = await tx
      .insert(notifications)
      .values({
        userId: draft.userId,
        event: draft.event,
        orderId: draft.orderId,
        orderNumber: draft.orderNumber,
        counterpartyName: draft.counterpartyName,
        dedupeKey: dedupeKey(draft.orderId, draft.status, "in_app", draft.userId),
      })
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id });
    return row?.id ?? null;
  },
};
