import { timingSafeEqual } from "node:crypto";
import { renderRegularOrderReminder } from "@/lib/notifications/templates";
import { sendRegularOrderReminders } from "@/server/domain/orders/regular";
import { sendEmail } from "@/server/notifications/email";
import { appUrl } from "@/server/notifications/links";
import { processDeliveries } from "@/server/notifications/process";
import { pruneRateLimits } from "@/server/security/rate-limit";

// Drains due outbox rows. Called every minute by Supabase Cron (pg_net), which
// sends POST; GET is accepted so it can be tried by hand. Both need
// `Authorization: Bearer $CRON_SECRET`. No secret configured = nobody gets in.

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function drain(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await processDeliveries();
  // Regular-order reminders ride along too: a failure here must not fail the outbox drain.
  const regular = await sendRegularOrderReminders(async (to, names) => {
    const email = renderRegularOrderReminder(names, `${appUrl()}/buyer/regular`);
    await sendEmail({ to, ...email });
  }).catch((error: unknown) => {
    console.error("[cron] regular-order reminders failed", { message: error instanceof Error ? error.message : String(error) });
    return { claimed: 0, emails: 0 };
  });
  // Housekeeping rides along: expired rate-limit windows.
  const prunedRateLimits = await pruneRateLimits().catch(() => 0);
  return Response.json({ ...result, prunedRateLimits, regularReminders: regular.emails });
}

export const GET = drain;
export const POST = drain;
