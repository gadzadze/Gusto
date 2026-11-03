// Kept free of imports so next.config.ts can use it for the CSP.

/** The public DSN. Sentry stays off (every call is a no-op) while it is unset. */
export function sentryDsn(): string | null {
  // Written out in full so Next inlines it into the browser bundle at build time.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  return dsn ? dsn : null;
}

/** The origin events are sent to, for the Content-Security-Policy (connect-src). */
export function sentryIngestOrigin(dsn: string | null = sentryDsn()): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}
