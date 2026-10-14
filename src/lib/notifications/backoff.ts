// Retry schedule for outbox deliveries: after failed attempt n, wait
// RETRY_DELAYS_MINUTES[n - 1] minutes. One more failure after the last delay
// and the row is `failed` for good (5 attempts in all).

export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/** Minutes to wait after `attemptsMade` failed attempts, or null when out of retries. */
export function retryDelayMinutes(attemptsMade: number): number | null {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 1) return null;
  return RETRY_DELAYS_MINUTES[attemptsMade - 1] ?? null;
}
