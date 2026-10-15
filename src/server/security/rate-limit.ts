import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/server/db/client";
import { StateError } from "@/server/domain/errors";

// Postgres-backed fixed-window rate limiting: one row per (key, window), one
// atomic upsert per attempt. No Redis; the database is already the source of
// truth and the limits are low. A window is aligned to the clock, so a burst
// across a boundary can briefly reach twice the limit; fine for abuse
// protection, not for billing.

export const RATE_LIMITS = {
  /** Order submit: 10 per minute per buyer organization. */
  orderSubmit: { name: "order_submit", limit: 10, windowSeconds: 60 },
  /** Invite creation or regeneration: 30 per hour per supplier. */
  inviteCreate: { name: "invite_create", limit: 30, windowSeconds: 3600 },
  /** Invite acceptance: 10 per minute per client IP. */
  inviteAccept: { name: "invite_accept", limit: 10, windowSeconds: 60 },
  /** Sign-in link requests: 10 per minute per client IP (stored hashed). */
  signInRequest: { name: "sign_in_request", limit: 10, windowSeconds: 60 },
  /** Password sign-in attempts: 10 per minute per client IP (stored hashed). */
  passwordSignIn: { name: "password_sign_in", limit: 10, windowSeconds: 60 },
  /** Public "onboard me" supplier requests: 5 per hour per client IP (stored hashed). */
  supplierRequest: { name: "supplier_request", limit: 5, windowSeconds: 3600 },
  /** Product image upload: 30 per hour per supplier. */
  imageUpload: { name: "image_upload", limit: 30, windowSeconds: 3600 },
} as const;

export type RateRule = (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];
export type RateLimitError = "rate_limited";

/** Stable key for a subject; people-like subjects (IPs) are hashed, never stored raw. */
export function rateKey(rule: { name: string }, subject: string, options: { hash?: boolean } = {}): string {
  const value = options.hash ? createHash("sha256").update(subject).digest("hex").slice(0, 32) : subject;
  return `${rule.name}:${value}`;
}

/**
 * Counts one attempt and throws StateError("rate_limited") when the window's
 * limit is exceeded. Rejected attempts count too, so hammering stays blocked.
 * Pass the connection that should NOT be rolled back with a failed action
 * (the default, a fresh statement on the pool, is right for almost everything).
 */
export async function consumeRateLimit(
  rule: { name: string; limit: number; windowSeconds: number },
  subject: string,
  options: { hash?: boolean; db?: Db | Tx; now?: Date } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  const key = rateKey(rule, subject, options);
  const now = options.now ?? new Date();
  const rows = await db.execute<{ hits: number }>(sql`
    INSERT INTO rate_limits (key, window_start, hits)
    VALUES (
      ${key},
      to_timestamp(floor(extract(epoch FROM ${now.toISOString()}::timestamptz) / ${rule.windowSeconds}) * ${rule.windowSeconds}),
      1
    )
    ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
    RETURNING hits
  `);
  if (rows[0].hits > rule.limit) throw new StateError<RateLimitError>("rate_limited");
}

/** Housekeeping, called from the notifications cron: windows are at most an hour long. */
export async function pruneRateLimits(): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    WITH gone AS (DELETE FROM rate_limits WHERE window_start < now() - interval '1 day' RETURNING 1)
    SELECT count(*)::int AS n FROM gone
  `);
  return rows[0].n;
}
