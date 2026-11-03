import { scrubBreadcrumb, scrubEvent } from "./sentry-scrub";
import { sentryDsn } from "./sentry-dsn";

// One set of options for the server and the browser (src/instrumentation.ts
// and src/instrumentation-client.ts). Errors only, deliberately:
//  - no performance tracing and no session replay (replay records what is on
//    screen, including other businesses' prices);
//  - no default PII (no IP address, cookies or user), and everything is scrubbed
//    again in beforeSend (see sentry-scrub.ts).
export function sentryOptions() {
  const dsn = sentryDsn();
  if (!dsn) return null;
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    // Navigation control flow and a browser quirk that is not a bug.
    ignoreErrors: ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "ResizeObserver loop"],
  };
}
