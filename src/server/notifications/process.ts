import "server-only";
import { sql } from "drizzle-orm";
import { after } from "next/server";
import { retryDelayMinutes } from "@/lib/notifications/backoff";
import { getDb } from "@/server/db/client";
import { channels as defaultChannels, type Channel, type ClaimedDelivery } from "./channels";

// Outbox processing. A delivery is *claimed* by pushing its next_attempt_at
// into the future (a lease) inside one short statement that uses
// FOR UPDATE SKIP LOCKED. The send itself happens outside any transaction, so
// a slow provider holds no locks, and two runners can never take the same row.
// A runner that dies mid-send just lets the lease expire; the row is retried.

export const BATCH_SIZE = 50;
const LEASE_MINUTES = 5;

export type ProcessResult = { claimed: number; sent: number; skipped: number; retried: number; failed: number };

type ClaimedRow = {
  id: string;
  channel: string;
  notification_id: string;
  recipient_user_id: string;
  payload: { event: string; orderId: string };
  attempts: number;
};

async function claim(limit: number, orderId?: string): Promise<ClaimedRow[]> {
  const only = orderId ? sql`AND payload->>'orderId' = ${orderId}` : sql``;
  const rows = await getDb().execute<ClaimedRow>(sql`
    UPDATE notification_deliveries d
    SET attempts = d.attempts + 1,
        next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES}),
        updated_at = now()
    WHERE d.id IN (
      SELECT id FROM notification_deliveries
      WHERE status = 'pending' AND next_attempt_at <= now() ${only}
      ORDER BY next_attempt_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING d.id, d.channel, d.notification_id, d.recipient_user_id, d.payload, d.attempts
  `);
  return [...rows];
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

export async function processDeliveries(
  options: { orderId?: string; limit?: number; channels?: readonly Channel[] } = {},
): Promise<ProcessResult> {
  const db = getDb();
  const registry = options.channels ?? defaultChannels;
  const result: ProcessResult = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0 };

  const rows = await claim(options.limit ?? BATCH_SIZE, options.orderId);
  result.claimed = rows.length;

  for (const row of rows) {
    const delivery: ClaimedDelivery = {
      id: row.id,
      notificationId: row.notification_id,
      recipientUserId: row.recipient_user_id,
      payload: row.payload,
      attempts: row.attempts,
    };
    try {
      const channel = registry.find((c) => c.name === row.channel);
      if (!channel?.send) throw new Error(`no sender for channel ${row.channel}`);
      const outcome = await channel.send(delivery);
      await db.execute(sql`
        UPDATE notification_deliveries
        SET status = ${outcome.status}, sent_at = ${outcome.status === "sent" ? sql`now()` : sql`NULL`},
            last_error = ${outcome.note ?? null}, updated_at = now()
        WHERE id = ${row.id}`);
      result[outcome.status] += 1;
    } catch (error) {
      // Message only: never tokens, never the message body.
      const delay = retryDelayMinutes(row.attempts);
      if (delay === null) {
        await db.execute(sql`
          UPDATE notification_deliveries
          SET status = 'failed', last_error = ${describe(error)}, updated_at = now()
          WHERE id = ${row.id}`);
        result.failed += 1;
      } else {
        await db.execute(sql`
          UPDATE notification_deliveries
          SET next_attempt_at = now() + make_interval(mins => ${delay}),
              last_error = ${describe(error)}, updated_at = now()
          WHERE id = ${row.id}`);
        result.retried += 1;
      }
      console.error("[notifications] delivery failed", { channel: row.channel, attempts: row.attempts, error: describe(error) });
    }
  }
  return result;
}

/**
 * Called after a commit that recorded events: attempt this order's pending
 * deliveries right away, after the response is sent. Outside a request
 * (scripts, tests) there is no `after()`; the cron route picks them up.
 */
export function deliverAfterResponse(orderId: string): void {
  try {
    after(async () => {
      try {
        await processDeliveries({ orderId });
      } catch (error) {
        console.error("[notifications] immediate delivery failed", { error: describe(error) });
      }
    });
  } catch {
    // Not in a request scope: leave it to the cron drain.
  }
}
