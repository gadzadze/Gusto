import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";

// What an uptime monitor needs to know: can the app reach its database, and is
// the notification cron still draining the outbox. One query answers both, so
// a healthy check costs one round trip.

/** A pending delivery this far past due means nothing is draining the outbox. */
export const OUTBOX_STALLED_AFTER_MINUTES = 15;
const QUERY_TIMEOUT_MS = 3_000;

export type HealthReport = {
  ok: boolean;
  database: "ok" | "down";
  outbox: "ok" | "stalled" | "unknown";
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("query failed"));
      },
    );
  });
}

export async function checkHealth(getDatabase: () => Db = getDb): Promise<HealthReport> {
  try {
    const rows = await withTimeout(
      getDatabase().execute<{ stalled: number }>(sql`
        SELECT count(*)::int AS stalled
        FROM notification_deliveries
        WHERE status = 'pending'
          AND next_attempt_at < now() - make_interval(mins => ${OUTBOX_STALLED_AFTER_MINUTES})
      `),
      QUERY_TIMEOUT_MS,
    );
    const stalled = rows[0]?.stalled ?? 0;
    return { ok: stalled === 0, database: "ok", outbox: stalled === 0 ? "ok" : "stalled" };
  } catch {
    // The error is deliberately not returned or logged here: it can carry the
    // connection string host, and the monitor only needs to know it failed.
    return { ok: false, database: "down", outbox: "unknown" };
  }
}
