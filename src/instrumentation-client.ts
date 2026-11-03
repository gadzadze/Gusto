import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-config";

// Browser errors. No DSN, no Sentry.
const options = sentryOptions();
if (options) Sentry.init(options);
