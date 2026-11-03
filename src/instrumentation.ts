import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-config";

// Next.js calls register() once per server runtime. Without a DSN nothing is
// initialized and every Sentry call elsewhere is a no-op.
export function register() {
  const options = sentryOptions();
  if (options) Sentry.init(options);
}

// Errors thrown in Server Components, Route Handlers and Server Actions.
export const onRequestError = Sentry.captureRequestError;
